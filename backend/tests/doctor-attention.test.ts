import { buildDoctorAttention, buildDoseHistory, doseRecordForDay } from '@alias/services/doctor-attention.service'

const now = new Date('2026-10-25T10:00:00Z')
const patient = () => ({
  medical_config: { therapy_start_date: '2026-10-01', target_inr: { min: 2.5, max: 3.5 }, taken_doses: ['2026-10-24'] },
  weekly_dosage: { monday: 2, tuesday: 2, wednesday: 2, thursday: 2, friday: 2, saturday: 2, sunday: 0 },
  inr_history: [] as any[],
})

test('uses individual target ranges without criticality or severity ordering', () => {
  const p = patient()
  p.inr_history = [{ inr_value: 3.2, test_date: '2026-10-24', is_critical: true, review_status: 'pending', uploaded_at: '2026-10-25' }]
  expect(buildDoctorAttention(p, now)).toMatchObject({ outside_target: false, pending_reports: 1, priority: 0 })
  p.medical_config.target_inr = { min: 2, max: 3 }
  expect(buildDoctorAttention(p, now)).toMatchObject({ outside_target: true, priority: 0 })
})

test('latest clinical result and oldest waiting upload are independent', () => {
  const p = patient()
  p.inr_history = [
    { inr_value: 3, test_date: '2026-10-24', review_status: 'reviewed' },
    { inr_value: 6, test_date: '2026-10-10', review_status: 'pending', uploaded_at: '2026-10-25' },
  ]
  expect(buildDoctorAttention(p, now)).toMatchObject({ latest_inr: { value: 3 }, pending_reports: 1, outside_target: false, waiting_since: '2026-10-25' })
})

test('historical unknown review status is not inferred from notes', () => {
  const p = patient()
  p.inr_history = [{ inr_value: 3, test_date: '2026-10-24', notes: 'Old note' }]
  expect(buildDoctorAttention(p, now)).toMatchObject({ pending_reports: 0, unknown_review_reports: 1, reasons: expect.arrayContaining(['review_unknown']) })
})

test('date-only dose states exclude today, future, pre-therapy and zero-dose days from gaps', () => {
  const p = patient()
  expect(doseRecordForDay(p, '2026-10-24', '2026-10-25').state).toBe('taken')
  expect(doseRecordForDay(p, '2026-10-23', '2026-10-25').state).toBe('not_recorded')
  expect(doseRecordForDay(p, '2026-10-25', '2026-10-25').state).toBe('not_scheduled')
  expect(doseRecordForDay(p, '2026-10-26', '2026-10-25').state).toBe('upcoming')
  expect(doseRecordForDay(p, '2026-09-30', '2026-10-25').state).toBe('not_scheduled')
  expect(doseRecordForDay({ weekly_dosage: p.weekly_dosage }, '2026-10-23', '2026-10-25').state).toBe('unknown')
})

test('calendar spans complete months and uses clinical timezone at midnight boundary', () => {
  const result = buildDoseHistory(patient(), new Date('2026-10-24T20:00:00Z'))
  expect(result.today).toBe('2026-10-25')
  expect(result.days[0]?.date).toBe('2026-08-01')
  expect(result.days.at(-1)?.date).toBe('2026-10-31')
  expect(result.days).toHaveLength(92)
})

test('missing target ranges are unknown, and review dates use clinical day boundaries', () => {
  const p: any = patient()
  delete p.medical_config.target_inr
  p.medical_config.next_review_date = '2026-10-24'
  p.inr_history = [{ inr_value: 3, test_date: '2026-10-24', review_status: 'reviewed' }]
  expect(buildDoctorAttention(p, now)).toMatchObject({ outside_target: null, reasons: expect.arrayContaining(['review_overdue']) })
})


test('patient calendar retains older recording gaps back to therapy start with identical day semantics', () => {
  const p = patient()
  p.medical_config.therapy_start_date = '2026-02-02'
  const doctor = buildDoseHistory(p, now)
  const calendar = buildDoseHistory(p, now, p.medical_config.therapy_start_date)
  expect(calendar.days[0]?.date).toBe('2026-02-01')
  expect(calendar.days.find(d => d.date === '2026-02-02')?.state).toBe('not_recorded')
  expect(calendar.days.find(d => d.date === '2026-02-01')?.state).toBe('not_scheduled')
  expect(calendar.days.filter(d => d.date >= '2026-08-01')).toEqual(doctor.days)
})
