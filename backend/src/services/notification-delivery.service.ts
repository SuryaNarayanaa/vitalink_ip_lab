import { config } from '@alias/config'
import crypto from 'crypto'
import NotificationDelivery, {
  NotificationDeliveryChannel,
  NotificationDeliveryProvider,
  NotificationRecipientPolicy,
  NotificationDeliveryStatus,
} from '@alias/models/notificationdelivery.model'
import { sendPushToUser, type PushPayload } from '@alias/services/fcm.service'
import {
  incrementDeliveryMetric,
} from '@alias/services/notification-delivery.metrics'
import logger from '@alias/utils/logger'
import { isFeatureEnabled } from '@alias/services/config.service'
import User from '@alias/models/user.model'
import Notification from '@alias/models/notification.model'
import { hasActiveClinicalHospitalAccess, hasActiveHospitalAccess } from '@alias/services/hospital-access.service'
import { NotificationType } from '@alias/models/notification.model'
import { endOfLocalClinicalDateKey } from '@alias/services/notification-validity.service'
import { dateOnlyStringKey } from '@alias/utils/dateOnly'
import type { ClientSession } from 'mongoose'

const SCHEDULED_CLINICAL_TYPES = new Set<string>([
  NotificationType.DOSAGE_REMINDER,
  NotificationType.INR_REMINDER,
  NotificationType.CRITICAL_ALERT,
  NotificationType.APPOINTMENT_REMINDER,
])

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

function expiredProcessingClaimFilter(now: Date) {
  const leaseExpiry = new Date(now.getTime() - config.notificationDeliveryProcessingLeaseMs)
  return {
    status: NotificationDeliveryStatus.PROCESSING,
    $or: [
      { processing_started_at: { $lte: leaseExpiry } },
      // Rows created before leases were introduced still need a safe recovery path.
      { processing_started_at: { $exists: false }, updatedAt: { $lte: leaseExpiry } },
    ],
  }
}

export type EnqueuePushInput = {
  notificationId: string
  userId: string
  title: string
  body: string
  data?: Record<string, string>
  deliveryValidUntil?: Date
}

function policyForType(type: unknown): NotificationRecipientPolicy | undefined {
  if (!Object.values(NotificationType).includes(String(type) as NotificationType)) return undefined
  return [NotificationType.SYSTEM_ANNOUNCEMENT, NotificationType.GENERAL]
    .includes(String(type) as NotificationType)
    ? NotificationRecipientPolicy.GENERAL
    : NotificationRecipientPolicy.CLINICAL
}

async function trustedParent(notificationId: string, session?: ClientSession) {
  return Notification.findById(notificationId)
    .select('user_id type title message push_delivery_required push_delivery_cancelled_at delivery_valid_until data reminder_key')
    .session(session ?? null)
    .lean()
}

async function terminalizeCancelledOutbox(
  notificationId: string,
  reason = 'skipped:notification_cancelled',
  session?: ClientSession,
) {
  await NotificationDelivery.updateMany(
    {
      notification_id: notificationId,
      $or: [
        { status: { $in: CLAIMABLE_STATUSES } },
        {
          status: NotificationDeliveryStatus.PROCESSING,
          provider_handoff_at: { $exists: false },
        },
      ],
    },
    { $set: { status: NotificationDeliveryStatus.SKIPPED, completed_at: new Date(), last_error: reason },
      $unset: { processing_started_at: 1, processing_lease_id: 1, recovery_lease_id: 1, recovery_lease_expires_at: 1 } },
    { session },
  )
}

export async function cancelNotificationPush(notificationId: string, reason: string): Promise<void> {
  await Notification.updateOne(
    { _id: notificationId },
    { $set: { push_delivery_required: false, push_delivery_cancelled_at: new Date(), push_delivery_cancellation_reason: reason } },
  )
  await terminalizeCancelledOutbox(notificationId)
}

