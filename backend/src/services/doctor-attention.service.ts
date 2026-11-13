import { config } from '@alias/config'
import { calendarDateKeyInTimeZone } from '@alias/utils/dateOnly'

// Clinical date-only values are stored at UTC midnight, not as local instants.
const dayKey = (value: Date | string) => new Date(value).toISOString().slice(0, 10)
const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

export function doseRecordForDay(patient: any, date: string, today: string) {
  const start = patient.medical_config?.therapy_start_date
  const amount = Number(patient.weekly_dosage?.[weekdays[new Date(`${date}T00:00:00Z`).getUTCDay()]!] ?? 0)
  const taken = (patient.medical_config?.taken_doses ?? []).some((d: Date | string) => dayKey(d) === date)
  const state = taken ? 'taken'
    : !start ? 'unknown'
    : date < dayKey(start) || amount <= 0 ? 'not_scheduled'
    : date > today ? 'upcoming'
    : date === today ? 'pending' : 'not_recorded'
  return { date, amount, state }
}

export function buildDoseHistory(patient: any, now = new Date(), historyStart?: Date | string) {
  const today = calendarDateKeyInTimeZone(now, config.dosageReminderTimezone)
  const [year, month] = today.split('-').map(Number) as [number, number, number]
  let start = new Date(Date.UTC(year, month - 3, 1))
  if (historyStart) {
    const therapyStart = new Date(historyStart)
    if (Number.isFinite(therapyStart.getTime()) && therapyStart < start) {
      start = new Date(Date.UTC(therapyStart.getUTCFullYear(), therapyStart.getUTCMonth(), 1))
    }
  }
  const end = new Date(Date.UTC(year, month, 0))
  const days = []
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    days.push(doseRecordForDay(patient, dayKey(cursor), today))
  }
  return { today, timezone: config.dosageReminderTimezone, current_schedule_only: true, days }
}

/** Explainable workflow ordering only. No INR-based clinical urgency. */
export function buildDoctorAttention(patient: any, now = new Date()) {
  const today = calendarDateKeyInTimeZone(now, config.dosageReminderTimezone)
  const history = [...(patient.inr_history ?? [])].sort((a: any, b: any) =>
    +new Date(b.test_date) - +new Date(a.test_date) || +new Date(b.uploaded_at ?? 0) - +new Date(a.uploaded_at ?? 0))
  const latest = history[0]
  const target = patient.medical_config?.target_inr
  const validTarget = Number.isFinite(target?.min) && Number.isFinite(target?.max) && target.min < target.max
  const outside = latest && validTarget ? latest.inr_value < target.min || latest.inr_value > target.max : null
  const pending = history.filter((r: any) => r.review_status === 'pending')
  const unknown = history.filter((r: any) => !r.review_status)
  const review = patient.medical_config?.next_review_date ? dayKey(patient.medical_config.next_review_date) : null
  const cutoff = new Date(`${today}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - config.inrReminderIntervalDays)
  const lastTest = latest?.test_date ?? patient.medical_config?.therapy_start_date
  let recordingGaps = 0
  for (let i = 1; i <= config.missedDoseEscalationWindowDays; i++) {
    const date = new Date(`${today}T00:00:00Z`)
    date.setUTCDate(date.getUTCDate() - i)
    if (doseRecordForDay(patient, dayKey(date), today).state === 'not_recorded') recordingGaps++
  }
  const reasons: string[] = []
  if (pending.length) reasons.push('reports_pending')
  if (review && review < today) reasons.push('review_overdue')
  else if (review === today) reasons.push('review_today')
  if (lastTest && dayKey(lastTest) <= dayKey(cutoff)) reasons.push('inr_monitoring_gap')
  if (recordingGaps >= config.missedDoseEscalationThreshold) reasons.push('dose_recording_gap')
  if (!history.length) reasons.push('no_inr')
  if (unknown.length) reasons.push('review_unknown')
  const waitingSince = pending.map((r: any) => r.uploaded_at ?? r.test_date).sort((a: any, b: any) => +new Date(a) - +new Date(b))[0]
  return {
    reasons,
    priority: pending.length ? 0 : review && review <= today ? 1 : reasons.length ? 2 : 3,
    pending_reports: pending.length,
    unknown_review_reports: unknown.length,
    waiting_since: waitingSince ?? null,
    latest_inr: latest ? { value: latest.inr_value, test_date: latest.test_date } : null,
    target_min: validTarget ? target.min : null,
    target_max: validTarget ? target.max : null,
    outside_target: outside,
    next_review_date: review,
    recording_gaps: recordingGaps,
    recording_window_days: config.missedDoseEscalationWindowDays,
    calculated_at: now.toISOString(),
  }
}
