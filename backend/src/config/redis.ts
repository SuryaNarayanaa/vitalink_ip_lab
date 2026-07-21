import Redis from 'ioredis'
import { config } from '@alias/config'
import logger from '@alias/utils/logger'

let sharedClient: Redis | null = null
let subscriberClient: Redis | null = null
let initFailed = false

function parseRedisUrl(url: string): {
  host: string
  port: number
  username?: string
  password?: string
  tls?: object
} {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
    }
  } catch {
    const [host, portRaw] = url.split(':')
    return {
      host: host || '127.0.0.1',
      port: portRaw ? Number(portRaw) : 6379,
    }
  }
}

export function isRedisConfigured(): boolean {
  return Boolean(config.redisUrl?.trim())
}

/**
 * Shared Redis client for rate limiting, single-use tickets, and pub/sub publish.
 * Returns null when REDIS_URL is unset or connection setup failed.
 */
export function getRedisClient(): Redis | null {
  const url = config.redisUrl?.trim()
  if (!url || initFailed) return null
  if (sharedClient) return sharedClient

  try {
    const opts = parseRedisUrl(url)
    sharedClient = new Redis({
      ...opts,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    })
    sharedClient.on('error', (err) => {
      logger.error('redis.client_error', { error: err.message })
    })
    return sharedClient
  } catch (error) {
    initFailed = true
    logger.error('redis.client_init_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Dedicated subscriber connection (ioredis requires a separate connection for SUBSCRIBE). */
export function getRedisSubscriber(): Redis | null {
  const url = config.redisUrl?.trim()
  if (!url || initFailed) return null
  if (subscriberClient) return subscriberClient

  try {
    const opts = parseRedisUrl(url)
    subscriberClient = new Redis({
      ...opts,
      maxRetriesPerRequest: null,
      connectTimeout: 2_000,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
    })
    subscriberClient.on('error', (err) => {
      logger.error('redis.subscriber_error', { error: err.message })
    })
    // After reconnect exhaustion the connection ends permanently. Drop the
    // sticky handle so the next getRedisSubscriber() can open a fresh socket.
    // Do not removeAllListeners here — other modules attach recovery handlers
    // that must still run for the same 'end'/'close' emission.
    const thisClient = subscriberClient
    const dropHandle = () => {
      if (subscriberClient === thisClient) subscriberClient = null
    }
    subscriberClient.on('end', dropHandle)
    subscriberClient.on('close', dropHandle)
    return subscriberClient
  } catch (error) {
    logger.error('redis.subscriber_init_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/** Test/helper: force the next getRedisSubscriber() to create a new client. */
export function resetRedisSubscriberForTests() {
  if (subscriberClient) {
    try {
      subscriberClient.removeAllListeners()
      void subscriberClient.quit().catch(() => undefined)
    } catch {
      // best-effort
    }
  }
  subscriberClient = null
}

export async function ensureRedisConnected(client: Redis | null): Promise<boolean> {
  if (!client) return false
  try {
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect()
    }
    if (client.status !== 'ready' && client.status !== 'connecting') {
      await client.connect()
    }
    // PING to confirm readiness when already connecting/ready
    if (client.status === 'ready') return true
    await client.ping()
    return true
  } catch (error) {
    logger.warn('redis.connect_failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