async function resolveDeliveryValidity(input: EnqueuePushInput, session?: ClientSession): Promise<{
  deliveryValidUntil?: Date
  scheduledClinical: boolean
}> {
  if (input.deliveryValidUntil) {
    return { deliveryValidUntil: input.deliveryValidUntil, scheduledClinical: false }
  }
  const notification = await Notification.findById(input.notificationId)
    .select('type data reminder_key delivery_valid_until')
    .session(session ?? null)
    .lean()
  if (!notification) return { scheduledClinical: false }
  if (notification.delivery_valid_until) {
    return { deliveryValidUntil: notification.delivery_valid_until, scheduledClinical: false }
  }
  const scheduledClinical = SCHEDULED_CLINICAL_TYPES.has(String(notification.type))
  if (!scheduledClinical) return { scheduledClinical: false }

  const data = notification.data as { dueWindow?: unknown } | undefined
  let dateKey = typeof data?.dueWindow === 'string' ? data.dueWindow : undefined
  if (notification.type === NotificationType.APPOINTMENT_REMINDER) {
    const match = String(notification.reminder_key ?? '').match(/(\d{4}-\d{2}-\d{2})$/)
    if (match) dateKey = match[1]
  }
  const deliveryValidUntil = dateKey && dateOnlyStringKey(dateKey) === dateKey
    ? endOfLocalClinicalDateKey(dateKey, config.dosageReminderTimezone)
    : undefined
  if (deliveryValidUntil) {
    await Notification.updateOne(
      { _id: notification._id, delivery_valid_until: { $exists: false } },
      { $set: { delivery_valid_until: deliveryValidUntil } },
      { session },
    )
  }
  return { deliveryValidUntil, scheduledClinical }
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
export async function createPushDeliveryOutbox(input: EnqueuePushInput, session?: ClientSession) {
  const parent = await trustedParent(input.notificationId, session)
  const recipientPolicy = parent && policyForType(parent.type)
  const parentTrusted = Boolean(parent && recipientPolicy && String(parent.user_id) === String(input.userId))
  // The durable parent is the auditable notification intent. Callers may
  // identify it, but must not replace its content or extend its deadline.
  const parentData = parent ? payloadDataAsRecord(parent.data as any) : {}
  const validity = await resolveDeliveryValidity({
    ...input,
    deliveryValidUntil: parent?.delivery_valid_until,
  }, session)
  const deliveryValidUntil = validity.deliveryValidUntil
  const idempotencyKey = buildIdempotencyKey(input.notificationId)
  const maxAttempts = config.notificationDeliveryMaxAttempts
  const cancelledOrMissingParent = !parentTrusted || !parent?.push_delivery_required || Boolean(parent?.push_delivery_cancelled_at)
  const missingScheduledValidity = validity.scheduledClinical && !deliveryValidUntil
  const expiredBeforeEnqueue = missingScheduledValidity || Boolean(deliveryValidUntil && deliveryValidUntil <= new Date())
  const terminalReason = cancelledOrMissingParent
    ? 'skipped:notification_missing_or_cancelled'
    : missingScheduledValidity
    ? 'skipped:missing_delivery_validity'
    : 'skipped:expired_notification'

  const existing = await NotificationDelivery.findOne({ idempotency_key: idempotencyKey }).session(session ?? null).lean()
  if (existing) {
    if (parentTrusted && existing.attempts === 0 &&
        !TERMINAL_STATUSES.has(existing.status as NotificationDeliveryStatus)) {
      const durablePayload = {
        title: String(parent!.title).slice(0, 200),
        body: String(parent!.message).slice(0, 1000),
        data: parentData,
      }
      await NotificationDelivery.updateOne(
        { _id: existing._id, attempts: 0, status: { $in: CLAIMABLE_STATUSES } },
        { $set: durablePayload },
        { session },
      )
      existing.title = durablePayload.title
      existing.body = durablePayload.body
      existing.data = durablePayload.data as any
    }
    if (!existing.recipient_policy && parentTrusted) {
      const adopted = await NotificationDelivery.updateOne(
        { _id: existing._id, recipient_policy: { $exists: false } },
        { $set: { recipient_policy: recipientPolicy, notification_type: String(parent!.type) } },
        { session },
      )
      if (adopted.modifiedCount) {
        existing.recipient_policy = recipientPolicy
        existing.notification_type = String(parent!.type)
      }
    }
    if (cancelledOrMissingParent && !TERMINAL_STATUSES.has(existing.status as NotificationDeliveryStatus)) {
      await terminalizeCancelledOutbox(input.notificationId, terminalReason, session)
      existing.status = NotificationDeliveryStatus.SKIPPED
      return { delivery: existing, created: false as const }
    }
    if (!existing.delivery_valid_until && deliveryValidUntil) {
      const adopted = await NotificationDelivery.updateOne(
        { _id: existing._id, delivery_valid_until: { $exists: false } },
        { $set: { delivery_valid_until: deliveryValidUntil } },
        { session },
      )
      if (adopted.modifiedCount) existing.delivery_valid_until = deliveryValidUntil
    }
    if (!existing.delivery_valid_until && missingScheduledValidity &&
        !TERMINAL_STATUSES.has(existing.status as NotificationDeliveryStatus)) {
      await NotificationDelivery.updateOne(
        { _id: existing._id, status: { $nin: [...TERMINAL_STATUSES] }, delivery_valid_until: { $exists: false } },
        { $set: { status: NotificationDeliveryStatus.SKIPPED, completed_at: new Date(), last_error: terminalReason } },
        { session },
      )
      existing.status = NotificationDeliveryStatus.SKIPPED
    }
    if (existing.delivery_valid_until && existing.delivery_valid_until <= new Date() &&
        !TERMINAL_STATUSES.has(existing.status as NotificationDeliveryStatus)) {
      await NotificationDelivery.updateOne(
        { _id: existing._id, status: { $nin: [...TERMINAL_STATUSES] }, delivery_valid_until: { $lte: new Date() } },
        { $set: { status: NotificationDeliveryStatus.SKIPPED, completed_at: new Date(), last_error: 'skipped:expired_notification' } },
        { session },
      )
      existing.status = NotificationDeliveryStatus.SKIPPED
    }
    const marked = await Notification.updateOne(
      { _id: input.notificationId, push_delivery_required: true, push_delivery_cancelled_at: { $exists: false } },
      { $set: { push_delivery_enqueued_at: new Date() } },
      { session },
    )
    if (!marked.matchedCount) await terminalizeCancelledOutbox(input.notificationId, undefined, session)
    incrementDeliveryMetric('duplicate_suppressed')
    logger.info('notification_delivery.duplicate_suppressed', {
      deliveryId: String(existing._id),
      notificationId: input.notificationId,
      idempotencyKey,
    })
    return { delivery: existing, created: false as const }
  }

  try {
    const [created] = await NotificationDelivery.create([{
      notification_id: input.notificationId,
      user_id: input.userId,
      channel: NotificationDeliveryChannel.FCM,
      provider: NotificationDeliveryProvider.FIREBASE,
      status: (cancelledOrMissingParent || expiredBeforeEnqueue) ? NotificationDeliveryStatus.SKIPPED : NotificationDeliveryStatus.PENDING,
      recipient_policy: recipientPolicy,
      notification_type: parent ? String(parent.type) : undefined,
      attempts: 0,
      max_attempts: maxAttempts,
      next_attempt_at: new Date(),
      idempotency_key: idempotencyKey,
      title: String(parent?.title ?? '').slice(0, 200),
      body: String(parent?.message ?? '').slice(0, 1000),
      data: parentData,
      delivery_valid_until: deliveryValidUntil,
      ...((cancelledOrMissingParent || expiredBeforeEnqueue)
        ? { completed_at: new Date(), last_error: terminalReason }
        : {}),
      expires_at: retentionExpiry(),
    }], { session })
    const marked = await Notification.updateOne(
      { _id: input.notificationId, push_delivery_required: true, push_delivery_cancelled_at: { $exists: false } },
      { $set: { push_delivery_enqueued_at: new Date() } },
      { session },
    )
    if (!marked.matchedCount && !TERMINAL_STATUSES.has(created.status as NotificationDeliveryStatus)) {
      await terminalizeCancelledOutbox(input.notificationId, undefined, session)
      created.status = NotificationDeliveryStatus.SKIPPED
    }
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
    const existing = await NotificationDelivery.findOne({ idempotency_key: idempotencyKey }).session(session ?? null)
    if (!existing) {
      incrementDeliveryMetric('enqueue_failed')
      throw error
    }
    const marked = await Notification.updateOne(
      { _id: input.notificationId, push_delivery_required: true, push_delivery_cancelled_at: { $exists: false } },
      { $set: { push_delivery_enqueued_at: new Date() } },
      { session },
    )
    if (!marked.matchedCount) await terminalizeCancelledOutbox(input.notificationId, undefined, session)
    logger.info('notification_delivery.duplicate_suppressed', {
      deliveryId: String(existing._id),
      notificationId: input.notificationId,
      idempotencyKey,
    })
    return { delivery: existing, created: false as const }
  }
}

/** Repair notifications committed before their corresponding durable outbox row. */
export async function reconcileMissingPushOutboxes(limit = 50): Promise<number> {
  if (!await isFeatureEnabled('notifications_enabled')) return 0
  const notifications = await Notification.find({
    push_delivery_required: true,
    push_delivery_enqueued_at: { $exists: false },
    push_delivery_cancelled_at: { $exists: false },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('_id user_id type title message delivery_valid_until')
    .lean()

  let repaired = 0
  for (const notification of notifications) {
    const persisted = await enqueueNotificationPush({
      notificationId: String(notification._id),
      userId: String(notification.user_id),
      title: notification.title,
      body: notification.message,
      data: { notification_type: String(notification.type) },
      deliveryValidUntil: notification.delivery_valid_until,
    })
    if (persisted) repaired += 1
  }
  return repaired
}

/**
 * Best-effort: write outbox and publish to the queue when available.
 * Failures after a durable write are logged; callers should not fail clinical mutations.
 */
export async function enqueueNotificationPush(input: EnqueuePushInput): Promise<boolean> {
  if (!await isFeatureEnabled('notifications_enabled')) {
    return false
  }

  let deliveryId: string | undefined
  try {
    const { delivery } = await createPushDeliveryOutbox(input)
    deliveryId = String(delivery._id)
    if (TERMINAL_STATUSES.has(delivery.status as NotificationDeliveryStatus)) return true

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
  const leaseId = crypto.randomUUID()
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
        processing_started_at: now,
        processing_lease_id: leaseId,
      },
      $inc: { attempts: 1 },
      $unset: { recovery_lease_id: 1, recovery_lease_expires_at: 1 },
    },
    { new: true }
  )
  return claimed
}

async function markTerminal(
  deliveryId: string,
  leaseId: string | undefined,
  status:
    | NotificationDeliveryStatus.SUCCEEDED
    | NotificationDeliveryStatus.SKIPPED
    | NotificationDeliveryStatus.DEAD_LETTER,
  fields: {
    provider_message_id?: string
    last_error?: string
    successful_device_token_ids?: string[]
  } = {}
) {
  const { successful_device_token_ids: successfulIds = [], ...terminalFields } = fields
  const result = await NotificationDelivery.updateOne(
    {
      _id: deliveryId,
      status: NotificationDeliveryStatus.PROCESSING,
      processing_lease_id: leaseId,
    },
    {
      $set: {
        status,
        completed_at: new Date(),
        ...terminalFields,
      },
      $unset: {
        processing_started_at: 1,
        processing_lease_id: 1,
        provider_handoff_at: 1,
        recovery_lease_id: 1,
        recovery_lease_expires_at: 1,
      },
      ...(successfulIds.length
        ? { $addToSet: { delivered_device_token_ids: { $each: successfulIds } } }
        : {}),
    }
  )
  return result.modifiedCount > 0
}

async function releasePausedClaim(deliveryId: string, leaseId: string | undefined) {
  const result = await NotificationDelivery.updateOne(
    {
      _id: deliveryId,
      status: NotificationDeliveryStatus.PROCESSING,
      processing_lease_id: leaseId,
      attempts: { $gt: 0 },
    },
    {
      $set: { status: NotificationDeliveryStatus.PENDING, next_attempt_at: new Date() },
      $inc: { attempts: -1 },
      $unset: {
        processing_started_at: 1,
        processing_lease_id: 1,
        provider_handoff_at: 1,
        recovery_lease_id: 1,
        recovery_lease_expires_at: 1,
      },
    },
  )
  return result.modifiedCount > 0
}

async function releaseRecoveryReservation(deliveryId: string, recoveryLeaseId: string) {
  const result = await NotificationDelivery.updateOne(
    {
      _id: deliveryId,
      recovery_lease_id: recoveryLeaseId,
      status: { $in: CLAIMABLE_STATUSES },
    },
    { $unset: { recovery_lease_id: 1, recovery_lease_expires_at: 1 } },
  )
  return result.modifiedCount > 0
}

async function markRetryable(
  deliveryId: string,
  leaseId: string | undefined,
  attempts: number,
  lastError: string,
  successfulDeviceTokenIds: string[] = []
) {
  const nextAttempt = computeNextAttemptAt(attempts)
  const result = await NotificationDelivery.updateOne(
    {
      _id: deliveryId,
      status: NotificationDeliveryStatus.PROCESSING,
      processing_lease_id: leaseId,
    },
    {
      $set: {
        status: NotificationDeliveryStatus.FAILED_RETRYABLE,
        next_attempt_at: nextAttempt,
        last_error: lastError,
      },
      $unset: {
        processing_started_at: 1,
        processing_lease_id: 1,
        provider_handoff_at: 1,
        recovery_lease_id: 1,
        recovery_lease_expires_at: 1,
      },
      ...(successfulDeviceTokenIds.length
        ? { $addToSet: { delivered_device_token_ids: { $each: successfulDeviceTokenIds } } }
        : {}),
    }
  )
  return { nextAttempt, updated: result.modifiedCount > 0 }
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
    | 'stale_lease'
    | 'paused'
  nextAttemptAt?: Date
}> {
  const existing = await NotificationDelivery.findById(deliveryId).lean()
  if (!existing) {
    return { outcome: 'not_claimable' }
  }
  if (TERMINAL_STATUSES.has(existing.status as NotificationDeliveryStatus)) {
    return { outcome: 'already_terminal' }
  }
  // Operational kill switch: leave the durable row untouched so recovery can
  // resume it after notifications are enabled again without consuming attempts.
  if (!await isFeatureEnabled('notifications_enabled')) {
    return { outcome: 'paused' }
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
  // Lock-screen / FCM provider surfaces must not carry clinical details
  // (medication names, doses, patient names, patientId, reminderType). In-app
  // records keep full content; push only carries a generic prompt plus an
  // opaque notification id so the app fetches details after auth.
  const payload: PushPayload = {
    title: 'VitaLink',
    body: 'You have a new VitaLink update',
    data: {
      notification_id: String(delivery.notification_id),
    },
  }
  const staleLease = () => {
    incrementDeliveryMetric('stale_lease')
    logger.warn('notification_delivery.stale_lease', {
      deliveryId,
      notificationId: String(delivery.notification_id),
      userId: String(delivery.user_id),
      attempts: delivery.attempts,
    })
    return { outcome: 'stale_lease' as const }
  }

  try {
    const parent = await trustedParent(String(delivery.notification_id))
    const currentParentPolicy = parent ? policyForType(parent.type) : undefined
    if (!parent || !currentParentPolicy || parent.push_delivery_cancelled_at || !parent.push_delivery_required) {
      const updated = await markTerminal(deliveryId, delivery.processing_lease_id, NotificationDeliveryStatus.SKIPPED, {
        last_error: 'skipped:notification_missing_or_cancelled',
      })
      if (!updated) return staleLease()
      incrementDeliveryMetric('skipped')
      return { outcome: 'skipped' }
    }
    let recipientPolicy = delivery.recipient_policy as NotificationRecipientPolicy | undefined
    if (!recipientPolicy) {
      recipientPolicy = policyForType(parent.type)
      if (!recipientPolicy || String(parent.user_id) !== String(delivery.user_id)) {
        const updated = await markTerminal(deliveryId, delivery.processing_lease_id, NotificationDeliveryStatus.SKIPPED, {
          last_error: 'skipped:untrusted_notification_parent',
        })
        if (!updated) return staleLease()
        incrementDeliveryMetric('skipped')
        return { outcome: 'skipped' }
      }
      await NotificationDelivery.updateOne(
        { _id: deliveryId, status: NotificationDeliveryStatus.PROCESSING, processing_lease_id: delivery.processing_lease_id,
          recipient_policy: { $exists: false } },
        { $set: { recipient_policy: recipientPolicy, notification_type: String(parent.type) } },
      )
    }
    if (delivery.delivery_valid_until && delivery.delivery_valid_until <= new Date()) {
      const updated = await markTerminal(
        deliveryId,
        delivery.processing_lease_id,
        NotificationDeliveryStatus.SKIPPED,
        { last_error: 'skipped:expired_notification' },
      )
      if (!updated) return staleLease()
      incrementDeliveryMetric('skipped')
      return { outcome: 'skipped' }
    }
    const recipient = await User.findById(delivery.user_id)
      .select('is_active user_type profile_id')
      .lean()
    if (!recipient || !recipient.is_active || !await hasActiveHospitalAccess(recipient)) {
      const previouslyDelivered = (delivery.delivered_device_token_ids ?? []).length > 0
      const updated = await markTerminal(
        deliveryId,
        delivery.processing_lease_id,
        previouslyDelivered ? NotificationDeliveryStatus.SUCCEEDED : NotificationDeliveryStatus.SKIPPED,
        { last_error: previouslyDelivered
          ? 'delivered_to_prior_device_tokens:recipient_inactive_or_unavailable'
          : 'skipped:recipient_inactive_or_unavailable' },
      )
      if (!updated) return staleLease()
      incrementDeliveryMetric(previouslyDelivered ? 'succeeded' : 'skipped')
      return { outcome: previouslyDelivered ? 'succeeded' : 'skipped' }
    }

    // Close the operational pause TOCTOU after all recipient reads and before
    // provider disclosure. Releasing the lease refunds the claimed attempt.
    if (!await isFeatureEnabled('notifications_enabled')) {
      if (!await releasePausedClaim(deliveryId, delivery.processing_lease_id)) return staleLease()
      return { outcome: 'paused' }
    }
    const result = await sendPushToUser(
      String(delivery.user_id),
      payload,
      (delivery.delivered_device_token_ids ?? []).map(String),
      delivery.delivery_valid_until,
      recipientPolicy === NotificationRecipientPolicy.GENERAL ? 'general' : 'clinical',
      async () => {
        if (!await isFeatureEnabled('notifications_enabled')) return 'notifications_paused'
        if (delivery.delivery_valid_until && delivery.delivery_valid_until <= new Date()) {
          return 'expired_notification'
        }
        const [currentParent, currentRecipient] = await Promise.all([
          trustedParent(String(delivery.notification_id)),
          User.findById(delivery.user_id).select('is_active user_type profile_id').lean(),
        ])
        const currentTypePolicy = currentParent ? policyForType(currentParent.type) : undefined
        if (!currentParent?.push_delivery_required || currentParent.push_delivery_cancelled_at ||
            !currentTypePolicy || String(currentParent.user_id) !== String(delivery.user_id)) {
          return 'notification_cancelled'
        }
        const recipientEligible = Boolean(currentRecipient?.is_active && await (
          recipientPolicy === NotificationRecipientPolicy.GENERAL
            ? hasActiveHospitalAccess(currentRecipient)
            : hasActiveClinicalHospitalAccess(currentRecipient)
        ))
        if (!recipientEligible) return 'recipient_unavailable'
        if (!await isFeatureEnabled('notifications_enabled')) return 'notifications_paused'
        if (delivery.delivery_valid_until && delivery.delivery_valid_until <= new Date()) {
          return 'expired_notification'
        }

        // This exact-lease CAS is the linearization point and the final awaited
        // operation before FCM. Cancellation either terminalizes first (CAS
        // fails) or observes this handoff and leaves provider evidence to us.
        const reserved = await NotificationDelivery.updateOne(
          {
            _id: deliveryId,
            status: NotificationDeliveryStatus.PROCESSING,
            processing_lease_id: delivery.processing_lease_id,
            provider_handoff_at: { $exists: false },
          },
          { $set: { provider_handoff_at: new Date() } },
        )
        return reserved.modifiedCount ? true : 'notification_cancelled'
      },
    )

    if (result.skipped) {
      if (result.skipReason === 'notifications_paused') {
        if (!await releasePausedClaim(deliveryId, delivery.processing_lease_id)) return staleLease()
        return { outcome: 'paused' }
      }
      if (result.skipReason === 'expired_notification') {
        const updated = await markTerminal(
          deliveryId,
          delivery.processing_lease_id,
          NotificationDeliveryStatus.SKIPPED,
          { last_error: 'skipped:expired_notification' },
        )
        if (!updated) return staleLease()
        incrementDeliveryMetric('skipped')
        return { outcome: 'skipped' }
      }
      const previouslyDelivered = (delivery.delivered_device_token_ids ?? []).length > 0
      const terminalStatus = previouslyDelivered
        ? NotificationDeliveryStatus.SUCCEEDED
        : NotificationDeliveryStatus.SKIPPED
      const updated = await markTerminal(deliveryId, delivery.processing_lease_id, terminalStatus, {
        last_error: previouslyDelivered
          ? 'delivered_to_prior_device_tokens'
          : result.skipReason ? `skipped:${result.skipReason}` : 'skipped',
      })
      if (!updated) {
        const current = await NotificationDelivery.findById(deliveryId).select('status').lean()
        if (result.skipReason === 'notification_cancelled' &&
            current?.status === NotificationDeliveryStatus.SKIPPED) {
          incrementDeliveryMetric('skipped')
          return { outcome: 'skipped' }
        }
        return staleLease()
      }
      incrementDeliveryMetric(previouslyDelivered ? 'succeeded' : 'skipped')
      logger.info('notification_delivery.skipped', {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        reason: result.skipReason,
        attempts: delivery.attempts,
      })
      return { outcome: previouslyDelivered ? 'succeeded' : 'skipped' }
    }

    if (result.success) {
      const updated = await markTerminal(deliveryId, delivery.processing_lease_id, NotificationDeliveryStatus.SUCCEEDED, {
        provider_message_id: result.providerMessageIds[0],
        successful_device_token_ids: result.successfulDeviceTokenIds,
        ...(result.failureCount > 0
          ? { last_error: `partially_delivered:permanent_failures:${result.permanentFailures}` }
          : {}),
      })
      if (!updated) return staleLease()
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
      const deliveredIds = [
        ...(delivery.delivered_device_token_ids ?? []).map(String),
        ...result.successfulDeviceTokenIds,
      ]
      const partiallyDelivered = deliveredIds.length > 0
      const updated = await markTerminal(
        deliveryId,
        delivery.processing_lease_id,
        partiallyDelivered ? NotificationDeliveryStatus.SUCCEEDED : NotificationDeliveryStatus.DEAD_LETTER,
        {
          last_error: partiallyDelivered ? `partially_delivered:${sanitized}` : sanitized,
          successful_device_token_ids: result.successfulDeviceTokenIds,
        },
      )
      if (!updated) return staleLease()
      incrementDeliveryMetric(partiallyDelivered ? 'succeeded' : 'dead_letter')
      const terminalLog = {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        attempts: delivery.attempts,
        lastError: sanitized,
      }
      if (partiallyDelivered) logger.info('notification_delivery.partially_succeeded', terminalLog)
      else logger.error('notification_delivery.dead_letter', terminalLog)
      return { outcome: partiallyDelivered ? 'succeeded' : 'dead_letter' }
    }

    const { nextAttempt, updated } = await markRetryable(
      deliveryId,
      delivery.processing_lease_id,
      delivery.attempts,
      sanitized,
      result.successfulDeviceTokenIds,
    )
    if (!updated) return staleLease()
    incrementDeliveryMetric('retryable')
    logger.warn('notification_delivery.retryable', {
      deliveryId,
      notificationId: String(delivery.notification_id),
      userId: String(delivery.user_id),
      attempts: delivery.attempts,
      maxAttempts: delivery.max_attempts,
      nextAttemptAt: nextAttempt.toISOString(),
      lastError: sanitized,
    })
    return { outcome: 'retryable', nextAttemptAt: nextAttempt }
  } catch (error) {
    const sanitized = sanitizeDeliveryError(error)
    const handedOff = await NotificationDelivery.exists({
      _id: deliveryId,
      status: NotificationDeliveryStatus.PROCESSING,
      processing_lease_id: delivery.processing_lease_id,
      provider_handoff_at: { $exists: true },
    })
    if (handedOff) {
      const previouslyDelivered = (delivery.delivered_device_token_ids ?? []).length > 0
      const updated = await markTerminal(
        deliveryId,
        delivery.processing_lease_id,
        previouslyDelivered ? NotificationDeliveryStatus.SUCCEEDED : NotificationDeliveryStatus.DEAD_LETTER,
        { last_error: previouslyDelivered
          ? `partially_delivered:provider_outcome_unknown_after_handoff:${sanitized}`
          : `provider_outcome_unknown_after_handoff:${sanitized}` },
      )
      if (!updated) return staleLease()
      incrementDeliveryMetric(previouslyDelivered ? 'succeeded' : 'dead_letter')
      return { outcome: previouslyDelivered ? 'succeeded' : 'dead_letter' }
    }
    if (delivery.attempts >= delivery.max_attempts) {
      const previouslyDelivered = (delivery.delivered_device_token_ids ?? []).length > 0
      const updated = await markTerminal(
        deliveryId,
        delivery.processing_lease_id,
        previouslyDelivered ? NotificationDeliveryStatus.SUCCEEDED : NotificationDeliveryStatus.DEAD_LETTER,
        { last_error: previouslyDelivered ? `partially_delivered:${sanitized}` : sanitized },
      )
      if (!updated) return staleLease()
      incrementDeliveryMetric(previouslyDelivered ? 'succeeded' : 'dead_letter')
      const terminalLog = {
        deliveryId,
        notificationId: String(delivery.notification_id),
        userId: String(delivery.user_id),
        attempts: delivery.attempts,
        lastError: sanitized,
      }
      if (previouslyDelivered) logger.info('notification_delivery.partially_succeeded', terminalLog)
      else logger.error('notification_delivery.dead_letter', terminalLog)
      return { outcome: previouslyDelivered ? 'succeeded' : 'dead_letter' }
    }

    const { nextAttempt, updated } = await markRetryable(deliveryId, delivery.processing_lease_id, delivery.attempts, sanitized)
    if (!updated) return staleLease()
    incrementDeliveryMetric('retryable')
    logger.warn('notification_delivery.retryable', {
      deliveryId,
      notificationId: String(delivery.notification_id),
      userId: String(delivery.user_id),
      attempts: delivery.attempts,
      nextAttemptAt: nextAttempt.toISOString(),
      lastError: sanitized,
    })
    return { outcome: 'retryable', nextAttemptAt: nextAttempt }
  }
}

/**
 * Re-queue or directly process due outbox rows, including expired PROCESSING leases.
 * Used when Redis was unavailable at enqueue time or after restarts.
 */
export async function recoverDueDeliveries(limit = 50): Promise<number> {
  // Avoid repeatedly scanning/publishing durable work while the operational
  // notification switch is paused. Rows remain due for immediate recovery.
  if (!await isFeatureEnabled('notifications_enabled')) return 0

  const now = new Date()
  const due = await NotificationDelivery.find({
    $or: [
      {
        delivery_valid_until: { $lte: now },
        $or: [
          { status: { $in: CLAIMABLE_STATUSES } },
          expiredProcessingClaimFilter(now),
        ],
      },
      {
        status: {
          $in: [
            NotificationDeliveryStatus.PENDING,
            NotificationDeliveryStatus.QUEUED,
            NotificationDeliveryStatus.FAILED_RETRYABLE,
          ],
        },
        next_attempt_at: { $lte: now },
        $expr: { $lt: ['$attempts', '$max_attempts'] },
      },
      expiredProcessingClaimFilter(now),
    ],
  })
    .sort({ next_attempt_at: 1 })
    .limit(limit)
    .select({
      _id: 1,
      status: 1,
      attempts: 1,
      max_attempts: 1,
      delivered_device_token_ids: 1,
      provider_handoff_at: 1,
      delivery_valid_until: 1,
      notification_id: 1,
      user_id: 1,
      title: 1,
      body: 1,
    })
    .lean()

  if (!due.length) return 0

  let claimed = 0
  const { publishDeliveryJob, isNotificationQueueAvailable } = await import(
    '@alias/jobs/notification-delivery.queue'
  )

  for (const row of due) {
    const id = String(row._id)
    if (!row.delivery_valid_until) {
      const validity = await resolveDeliveryValidity({
        notificationId: String(row.notification_id),
        userId: String(row.user_id),
        title: row.title,
        body: row.body,
      })
      if (validity.deliveryValidUntil) {
        const adopted = await NotificationDelivery.updateOne(
          { _id: row._id, status: { $in: CLAIMABLE_STATUSES }, delivery_valid_until: { $exists: false } },
          { $set: { delivery_valid_until: validity.deliveryValidUntil } },
        )
        if (adopted.modifiedCount) row.delivery_valid_until = validity.deliveryValidUntil
      } else if (validity.scheduledClinical) {
        const skipped = await NotificationDelivery.updateOne(
          { _id: row._id, status: { $in: CLAIMABLE_STATUSES }, delivery_valid_until: { $exists: false } },
          {
            $set: {
              status: NotificationDeliveryStatus.SKIPPED,
              completed_at: now,
              last_error: 'skipped:missing_delivery_validity',
            },
            $unset: {
              processing_started_at: 1, processing_lease_id: 1,
              recovery_lease_id: 1, recovery_lease_expires_at: 1,
            },
          },
        )
        if (skipped.modifiedCount) {
          incrementDeliveryMetric('skipped')
          continue
        }
      }
    }
    if (row.delivery_valid_until && row.delivery_valid_until <= now) {
      const expired = await NotificationDelivery.updateOne(
        { _id: row._id, status: { $in: CLAIMABLE_STATUSES }, delivery_valid_until: { $lte: now } },
        {
          $set: { status: NotificationDeliveryStatus.SKIPPED, completed_at: now, last_error: 'skipped:expired_notification' },
          $unset: { processing_started_at: 1, processing_lease_id: 1, recovery_lease_id: 1, recovery_lease_expires_at: 1 },
        },
      )
      if (expired.modifiedCount) {
        incrementDeliveryMetric('skipped')
        continue
      }
    }
    if (row.status === NotificationDeliveryStatus.PROCESSING) {
      const exhausted = row.attempts >= row.max_attempts
      const previouslyDelivered = (row.delivered_device_token_ids ?? []).length > 0
      const providerOutcomeUnknown = Boolean(row.provider_handoff_at)
      const reclaimed = await NotificationDelivery.updateOne(
        { _id: row._id, ...expiredProcessingClaimFilter(now) },
        (exhausted || providerOutcomeUnknown)
          ? {
              $set: {
                status: previouslyDelivered
                  ? NotificationDeliveryStatus.SUCCEEDED
                  : NotificationDeliveryStatus.DEAD_LETTER,
                completed_at: now,
                last_error: previouslyDelivered
                  ? 'partially_delivered:processing_lease_expired'
                  : providerOutcomeUnknown
                    ? 'provider_outcome_unknown_after_handoff'
                    : 'processing_lease_expired',
              },
              $unset: {
                processing_started_at: 1,
                processing_lease_id: 1,
                provider_handoff_at: 1,
                recovery_lease_id: 1,
                recovery_lease_expires_at: 1,
              },
            }
          : {
              $set: {
                status: NotificationDeliveryStatus.FAILED_RETRYABLE,
                next_attempt_at: now,
                last_error: 'processing_lease_expired',
              },
              $unset: {
                processing_started_at: 1,
                processing_lease_id: 1,
                provider_handoff_at: 1,
                recovery_lease_id: 1,
                recovery_lease_expires_at: 1,
              },
            }
      )
      if (!reclaimed.modifiedCount) continue
      if (exhausted || providerOutcomeUnknown) {
        incrementDeliveryMetric(previouslyDelivered ? 'succeeded' : 'dead_letter')
        continue
      }
    }

    // Reserve every due row before publishing it. Merely reading a due row is
    // not ownership: two application instances can observe the same row. The
    // expiring reservation prevents duplicate queue publications and is
    // cleared by the processing claim; if this process crashes, another
    // recovery pass can safely take over after the lease expires.
    const recoveryLeaseId = crypto.randomUUID()
    const recoveryLeaseExpiresAt = new Date(
      now.getTime() + config.notificationDeliveryProcessingLeaseMs
    )
    const reserved = await NotificationDelivery.updateOne(
      {
        _id: row._id,
        status: { $in: CLAIMABLE_STATUSES },
        next_attempt_at: { $lte: now },
        $expr: { $lt: ['$attempts', '$max_attempts'] },
        $or: [
          { recovery_lease_id: { $exists: false } },
          { recovery_lease_expires_at: { $lte: now } },
        ],
      },
      {
        $set: {
          recovery_lease_id: recoveryLeaseId,
          recovery_lease_expires_at: recoveryLeaseExpiresAt,
        },
      }
    )
    if (!reserved.modifiedCount) continue

    claimed += 1
    incrementDeliveryMetric('recovery_claimed')

    if (isNotificationQueueAvailable()) {
      const published = await publishDeliveryJob(id, 0)
      if (published) {
        await NotificationDelivery.updateOne(
          {
            _id: id,
            recovery_lease_id: recoveryLeaseId,
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
    const inlineResult = await processNotificationDelivery(id)
    // processNotificationDelivery may observe a pause before claiming the row.
    // In that case it cannot clear a recovery reservation it never adopted, so
    // release this pass's exact reservation to allow immediate resume.
    if (inlineResult.outcome === 'paused') {
      await releaseRecoveryReservation(id, recoveryLeaseId)
    }
  }

  logger.info('notification_delivery.recovery_pass', {
    scanned: due.length,
    claimed,
  })
  return claimed
}
