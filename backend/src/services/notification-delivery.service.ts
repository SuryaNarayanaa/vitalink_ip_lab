import { config } from '@alias/config'
import NotificationDelivery, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
  NotificationDeliveryStatus,
} from '@alias/models/notificationdelivery.model'
import { sendPushToUser, type PushPayload } from '@alias/services/fcm.service'
import {
  incrementDeliveryMetric,
} from '@alias/services/notification-delivery.metrics'
import logger from '@alias/utils/logger'

const TERMINAL_STATUSES = new Set([
  NotificationDeliveryStatus.SUCCEEDED,
  NotificationDeliveryStatus.DEAD_LETTER,
  NotificationDeliveryStatus.SKIPPED,
])

const CLAIMABLE_STATUSES = [
  NotificationDeliveryStatus.PENDING,
  NotificationDeliveryStatus.QUEUED,
  NotificationDeliveryStatus.FAILED_RETRYABLE,
]

export type EnqueuePushInput = {
  notificationId: string
  userId: string
  title: string
  body: string
  data?: Record<string, string>
}

export function buildIdempotencyKey(
  notificationId: string,
  channel: NotificationDeliveryChannel = NotificationDeliveryChannel.FCM,
  provider: NotificationDeliveryProvider = NotificationDeliveryProvider.FIREBASE
): string {
  return `${notificationId}:${channel}:${provider}`
}

/** Strip long secrets/tokens and cap length so ops logs stay safe. */
export function sanitizeDeliveryError(error: unknown): string {
  let message: string
  if (error instanceof Error) {
    message = error.message || error.name
  } else if (typeof error === 'string') {
    message = error
  } else {
    try {
      message = JSON.stringify(error)
    } catch {
      message = String(error)
    }
  }

  return message
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, '[redacted-jwt]')
    .replace(/[A-Za-z0-9_\-]{120,}/g, '[redacted]')
    .replace(/private_key[^,]{0,40}/gi, 'private_key:[redacted]')
    .slice(0, 500)
}

function retentionExpiry(from = new Date()): Date {
  const days = config.notificationDeliveryRetentionDays
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000)
}

function computeNextAttemptAt(attempts: number): Date {
  const base = config.notificationDeliveryBaseBackoffMs
  // Exponential: base * 2^(attempts-1), capped at 1 hour.
  const delay = Math.min(base * Math.pow(2, Math.max(0, attempts - 1)), 60 * 60 * 1000)
  return new Date(Date.now() + delay)
}

function payloadDataAsRecord(
  data: Map<string, string> | Record<string, string> | undefined | null
): Record<string, string> {
  if (!data) return {}
  if (data instanceof Map) {
    return Object.fromEntries(data.entries())
  }
  return { ...data }
}

/**
 * Persist a durable outbox row for FCM delivery. Idempotent on notification_id+channel+provider.
 * Never throws for duplicate keys; returns the existing or created document.
 */
export async function createPushDeliveryOutbox(input: EnqueuePushInput) {
  const idempotencyKey = buildIdempotencyKey(input.notificationId)
  const maxAttempts = config.notificationDeliveryMaxAttempts

  const existing = await NotificationDelivery.findOne({ idempotency_key: idempotencyKey }).lean()
  if (existing) {
    incrementDeliveryMetric('duplicate_suppressed')
    logger.info('notification_delivery.duplicate_suppressed', {
      deliveryId: String(existing._id),
      notificationId: input.notificationId,
      idempotencyKey,
    })
    return { delivery: existing, created: false as const }
  }

  try {
    const created = await NotificationDelivery.create({
      notification_id: input.notificationId,
      user_id: input.userId,
      channel: NotificationDeliveryChannel.FCM,
      provider: NotificationDeliveryProvider.FIREBASE,
      status: NotificationDeliveryStatus.PENDING,
      attempts: 0,
      max_attempts: maxAttempts,
      next_attempt_at: new Date(),
      idempotency_key: idempotencyKey,
      title: input.title.slice(0, 200),
      body: input.body.slice(0, 1000),
      data: input.data ?? {},
      expires_at: retentionExpiry(),
    })
    incrementDeliveryMetric('enqueued')
    logger.info('notification_delivery.outbox_created', {
      deliveryId: String(created._id),
      notificationId: input.notificationId,
      userId: input.userId,
      channel: NotificationDeliveryChannel.FCM,
    })
    return { delivery: created, created: true as const }
  } catch (error: unknown) {
    const isDuplicate =
      Boolean(error) &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: number }).code === 11000

    if (!isDuplicate) {
      incrementDeliveryMetric('enqueue_failed')
      throw error
    }

    incrementDeliveryMetric('duplicate_suppressed')
    const existing = await NotificationDelivery.findOne({ idempotency_key: idempotencyKey })
    if (!existing) {
      incrementDeliveryMetric('enqueue_failed')
      throw error
    }
    logger.info('notification_delivery.duplicate_suppressed', {
      deliveryId: String(existing._id),
      notificationId: input.notificationId,
      idempotencyKey,
    })
    return { delivery: existing, created: false as const }
  }
}

