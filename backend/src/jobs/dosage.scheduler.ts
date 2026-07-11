import cron from 'node-cron'
import { Notification, PatientProfile, User } from '@alias/models'
import { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import { enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import logger from '@alias/utils/logger'

type PushEnqueuer = (input: Parameters<typeof enqueueNotificationPush>[0]) => Promise<boolean>

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Creates at most one dosage notification and push outbox row per patient/day. */
export async function runDosageReminderPass(
  now = new Date(),
  enqueuePush: PushEnqueuer = enqueueNotificationPush
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0
  let skipped = 0
  let failed = 0

  try {
    logger.info('[DosageScheduler] Running daily dosage reminder...')
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase()
    const dueWindow = localDateKey(now)
    const patients = await PatientProfile.find({
      [`weekly_dosage.${dayOfWeek}`]: { $gt: 0 },
      account_status: 'Active',
    }).lean()

    for (const patient of patients) {
      try {
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
          route: 'patient-details',
          patientId: String(patient._id),
          reminderType: 'dosage',
          dueWindow,
        }

        let inserted = false
        try {
          const write = await Notification.updateOne(
            { reminder_key: reminderKey },
            { $setOnInsert: {
              user_id: user._id,
              type: NotificationType.DOSAGE_REMINDER,
              priority: NotificationPriority.HIGH,
              title,
              message,
              data,
              reminder_key: reminderKey,
            } },
            { upsert: true }
          )
          inserted = write.upsertedCount === 1
        } catch (error) {
          // Concurrent upserts can race before the unique index resolves them.
          const duplicate = typeof error === 'object' && error !== null &&
            'code' in error && (error as { code?: number }).code === 11000
          if (!duplicate) throw error
        }

        const notification = await Notification.findOne({ reminder_key: reminderKey }).lean()
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
          logger.info(`[DosageScheduler] Reminder created for patient ${user._id}`)
        } else {
          skipped += 1
          logger.info(`[DosageScheduler] Existing reminder delivery verified for patient ${user._id}`)
        }
      } catch (err) {
        failed += 1
        logger.error(`[DosageScheduler] Failed for patient ${patient._id}`, { err })
      }
    }
  } catch (err) {
    failed += 1
    logger.error('[DosageScheduler] Cron job failed', { err })
  }

  return { created, skipped, failed }
}

cron.schedule('0 9 * * *', () => {
  void runDosageReminderPass()
})

logger.info('[DosageScheduler] Dosage reminder cron registered - fires daily at 9:00 AM')
