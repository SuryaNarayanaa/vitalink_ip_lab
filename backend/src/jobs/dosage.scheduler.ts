import cron from 'node-cron'
import Notification from '@alias/models/notification.model'
import PatientProfile from '@alias/models/patientprofile.model'
import User from '@alias/models/user.model'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import { cancelNotificationPush, enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import { publishClinicalNotificationToUser } from '@alias/services/realtime-notification.service'
import { config } from '@alias/config'
import { runClinicalReminderPass } from '@alias/jobs/clinical-reminder.scheduler'
import logger from '@alias/utils/logger'
import { isFeatureEnabled } from '@alias/services/config.service'
import { hasActiveClinicalHospitalAccess } from '@alias/services/hospital-access.service'
import { endOfLocalClinicalDay } from '@alias/services/notification-validity.service'

type PushEnqueuer = (input: Parameters<typeof enqueueNotificationPush>[0]) => Promise<boolean>
type NotificationPublisher = typeof publishClinicalNotificationToUser

function isTestRuntime(): boolean {
  return process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined || typeof (globalThis as { jest?: unknown }).jest !== 'undefined'
}

function reminderDateParts(date: Date, timezone: string): { dayOfWeek: string; dueWindow: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  return {
    dayOfWeek: value('weekday').toLowerCase(),
    dueWindow: `${value('year')}-${value('month')}-${value('day')}`,
  }
}

/** Creates at most one dosage notification and push outbox row per patient/day. */
export async function runDosageReminderPass(
  now = new Date(),
  enqueuePush: PushEnqueuer = enqueueNotificationPush,
  publish: NotificationPublisher = publishClinicalNotificationToUser
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0
  let skipped = 0
  let failed = 0

  try {
    if (!await isFeatureEnabled('notifications_enabled')) return { created, skipped, failed }
    // The reminder key is the cross-process idempotency boundary. Do not run
    // until MongoDB has confirmed the unique index exists (not merely started
    // building it in the background).
    await Notification.init()
    logger.info('[DosageScheduler] Running daily dosage reminder...')
    const { dayOfWeek, dueWindow } = reminderDateParts(now, config.dosageReminderTimezone)
    const deliveryValidUntil = endOfLocalClinicalDay(now, config.dosageReminderTimezone)
    const patients = await PatientProfile.find({
      [`weekly_dosage.${dayOfWeek}`]: { $gt: 0 },
      account_status: 'Active',
    }).lean()

    for (const patient of patients) {
      try {
        const therapyStart = patient.medical_config?.therapy_start_date
        if (therapyStart && reminderDateParts(new Date(therapyStart), config.dosageReminderTimezone).dueWindow > dueWindow) continue
        const user = await User.findOne({
          profile_id: patient._id,
          user_type: 'PATIENT',
          is_active: true,
        }).lean()
        if (!user || !await hasActiveClinicalHospitalAccess(user)) continue

        const remainsEligible = async () => {
          if (!await isFeatureEnabled('notifications_enabled')) return false
          const current = await User.findById(user._id).select('is_active user_type profile_id').lean()
          if (!current?.is_active || !await hasActiveClinicalHospitalAccess(current)) return false
          return isFeatureEnabled('notifications_enabled')
        }

        const dose = (patient.weekly_dosage as any)[dayOfWeek]
        const drugName = patient.medical_config?.therapy_drug ?? 'your medication'
        const userId = String(user._id)
        const reminderKey = `dosage:${userId}:${dueWindow}`
        // In-app notification may include therapy details; push delivery is
        // sanitized separately in notification-delivery.service.
        const title = 'Time for your medication'
        const message = `Take your ${drugName} dose - ${dose}mg today.`
        const data = {
          route: 'patient-take-dosage',
          patientId: String(patient._id),
          reminderType: 'dosage',
          dueWindow,
        }

        let inserted = false
        let notification = await Notification.findOne({ reminder_key: reminderKey }).lean()

        if (!notification) {
          if (!await remainsEligible()) {
            skipped += 1
            continue
          }
          try {
            const created = await Notification.create({
              user_id: user._id,
              type: NotificationType.DOSAGE_REMINDER,
              priority: NotificationPriority.HIGH,
              title,
              message,
              data,
              reminder_key: reminderKey,
              push_delivery_required: true,
              delivery_valid_until: deliveryValidUntil,
            })
            notification = created.toObject ? created.toObject() : created
            inserted = true
          } catch (error) {
            const duplicate = typeof error === 'object' && error !== null &&
              'code' in error && (error as { code?: number }).code === 11000
            if (!duplicate) throw error

            notification = await Notification.findOne({ reminder_key: reminderKey }).lean()
          }
        }

        if (!notification) throw new Error('Dosage notification could not be loaded')

        if (!await remainsEligible()) {
          if (inserted) await cancelNotificationPush(String(notification._id), 'recipient_became_ineligible')
          skipped += 1
          continue
        }

        const persisted = await enqueuePush({
          notificationId: String(notification._id),
          userId,
          title,
          body: message,
          data,
          deliveryValidUntil: (notification as { delivery_valid_until?: Date }).delivery_valid_until ?? deliveryValidUntil,
        })
        if (!persisted) {
          throw new Error('Dosage push delivery outbox could not be persisted')
        }

        if (inserted) {
          created += 1
          if (await remainsEligible()) await publish(userId, 'notification', {
            id: String(notification._id),
            title,
            message,
            type: NotificationType.DOSAGE_REMINDER,
            priority: NotificationPriority.HIGH,
            is_read: false,
            created_at: (notification as { createdAt?: Date }).createdAt?.toISOString() ?? new Date().toISOString(),
            data,
          })
          logger.info(`[DosageScheduler] Reminder created for patient ${user._id}`)
        } else {
          skipped += 1
          logger.info(`[DosageScheduler] Existing reminder delivery verified for patient ${user._id}`)
        }
      } catch (err) {
        failed += 1
        logger.error(`[DosageScheduler] Failed for patient ${patient._id}`, {
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        })
      }
    }
  } catch (err) {
    failed += 1
    logger.error('[DosageScheduler] Cron job failed', {
      err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
    })
  }

  return { created, skipped, failed }
}

if (!isTestRuntime()) {
  let schedulerRunning = false
  cron.schedule(config.dosageReminderCron, async () => {
    if (schedulerRunning) {
      logger.warn('[DosageScheduler] Skipping overlapping reminder pass')
      return
    }
    schedulerRunning = true
    try {
      const results = await Promise.allSettled([
        runDosageReminderPass(),
        runClinicalReminderPass(),
      ])
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.error('[DosageScheduler] Reminder pass rejected', { error: result.reason })
        }
      }
    } finally {
      schedulerRunning = false
    }
  }, { timezone: config.dosageReminderTimezone })

  logger.info('[DosageScheduler] Dosage reminder cron registered', {
    cron: config.dosageReminderCron,
    timezone: config.dosageReminderTimezone,
  })
}
