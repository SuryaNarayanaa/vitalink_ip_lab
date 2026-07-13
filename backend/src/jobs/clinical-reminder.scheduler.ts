import Notification, { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import PatientProfile from '@alias/models/patientprofile.model'
import User from '@alias/models/user.model'
import { config } from '@alias/config'
import { enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import { publishNotificationToUser } from '@alias/services/realtime-notification.service'
import logger from '@alias/utils/logger'
import { isFeatureEnabled } from '@alias/services/config.service'

type ReminderResult = { created: number; skipped: number; failed: number }

function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.dosageReminderTimezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(`${dateKey(date)}T00:00:00.000Z`)
}

async function createReminder(input: {
  userId: string
  key: string
  type: NotificationType
  title: string
  message: string
  data: Record<string, string>
}): Promise<boolean> {
  let notification = await Notification.findOne({ reminder_key: input.key }).lean()
  if (notification) {
    // Re-running the pass repairs an outbox write that failed after the
    // in-app notification was safely persisted.
    await enqueueNotificationPush({
      notificationId: String(notification._id), userId: input.userId, title: input.title, body: input.message, data: input.data,
    })
    return false
  }
  try {
    const created = await Notification.create({
      user_id: input.userId,
      type: input.type,
      priority: NotificationPriority.HIGH,
      title: input.title,
      message: input.message,
      data: input.data,
      reminder_key: input.key,
    })
    notification = created.toObject()
  } catch (error: any) {
    if (error?.code === 11000) return false
    throw error
  }

  await enqueueNotificationPush({
    notificationId: String(notification._id), userId: input.userId, title: input.title, body: input.message, data: input.data,
  })
  publishNotificationToUser(input.userId, 'notification', {
    id: String(notification._id), title: input.title, message: input.message,
    type: input.type, priority: NotificationPriority.HIGH, is_read: false,
    created_at: notification.createdAt?.toISOString() ?? new Date().toISOString(), data: input.data,
  })
  return true
}

/** Daily INR/review reminders and missed-dose escalation. All reminders are idempotent per recipient and local day. */
export async function runClinicalReminderPass(now = new Date()): Promise<ReminderResult> {
  const result: ReminderResult = { created: 0, skipped: 0, failed: 0 }
  if (!await isFeatureEnabled('notifications_enabled')) return result
  const today = startOfLocalDay(now)
  const dueWindow = dateKey(now)
  const inrCutoff = new Date(today)
  inrCutoff.setUTCDate(inrCutoff.getUTCDate() - config.inrReminderIntervalDays)
  const reviewHorizon = new Date(today)
  reviewHorizon.setUTCDate(reviewHorizon.getUTCDate() + config.nextReviewReminderLeadDays)

  const patients = await PatientProfile.find({ account_status: 'Active' }).lean()
  for (const patient of patients) {
    try {
      const patientUser = await User.findOne({ profile_id: patient._id, user_type: 'PATIENT', is_active: true }).lean()
      if (!patientUser) continue
      const patientId = String(patient._id)
      const patientUserId = String(patientUser._id)
      const therapyStart = patient.medical_config?.therapy_start_date
      const therapyStartKey = therapyStart ? dateKey(new Date(therapyStart)) : undefined
      if (therapyStartKey && therapyStartKey > dateKey(now)) continue
      const history = [...(patient.inr_history ?? [])].sort((a: any, b: any) => +new Date(b.test_date) - +new Date(a.test_date))
      const lastInr = history[0]?.test_date ?? patient.medical_config?.therapy_start_date
      if (lastInr && new Date(lastInr) <= inrCutoff) {
        const created = await createReminder({
          userId: patientUserId, key: `inr:${patientUserId}:${dueWindow}`, type: NotificationType.INR_REMINDER,
          title: 'INR test due', message: 'Please submit your INR test result so your care team can review it.',
          data: { route: 'patient-update-inr', patientId, reminderType: 'inr', dueWindow },
        })
        created ? result.created++ : result.skipped++
      }
      const reviewDate = patient.medical_config?.next_review_date
      if (reviewDate && new Date(reviewDate) >= today && new Date(reviewDate) <= reviewHorizon) {
        const created = await createReminder({
          userId: patientUserId, key: `review:${patientUserId}:${dateKey(new Date(reviewDate))}`, type: NotificationType.APPOINTMENT_REMINDER,
          title: 'Review appointment approaching', message: `Your next care review is scheduled for ${dateKey(new Date(reviewDate))}.`,
          data: { route: 'patient-details', patientId, reminderType: 'review', dueWindow },
        })
        created ? result.created++ : result.skipped++
      }
      const taken = new Set((patient.medical_config?.taken_doses ?? []).map((d: any) => dateKey(new Date(d))))
      const missed = [...Array(config.missedDoseEscalationWindowDays)].filter((_, index) => {
        const day = new Date(today); day.setUTCDate(day.getUTCDate() - index - 1)
        if (therapyStartKey && dateKey(day) < therapyStartKey) return false
        const weekday = new Intl.DateTimeFormat('en-US', { timeZone: config.dosageReminderTimezone, weekday: 'long' }).format(day).toLowerCase()
        return Number((patient.weekly_dosage as any)?.[weekday] ?? 0) > 0 && !taken.has(dateKey(day))
      }).length
      if (missed >= config.missedDoseEscalationThreshold) {
        const recipients = [patientUserId]
        if (patient.assigned_doctor_id) {
          // Current patient creation/reassignment flows store the doctor User._id.
          // Keep the profile lookup while legacy records are migrated.
          const doctor = await User.findOne({
            user_type: 'DOCTOR',
            is_active: true,
            $or: [
              { _id: patient.assigned_doctor_id },
              { profile_id: patient.assigned_doctor_id },
            ],
          }).lean()
          if (doctor) recipients.push(String(doctor._id))
        }
        for (const userId of recipients) {
          const created = await createReminder({
            userId, key: `missed-dose:${userId}:${patientId}:${dueWindow}`, type: NotificationType.CRITICAL_ALERT,
            title: 'Medication doses need attention', message: `${patient.demographics?.name ?? 'A patient'} has missed ${missed} scheduled doses in the last ${config.missedDoseEscalationWindowDays} days.`,
            data: { route: userId === patientUserId ? 'patient-take-dosage' : 'doctor-dashboard', patientId, reminderType: 'missed-dose', dueWindow },
          })
          created ? result.created++ : result.skipped++
        }
      }
    } catch (error) {
      result.failed++
      logger.error('clinical_reminder.failed', { patientId: String(patient._id), error: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
