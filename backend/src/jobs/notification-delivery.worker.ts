import { Worker, type ConnectionOptions } from 'bullmq'
import { config } from '@alias/config'
import {
  NOTIFICATION_DELIVERY_QUEUE,
  publishDeliveryJob,
} from '@alias/jobs/notification-delivery.queue'
import { processNotificationDelivery } from '@alias/services/notification-delivery.service'
import logger from '@alias/utils/logger'

let worker: Worker | null = null
let workerState: 'started' | 'disabled' | 'not_configured' | 'stopped' = 'stopped'

function getRedisConnection(): ConnectionOptions | null {
  const url = config.redisUrl?.trim()
  if (!url) return null
  try {
    const parsed = new URL(url)
    const connection: ConnectionOptions = {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      maxRetriesPerRequest: null,
    }
    if (parsed.protocol === 'rediss:') {
      ;(connection as any).tls = {}
    }
    return connection
  } catch {
    const [host, portRaw] = url.split(':')
    return {
      host: host || '127.0.0.1',
      port: portRaw ? Number(portRaw) : 6379,
      maxRetriesPerRequest: null,
    }
  }
}

export function startNotificationDeliveryWorker(): Worker | null {
  if (!config.notificationDeliveryEnabled) {
    workerState = 'disabled'
    logger.info('notification_delivery.worker_disabled')
    return null
  }

  const connection = getRedisConnection()
  if (!connection) {
    workerState = 'not_configured'
    logger.info('notification_delivery.worker_skipped_no_redis')
    return null
  }

  if (worker) return worker

  worker = new Worker(
    NOTIFICATION_DELIVERY_QUEUE,
    async (job) => {
      const deliveryId = String(job.data?.deliveryId || '')
      if (!deliveryId) {
        logger.warn('notification_delivery.job_missing_delivery_id', { jobId: job.id })
        return
      }

      const result = await processNotificationDelivery(deliveryId)

      if (result.outcome === 'retryable' && result.nextAttemptAt) {
        const delayMs = Math.max(0, result.nextAttemptAt.getTime() - Date.now())
        await publishDeliveryJob(deliveryId, delayMs)
      }
    },
    {
      connection,
      concurrency: config.notificationDeliveryWorkerConcurrency,
    }
  )

  worker.on('failed', (job, err) => {
    logger.error('notification_delivery.worker_job_failed', {
      jobId: job?.id,
      deliveryId: job?.data?.deliveryId,
      error: err.message,
    })
  })

  worker.on('error', (err) => {
    logger.error('notification_delivery.worker_error', { error: err.message })
  })

  workerState = 'started'

  logger.info('notification_delivery.worker_started', {
    concurrency: config.notificationDeliveryWorkerConcurrency,
  })

  return worker
}

export async function stopNotificationDeliveryWorker(): Promise<void> {
  if (worker) {
    await worker.close()
    worker = null
    logger.info('notification_delivery.worker_stopped')
  }
  if (workerState === 'started') workerState = 'stopped'
}

export function getNotificationDeliveryWorkerHealth(): {
  enabled: boolean
  state: 'started' | 'disabled' | 'not_configured' | 'stopped'
} {
  return { enabled: config.notificationDeliveryEnabled, state: workerState }
}
