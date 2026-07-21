import crypto from 'crypto'
import type { Response } from 'express'
import User from '@alias/models/user.model'
import { hasActiveClinicalHospitalAccess, hasActiveHospitalAccess } from '@alias/services/hospital-access.service'
import { isFeatureEnabled } from '@alias/services/config.service'
import { ensureRedisConnected, getRedisClient, getRedisSubscriber, isRedisConfigured } from '@alias/config/redis'
import logger from '@alias/utils/logger'

type StreamEnvelope = {
  event: string
  data: unknown
  /** Publishing process id — subscribers ignore their own publishes to avoid double-delivery. */
  origin?: string
}

type StreamMeta = {
  res: Response
  ip: string
}

const userStreams = new Map<string, Set<StreamMeta>>()
const ipConnectionCounts = new Map<string, number>()

export const MAX_STREAMS_PER_USER = 3
export const MAX_STREAMS_PER_IP = 10

const CHANNEL_PREFIX = 'vitalink:notifications:'
/** Stable for the process lifetime so Redis echoes of local publishes are dropped. */
const INSTANCE_ID = crypto.randomUUID()

let pubSubInitialized = false
/** Single-flight guard so concurrent stream registrations share one subscribe. */
let pubSubInitPromise: Promise<void> | null = null

const toJson = (value: unknown) => JSON.stringify(value)

const waitForDrain = (res: Response): Promise<boolean> => new Promise((resolve) => {
  if (res.writableEnded || res.destroyed) {
    resolve(false)
    return
  }
  const onDrain = () => {
    cleanup()
    resolve(true)
  }
  const onClose = () => {
    cleanup()
    resolve(false)
  }
  const cleanup = () => {
    res.off('drain', onDrain)
    res.off('close', onClose)
    res.off('error', onClose)
  }
  res.once('drain', onDrain)
  res.once('close', onClose)
  res.once('error', onClose)
})

/** Write an SSE frame; when the socket buffers, wait for drain before continuing. */
const writeSseEvent = async (res: Response, envelope: StreamEnvelope): Promise<boolean> => {
  if (res.writableEnded || res.destroyed) return false
  const payload = `event: ${envelope.event}\ndata: ${toJson(envelope.data)}\n\n`
  const ok = res.write(payload)
  if (ok) return true
  return waitForDrain(res)
}

const writeSseComment = async (res: Response, comment: string): Promise<boolean> => {
  if (res.writableEnded || res.destroyed) return false
  const ok = res.write(`: ${comment}\n\n`)
  if (ok) return true
  return waitForDrain(res)
}

const removeClient = (userId: string, meta: StreamMeta) => {
  const streams = userStreams.get(userId)
  // Only decrement bookkeeping when this meta was still tracked, so duplicate
  // cleanup (close+error, write-fail+close, heartbeat) is a no-op.
  if (!streams || !streams.delete(meta)) return
  if (streams.size === 0) {
    userStreams.delete(userId)
  }
  const current = ipConnectionCounts.get(meta.ip) ?? 0
  if (current <= 1) ipConnectionCounts.delete(meta.ip)
  else ipConnectionCounts.set(meta.ip, current - 1)
}

const deliverLocally = (userId: string, event: string, data: unknown) => {
  const streams = userStreams.get(userId)
  if (!streams || streams.size === 0) return

  for (const meta of streams) {
    if (meta.res.writableEnded || meta.res.destroyed) {
      removeClient(userId, meta)
      continue
    }

    void writeSseEvent(meta.res, { event, data }).then((ok) => {
      if (!ok) removeClient(userId, meta)
    }).catch(() => {
      removeClient(userId, meta)
    })
  }
}

