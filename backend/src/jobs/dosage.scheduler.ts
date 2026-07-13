import cron from 'node-cron'
import Notification from '@alias/models/notification.model'
import PatientProfile from '@alias/models/patientprofile.model'
import User from '@alias/models/user.model'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import { enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import { publishNotificationToUser } from '@alias/services/realtime-notification.service'
import { config } from '@alias/config'
import { runClinicalReminderPass } from '@alias/jobs/clinical-reminder.scheduler'
import logger from '@alias/utils/logger'
import { isFeatureEnabled } from '@alias/services/config.service'

type PushEnqueuer = (input: Parameters<typeof enqueueNotificationPush>[0]) => Promise<boolean>
type NotificationPublisher = typeof publishNotificationToUser

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
  publish: NotificationPublisher = publishNotificationToUser
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0
  let skipped = 0
  let failed = 0

  try {
    if (!await isFeatureEnabled('notifications_enabled')) return { created, skipped, failed }
    logger.info('[DosageScheduler] Running daily dosage reminder...')
    const { dayOfWeek, dueWindow } = reminderDateParts(now, config.dosageReminderTimezone)
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
        if (!user) continue

        const dose = (patient.weekly_dosage as any)[dayOfWeek]
        const drugName = patient.medical_config?.therapy_drug ?? 'your medication'
        const userId = String(user._id)
        const reminderKey = `dosage:${userId}:${dueWindow}`
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
          try {
            const created = await Notification.create({
              user_id: user._id,
              type: NotificationType.DOSAGE_REMINDER,
              priority: NotificationPriority.HIGH,
              title,
              message,
              data,
              reminder_key: reminderKey,
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

        const persisted = await enqueuePush({
          notificationId: String(notification._id),
          userId,
          title,
          body: message,
          data,
        })
        if (!persisted) {
          throw new Error('Dosage push delivery outbox could not be persisted')
        }

        if (inserted) {
          created += 1
          publish(userId, 'notification', {
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
  cron.schedule(config.dosageReminderCron, () => {
    void runDosageReminderPass()
    void runClinicalReminderPass()
  }, { timezone: config.dosageReminderTimezone })

  logger.info('[DosageScheduler] Dosage reminder cron registered', {
    cron: config.dosageReminderCron,
    timezone: config.dosageReminderTimezone,
  })
}