/**
 * Best-effort: write outbox and publish to the queue when available.
 * Failures after a durable write are logged; callers should not fail clinical mutations.
 */
export async function enqueueNotificationPush(input: EnqueuePushInput): Promise<boolean> {
  let deliveryId: string | undefined
  try {
    const { delivery } = await createPushDeliveryOutbox(input)
    deliveryId = String(delivery._id)

    // Dynamic import avoids hard dependency on Redis at module load for pure unit tests.
    const { publishDeliveryJob } = await import('@alias/jobs/notification-delivery.queue')
    const published = await publishDeliveryJob(deliveryId)
    if (published) {
      await NotificationDelivery.updateOne(
        {
          _id: delivery._id,
          status: {
            $in: [
              NotificationDeliveryStatus.PENDING,
              NotificationDeliveryStatus.FAILED_RETRYABLE,
            ],
          },
        },
        { $set: { status: NotificationDeliveryStatus.QUEUED } }
      )
      incrementDeliveryMetric('queue_publish')
    } else {
      incrementDeliveryMetric('queue_publish_failed')
      logger.warn('notification_delivery.queue_unavailable', {
        deliveryId,
        notificationId: input.notificationId,
      })
    }
    // The durable outbox write succeeded. Queue publication is intentionally
    // best-effort because the recovery poller can publish/process this row later.
    return true
  } catch (error) {
    incrementDeliveryMetric('enqueue_failed')
    logger.error('notification_delivery.enqueue_failed', {
      error: sanitizeDeliveryError(error),
      deliveryId,
      notificationId: input.notificationId,
      userId: input.userId,
    })
    return false
  }
}

/**
 * Atomically claim a delivery for processing if it is due and not terminal.
 */
export async function claimDeliveryForProcessing(deliveryId: string) {
  const now = new Date()
  const claimed = await NotificationDelivery.findOneAndUpdate(
    {
      _id: deliveryId,
      status: { $in: CLAIMABLE_STATUSES },
      next_attempt_at: { $lte: now },
      $expr: { $lt: ['$attempts', '$max_attempts'] },
    },
    {
      $set: {
        status: NotificationDeliveryStatus.PROCESSING,
      },
      $inc: { attempts: 1 },
    },
    { new: true }
  )
  return claimed
}

async function markTerminal(
  deliveryId: string,
  status:
    | NotificationDeliveryStatus.SUCCEEDED
    | NotificationDeliveryStatus.SKIPPED
    | NotificationDeliveryStatus.DEAD_LETTER,
  fields: {
    provider_message_id?: string
    last_error?: string
  } = {}
) {
  await NotificationDelivery.updateOne(
    { _id: deliveryId },
    {
      $set: {
        status,
        completed_at: new Date(),
        ...fields,
      },
    }
  )
}

async function markRetryable(deliveryId: string, attempts: number, lastError: string) {
  const nextAttempt = computeNextAttemptAt(attempts)
  await NotificationDelivery.updateOne(
    { _id: deliveryId },
    {
      $set: {
        status: NotificationDeliveryStatus.FAILED_RETRYABLE,
        next_attempt_at: nextAttempt,
        last_error: lastError,
      },
    }
  )
  return nextAttempt
}

/**
 * Process one delivery: claim → FCM → terminal or retryable/dead-letter.
 * Safe to call concurrently; claim is atomic. Idempotent for terminal rows.
 */