async function ensurePubSub(): Promise<void> {
  if (pubSubInitialized || !isRedisConfigured()) return
  if (pubSubInitPromise) return pubSubInitPromise

  pubSubInitPromise = (async () => {
    const sub = getRedisSubscriber()
    if (!sub || !(await ensureRedisConnected(sub))) return

    const onMessage = (_pattern: string, channel: string, message: string) => {
      if (!channel.startsWith(CHANNEL_PREFIX)) return
      const userId = channel.slice(CHANNEL_PREFIX.length)
      if (!userId) return
      try {
        const parsed = JSON.parse(message) as StreamEnvelope
        if (!parsed?.event) return
        // Local clients were already written by publishNotificationToUser.
        // Only apply messages that originated on other replicas.
        if (parsed.origin && parsed.origin === INSTANCE_ID) return
        deliverLocally(userId, parsed.event, parsed.data)
      } catch {
        // Ignore malformed broker payloads
      }
    }

    try {
      // Register the handler before psubscribe so early messages are not dropped.
      sub.on('pmessage', onMessage)
      await sub.psubscribe(`${CHANNEL_PREFIX}*`)
      pubSubInitialized = true
      logger.info('realtime.pubsub_subscribed')
    } catch (error) {
      sub.off('pmessage', onMessage)
      logger.warn('realtime.pubsub_subscribe_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })().finally(() => {
    // Clear in-flight state so a failed attempt can be retried later.
    if (!pubSubInitialized) pubSubInitPromise = null
  })

  return pubSubInitPromise
}

export type RegisterStreamResult =
  | { ok: true; cleanup: () => void }
  | { ok: false; reason: 'user_limit' | 'ip_limit' }

export function registerUserNotificationStream(
  userId: string,
  res: Response,
  options: { ip?: string } = {},
): RegisterStreamResult {
  const ip = options.ip || 'unknown'

  const existingForUser = userStreams.get(userId)
  if (existingForUser && existingForUser.size >= MAX_STREAMS_PER_USER) {
    return { ok: false, reason: 'user_limit' }
  }
  const ipCount = ipConnectionCounts.get(ip) ?? 0
  if (ipCount >= MAX_STREAMS_PER_IP) {
    return { ok: false, reason: 'ip_limit' }
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const meta: StreamMeta = { res, ip }
  const streams = existingForUser ?? new Set<StreamMeta>()
  streams.add(meta)
  userStreams.set(userId, streams)
  ipConnectionCounts.set(ip, ipCount + 1)

  void ensurePubSub()

  void writeSseEvent(res, {
    event: 'connected',
    data: { connected: true, timestamp: new Date().toISOString() },
  }).then((ok) => {
    if (!ok) removeClient(userId, meta)
  })

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat)
      removeClient(userId, meta)
      return
    }
    void writeSseComment(res, 'ping').then((ok) => {
      if (!ok) {
        clearInterval(heartbeat)
        removeClient(userId, meta)
      }
    })
  }, 25000)

  const cleanup = () => {
    clearInterval(heartbeat)
    removeClient(userId, meta)
  }

  res.on('close', cleanup)
  res.on('error', cleanup)

  return { ok: true, cleanup }
}

export function publishNotificationToUser(userId: string, event: string, data: unknown) {
  // Always deliver to local process connections immediately.
  deliverLocally(userId, event, data)

  // Fan-out to other replicas via Redis when configured.
  // Include origin so this process's subscriber does not re-deliver the same event.
  if (!isRedisConfigured()) return
  void (async () => {
    const client = getRedisClient()
    if (!client || !(await ensureRedisConnected(client))) return
    try {
      await client.publish(
        `${CHANNEL_PREFIX}${userId}`,
        JSON.stringify({ event, data, origin: INSTANCE_ID } satisfies StreamEnvelope),
      )
    } catch (error) {
      logger.warn('realtime.publish_failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
}

/** Final kill-switch gate for nonclinical/general realtime notifications. */
export async function publishGeneralNotificationToUser(userId: string, event: string, data: unknown) {
  if (!await isFeatureEnabled('notifications_enabled')) return false
  let user = await User.findById(userId).select('is_active user_type profile_id').lean()
  if (!user?.is_active || !await hasActiveHospitalAccess(user)) return false
  if (!await isFeatureEnabled('notifications_enabled')) return false
  // The feature read above is awaited. Refresh recipient state afterward so a
  // deactivation/suspension that wins during that read cannot leak to an
  // already-open stream. No awaited work remains before the SSE write.
  user = await User.findById(userId).select('is_active user_type profile_id').lean()
  if (!user?.is_active || !await hasActiveHospitalAccess(user)) return false
  publishNotificationToUser(userId, event, data)
  return true
}

/** Revalidate tenant state at the last boundary before clinical SSE disclosure. */
export async function publishClinicalNotificationToUser(userId: string, event: string, data: unknown) {
  if (!await isFeatureEnabled('notifications_enabled')) return false
  let user = await User.findById(userId).select('is_active user_type profile_id').lean()
  if (!user?.is_active || !await hasActiveClinicalHospitalAccess(user)) return false
  // Final provider-independent kill-switch boundary. Eligibility includes
  // awaited profile/hospital reads, during which an operator may pause all
  // notification disclosure.
  if (!await isFeatureEnabled('notifications_enabled')) return false
  user = await User.findById(userId).select('is_active user_type profile_id').lean()
  if (!user?.is_active || !await hasActiveClinicalHospitalAccess(user)) return false
  publishNotificationToUser(userId, event, data)
  return true
}
