import { Queue, type ConnectionOptions } from 'bullmq'
import { config } from '@alias/config'
import logger from '@alias/utils/logger'

export const NOTIFICATION_DELIVERY_QUEUE = 'notification-delivery'

let queue: Queue | null = null
let queueInitFailed = false
let connectionOptions: ConnectionOptions | null = null
let queueUnavailableUntil = 0
const QUEUE_RETRY_COOLDOWN_MS = 30_000

function getRedisConnection(): ConnectionOptions | null {
  const url = config.redisUrl?.trim()
  if (!url) return null
  if (connectionOptions) return connectionOptions

  // BullMQ accepts an ioredis-style connection object or a URL via connection string.
  try {
    const parsed = new URL(url)
    connectionOptions = {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      // API producers must fail promptly when Redis is unavailable. MongoDB is
      // the durable outbox and the recovery poller will publish the row later.
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      enableReadyCheck: true,
      retryStrategy: () => null,
    }
    if (parsed.protocol === 'rediss:') {
      ;(connectionOptions as any).tls = {}
    }
    return connectionOptions
  } catch {
    // Fall back to treating REDIS_URL as host:port
    const [host, portRaw] = url.split(':')
    connectionOptions = {
      host: host || '127.0.0.1',
      port: portRaw ? Number(portRaw) : 6379,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      retryStrategy: () => null,
    }
    return connectionOptions
  }
}

export function isNotificationQueueAvailable(): boolean {
  return Boolean(config.redisUrl?.trim())
    && !queueInitFailed
    && Date.now() >= queueUnavailableUntil
}

export function getNotificationDeliveryQueue(): Queue | null {
  if (!config.notificationDeliveryEnabled) return null
  if (queueInitFailed) return null
  if (Date.now() < queueUnavailableUntil) return null
  if (queue) return queue

  const connection = getRedisConnection()
  if (!connection) return null

  try {
    queue = new Queue(NOTIFICATION_DELIVERY_QUEUE, {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 1, // Mongo owns retries; jobs re-enqueued with delay.
      },
    })
    queue.on('error', (err) => {
      logger.error('notification_delivery.queue_error', { error: err.message })
    })
    return queue
  } catch (error) {
    queueInitFailed = true
    logger.error('notification_delivery.queue_init_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Publish a delivery job. jobId = deliveryId for BullMQ-level idempotency.
 * delayMs schedules a delayed retry after transient failure.
 */
export async function publishDeliveryJob(
  deliveryId: string,
  delayMs = 0
): Promise<boolean> {
  const q = getNotificationDeliveryQueue()
  if (!q) return false

  try {
    // Removing a completed/failed job with the same id allows re-enqueue after retry.
    const existing = await q.getJob(deliveryId)
    if (existing) {
      const state = await existing.getState()
      if (state === 'completed' || state === 'failed') {
        await existing.remove()
      } else if (state === 'delayed' || state === 'waiting' || state === 'active') {
        return true
      }
    }

    await q.add(
      'deliver',
      { deliveryId },
      {
        jobId: deliveryId,
        delay: delayMs > 0 ? delayMs : undefined,
      }
    )
    return true
  } catch (error) {
    queueUnavailableUntil = Date.now() + QUEUE_RETRY_COOLDOWN_MS
    if (queue === q) queue = null
    await q.disconnect().catch(() => undefined)
    logger.warn('notification_delivery.publish_failed', {
      deliveryId,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function closeNotificationDeliveryQueue(): Promise<void> {
  if (queue) {
    await queue.close()
    queue = null
  }
  connectionOptions = null
  queueInitFailed = false
  queueUnavailableUntil = 0
}

/** Test helper to force re-init after env changes. */
export function resetNotificationQueueStateForTests(): void {
  queue = null
  connectionOptions = null
  queueInitFailed = false
  queueUnavailableUntil = 0
}