export async function processNotificationDelivery(deliveryId: string): Promise<{
  outcome:
    | 'succeeded'
    | 'skipped'
    | 'retryable'
    | 'dead_letter'
    | 'not_claimable'
    | 'already_terminal'
  nextAttemptAt?: Date
}> {
  const existing = await NotificationDelivery.findById(deliveryId).lean()
  if (!existing) {
    return { outcome: 'not_claimable' }
  }
  if (TERMINAL_STATUSES.has(existing.status as NotificationDeliveryStatus)) {
    return { outcome: 'already_terminal' }
  }

  const delivery = await claimDeliveryForProcessing(deliveryId)
  if (!delivery) {
    // May have been claimed by another worker or not yet due.
    const again = await NotificationDelivery.findById(deliveryId).lean()
    if (again && TERMINAL_STATUSES.has(again.status as NotificationDeliveryStatus)) {
      return { outcome: 'already_terminal' }
    }
    return { outcome: 'not_claimable' }
  }

  incrementDeliveryMetric('processed')
  const payload: PushPayload = {
    title: delivery.title,
    body: delivery.body,
    data: payloadDataAsRecord(delivery.data as any),
  }

  try {
    const result = await sendPushToUser(String(delivery.user_id), payload)

    if (result.skipped) {
      await markTerminal(deliveryId, NotificationDeliveryStatus.SKIPPED, {
        last_error: result.skipReason ? `skipped:${result.skipReason}` : 'skipped',
      })
      incrementDeliveryMetric('skipped')
      logger.info('notification_delivery.skipped', {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        reason: result.skipReason,
        attempts: delivery.attempts,
      })
      return { outcome: 'skipped' }
    }

    if (result.success) {
      await markTerminal(deliveryId, NotificationDeliveryStatus.SUCCEEDED, {
        provider_message_id: result.providerMessageIds[0],
      })
      incrementDeliveryMetric('succeeded')
      logger.info('notification_delivery.succeeded', {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        successCount: result.successCount,
        permanentFailures: result.permanentFailures,
        attempts: delivery.attempts,
        providerMessageId: result.providerMessageIds[0],
      })
      return { outcome: 'succeeded' }
    }

    // Transient provider failure path
    const sanitized = sanitizeDeliveryError(
      result.errorMessage || result.errorCode || 'transient_provider_failure'
    )
    if (delivery.attempts >= delivery.max_attempts) {
      await markTerminal(deliveryId, NotificationDeliveryStatus.DEAD_LETTER, {
        last_error: sanitized,
      })
      incrementDeliveryMetric('dead_letter')
      logger.error('notification_delivery.dead_letter', {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        attempts: delivery.attempts,
        lastError: sanitized,
      })
      return { outcome: 'dead_letter' }
    }

    const nextAttemptAt = await markRetryable(deliveryId, delivery.attempts, sanitized)
    incrementDeliveryMetric('retryable')
    logger.warn('notification_delivery.retryable', {
      deliveryId,
      notificationId: String(delivery.notification_id),
      userId: String(delivery.user_id),
      attempts: delivery.attempts,
      maxAttempts: delivery.max_attempts,
      nextAttemptAt: nextAttemptAt.toISOString(),
      lastError: sanitized,
    })
    return { outcome: 'retryable', nextAttemptAt }
  } catch (error) {
    const sanitized = sanitizeDeliveryError(error)
    if (delivery.attempts >= delivery.max_attempts) {
      await markTerminal(deliveryId, NotificationDeliveryStatus.DEAD_LETTER, {
        last_error: sanitized,
      })
      incrementDeliveryMetric('dead_letter')
      logger.error('notification_delivery.dead_letter', {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        attempts: delivery.attempts,
        lastError: sanitized,
      })
      return { outcome: 'dead_letter' }
    }

    const nextAttemptAt = await markRetryable(deliveryId, delivery.attempts, sanitized)
    incrementDeliveryMetric('retryable')
    logger.warn('notification_delivery.retryable', {
      deliveryId,
      notificationId: String(delivery.notification_id),
      userId: String(delivery.user_id),
      attempts: delivery.attempts,
      nextAttemptAt: nextAttemptAt.toISOString(),
      lastError: sanitized,
    })
    return { outcome: 'retryable', nextAttemptAt }
  }
}

/**
 * Re-queue or directly process due outbox rows (PENDING / FAILED_RETRYABLE / stuck QUEUED).
 * Used when Redis was unavailable at enqueue time or after restarts.
 */
export async function recoverDueDeliveries(limit = 50): Promise<number> {
  const now = new Date()
  const due = await NotificationDelivery.find({
    status: {
      $in: [
        NotificationDeliveryStatus.PENDING,
        NotificationDeliveryStatus.QUEUED,
        NotificationDeliveryStatus.FAILED_RETRYABLE,
      ],
    },
    next_attempt_at: { $lte: now },
    $expr: { $lt: ['$attempts', '$max_attempts'] },
  })
    .sort({ next_attempt_at: 1 })
    .limit(limit)
    .select({ _id: 1 })
    .lean()

  if (!due.length) return 0

  let claimed = 0
  const { publishDeliveryJob, isNotificationQueueAvailable } = await import(
    '@alias/jobs/notification-delivery.queue'
  )

  for (const row of due) {
    const id = String(row._id)
    claimed += 1
    incrementDeliveryMetric('recovery_claimed')

    if (isNotificationQueueAvailable()) {
      const published = await publishDeliveryJob(id, 0)
      if (published) {
        await NotificationDelivery.updateOne(
          {
            _id: id,
            status: {
              $in: [
                NotificationDeliveryStatus.PENDING,
                NotificationDeliveryStatus.FAILED_RETRYABLE,
              ],
            },
          },
          { $set: { status: NotificationDeliveryStatus.QUEUED } }
        )
        continue
      }
    }

    // Fallback: process inline when the queue is down (best-effort recovery).
    await processNotificationDelivery(id)
  }

  logger.info('notification_delivery.recovery_pass', {
    scanned: due.length,
    claimed,
  })
  return claimed
}
