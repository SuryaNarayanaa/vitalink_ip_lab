import { Notification } from '@alias/models'
import User from '@alias/models/user.model'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import { publishClinicalNotificationToUser } from '@alias/services/realtime-notification.service'
import { cancelNotificationPush, enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import logger from '@alias/utils/logger'
import { isFeatureEnabled } from '@alias/services/config.service'
import { hasActiveClinicalHospitalAccess } from '@alias/services/hospital-access.service'

export type DoctorChangeType =
  | 'DOCTOR_REASSIGNED'
  | 'DOSAGE_UPDATED'
  | 'REPORT_UPDATED'
  | 'NEXT_REVIEW_UPDATED'
  | 'INSTRUCTIONS_UPDATED'

type CreateDoctorUpdateNotificationInput = {
  patientUserId: unknown
  changedByDoctorId: unknown
  changeType: DoctorChangeType
  title: string
  message: string
  changedFields?: string[]
  priority?: NotificationPriority
}

export async function createDoctorUpdateNotification(input: CreateDoctorUpdateNotificationInput) {
  try {
    if (!await isFeatureEnabled('notifications_enabled')) return null
    const patient = await User.findById(input.patientUserId)
      .select('is_active user_type profile_id')
      .lean()
    if (!patient?.is_active || !await hasActiveClinicalHospitalAccess(patient)) return null

    // Close the feature-flag race across the eligibility reads. No in-app
    // clinical record should be created after the operational pause begins.
    if (!await isFeatureEnabled('notifications_enabled')) return null

    const created = await Notification.create({
      user_id: String(input.patientUserId),
      type: NotificationType.DOCTOR_UPDATE,
      priority: input.priority ?? NotificationPriority.HIGH,
      title: input.title,
      message: input.message,
      data: {
        change_type: input.changeType,
        changed_fields: (input.changedFields ?? []).join(','),
        changed_by_doctor_id: input.changedByDoctorId,
      },
      push_delivery_required: true,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    })

    if (!created) {
      throw new Error('Failed to create doctor update notification')
    }

    // Close the pre-create tenant-state race before any outbox or realtime
    // disclosure. This record is request-owned and has not been published yet.
    const stillEligible = await User.findById(input.patientUserId)
      .select('is_active user_type profile_id')
      .lean()
    if (!await isFeatureEnabled('notifications_enabled') ||
      !stillEligible?.is_active || !await hasActiveClinicalHospitalAccess(stillEligible)) {
      await cancelNotificationPush(String(created._id), 'recipient_became_ineligible')
      return null
    }

    // Revalidate at the stream boundary because a tenant transition may begin
    // after persistence. The clinical publisher fails closed for stale streams.
    if (!await isFeatureEnabled('notifications_enabled')) {
      await cancelNotificationPush(String(created._id), 'notifications_paused')
      return null
    }
    const published = await publishClinicalNotificationToUser(String(input.patientUserId), 'doctor_update', {
      id: String(created._id),
      title: created.title,
      message: created.message,
      type: created.type,
      priority: created.priority,
      is_read: created.is_read,
      created_at: created.createdAt,
      data: created.data,
    })
    if (!published) {
      await cancelNotificationPush(String(created._id), 'clinical_realtime_ineligible')
      return null
    }

    // Await the durable outbox write. Redis publication remains best-effort in
    // enqueueNotificationPush, so this does not couple clinical writes to Redis.
    // Recheck at the independently durable outbox boundary as well. If the
    // pause begins after realtime publication, no subsequent push work starts.
    if (!await isFeatureEnabled('notifications_enabled')) return created
    const outboxPersisted = await enqueueNotificationPush({
      notificationId: String(created._id),
      userId: String(input.patientUserId),
      title: created.title,
      body: created.message,
      data: { change_type: input.changeType },
    })
    if (!outboxPersisted) {
      logger.error('notification_delivery.doctor_update_outbox_missing', {
        notificationId: String(created._id),
        patientUserId: String(input.patientUserId),
        changeType: input.changeType,
      })
    }

    return created
  } catch (error) {
    // The clinical mutation is already committed before this helper runs. A
    // notification outage must not turn that successful mutation into a 500.
    logger.error('notification_delivery.doctor_update_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      patientUserId: String(input.patientUserId),
      changeType: input.changeType,
    })
    return null
  }
}
