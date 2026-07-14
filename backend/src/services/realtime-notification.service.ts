import type { Response } from 'express'
import User from '@alias/models/user.model'
import { hasActiveClinicalHospitalAccess, hasActiveHospitalAccess } from '@alias/services/hospital-access.service'
import { isFeatureEnabled } from '@alias/services/config.service'

type StreamEnvelope = {
  event: string
  data: unknown
}

const userStreams = new Map<string, Set<Response>>()

const toJson = (value: unknown) => JSON.stringify(value)

const writeSseEvent = (res: Response, envelope: StreamEnvelope) => {
  res.write(`event: ${envelope.event}\n`)
  res.write(`data: ${toJson(envelope.data)}\n\n`)
}

const removeClient = (userId: string, res: Response) => {
  const streams = userStreams.get(userId)
  if (!streams) return
  streams.delete(res)
  if (streams.size === 0) {
    userStreams.delete(userId)
  }
}

export function registerUserNotificationStream(userId: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const streams = userStreams.get(userId) ?? new Set<Response>()
  streams.add(res)
  userStreams.set(userId, streams)

  writeSseEvent(res, {
    event: 'connected',
    data: { connected: true, timestamp: new Date().toISOString() }
  })

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat)
      removeClient(userId, res)
      return
    }
    res.write(': ping\n\n')
  }, 25000)

  const cleanup = () => {
    clearInterval(heartbeat)
    removeClient(userId, res)
  }

  res.on('close', cleanup)
  res.on('error', cleanup)

  return cleanup
}

export function publishNotificationToUser(userId: string, event: string, data: unknown) {
  const streams = userStreams.get(userId)
  if (!streams || streams.size === 0) return

  for (const res of streams) {
    if (res.writableEnded || res.destroyed) {
      removeClient(userId, res)
      continue
    }

    try {
      writeSseEvent(res, { event, data })
    } catch {
      removeClient(userId, res)
    }
  }
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

