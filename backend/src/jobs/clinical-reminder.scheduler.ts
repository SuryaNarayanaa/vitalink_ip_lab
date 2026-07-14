import Notification, { NotificationPriority, NotificationType } from '@alias/models/notification.model'
import PatientProfile from '@alias/models/patientprofile.model'
import DoctorProfile from '@alias/models/doctorprofile.model'
import User from '@alias/models/user.model'
import { config } from '@alias/config'
import { cancelNotificationPush, enqueueNotificationPush } from '@alias/services/notification-delivery.service'
import { publishClinicalNotificationToUser } from '@alias/services/realtime-notification.service'
import logger from '@alias/utils/logger'
import { isFeatureEnabled } from '@alias/services/config.service'
import { hasActiveClinicalHospitalAccess } from '@alias/services/hospital-access.service'
import { endOfLocalClinicalDay, endOfLocalClinicalDateKey } from '@alias/services/notification-validity.service'

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
  deliveryValidUntil: Date
}): Promise<boolean> {
  const recipientEligible = async () => {
    if (!await isFeatureEnabled('notifications_enabled')) return false
    const user = await User.findById(input.userId).select('is_active user_type profile_id').lean()
    if (!user?.is_active || !await hasActiveClinicalHospitalAccess(user)) return false
    return isFeatureEnabled('notifications_enabled')
  }

  let notification = await Notification.findOne({ reminder_key: input.key }).lean()
  if (notification) {
    // Re-running the pass repairs an outbox write that failed after the
    // in-app notification was safely persisted. Preserve the original
    // clinical deadline; a later scheduler pass must never extend stale work.
    if (!await recipientEligible()) return false
    await enqueueNotificationPush({
      notificationId: String(notification._id), userId: input.userId, title: input.title, body: input.message, data: input.data,
      deliveryValidUntil: notification.delivery_valid_until ?? input.deliveryValidUntil,
    })
    return false
  }
  if (!await recipientEligible()) return false
  try {
    const created = await Notification.create({
      user_id: input.userId,
      type: input.type,
      priority: NotificationPriority.HIGH,
      title: input.title,
      message: input.message,
      data: input.data,
      reminder_key: input.key,
      push_delivery_required: true,
      delivery_valid_until: input.deliveryValidUntil,
    })
    notification = created.toObject()
  } catch (error: any) {
    if (error?.code === 11000) return false
    throw error
  }

  if (!await recipientEligible()) {
    await cancelNotificationPush(String(notification._id), 'recipient_became_ineligible')
    return false
  }
  await enqueueNotificationPush({
    notificationId: String(notification._id), userId: input.userId, title: input.title, body: input.message, data: input.data,
    deliveryValidUntil: input.deliveryValidUntil,
  })
  if (!await recipientEligible()) return true
  await publishClinicalNotificationToUser(input.userId, 'notification', {
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
  await Notification.init()
  const today = startOfLocalDay(now)
  const dueWindow = dateKey(now)
  const deliveryValidUntil = endOfLocalClinicalDay(now, config.dosageReminderTimezone)
  const inrCutoff = new Date(today)
  inrCutoff.setUTCDate(inrCutoff.getUTCDate() - config.inrReminderIntervalDays)
  const reviewHorizon = new Date(today)
  reviewHorizon.setUTCDate(reviewHorizon.getUTCDate() + config.nextReviewReminderLeadDays)

  const patients = await PatientProfile.find({ account_status: 'Active' }).lean()
  for (const patient of patients) {
    try {
      const patientUser = await User.findOne({ profile_id: patient._id, user_type: 'PATIENT', is_active: true }).lean()
      if (!patientUser || !await hasActiveClinicalHospitalAccess(patientUser)) continue
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
          deliveryValidUntil,
        })
        created ? result.created++ : result.skipped++
      }
      const reviewDate = patient.medical_config?.next_review_date
      if (reviewDate && new Date(reviewDate) >= today && new Date(reviewDate) <= reviewHorizon) {
        const reviewDateKey = dateKey(new Date(reviewDate))
        const created = await createReminder({
          userId: patientUserId, key: `review:${patientUserId}:${reviewDateKey}`, type: NotificationType.APPOINTMENT_REMINDER,
          title: 'Review appointment approaching', message: `Your next care review is scheduled for ${reviewDateKey}.`,
          data: { route: 'patient-details', patientId, reminderType: 'review', dueWindow },
          // Appointment reminders remain clinically relevant throughout the
          // review date, not merely on the first lead-window scheduler day.
          deliveryValidUntil: endOfLocalClinicalDateKey(reviewDateKey, config.dosageReminderTimezone),
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
          if (doctor && await hasActiveClinicalHospitalAccess(doctor)) {
            const doctorProfile = await DoctorProfile.findById(doctor.profile_id).select('hospital_id').lean()
            const patientHospitalId = patient.hospital_id ? String(patient.hospital_id) : undefined
            const doctorHospitalId = doctorProfile?.hospital_id ? String(doctorProfile.hospital_id) : undefined
            // Never disclose a patient's adherence/name to a doctor in another
            // tenant, even if legacy/corrupt assignment data points there.
            if (patientHospitalId && doctorHospitalId && doctorHospitalId === patientHospitalId) {
              recipients.push(String(doctor._id))
            }
          }
        }
        for (const userId of recipients) {
          const created = await createReminder({
            userId, key: `missed-dose:${userId}:${patientId}:${dueWindow}`, type: NotificationType.CRITICAL_ALERT,
            title: 'Medication doses need attention', message: `${patient.demographics?.name ?? 'A patient'} has missed ${missed} scheduled doses in the last ${config.missedDoseEscalationWindowDays} days.`,
            data: { route: userId === patientUserId ? 'patient-take-dosage' : 'doctor-dashboard', patientId, reminderType: 'missed-dose', dueWindow },
            deliveryValidUntil,
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
