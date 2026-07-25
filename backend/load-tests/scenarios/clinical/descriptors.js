const API = '/api/v1'
const DOCTORS = `${API}/doctors`
const PATIENT = `${API}/patient`

function requirePathValue(context, key) {
  const value = context && context.ids ? context.ids[key] : undefined
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new Error(`Clinical operation requires context.ids.${key}`)
  }
  return encodeURIComponent(String(value))
}

function payload(context, key, fallback) {
  return context && context.payloads && context.payloads[key] !== undefined
    ? context.payloads[key]
    : typeof fallback === 'function' ? fallback() : fallback
}

function futureClinicalDate(days = 30) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${date.getUTCFullYear()}`
}

function todayClinicalDate() {
  const date = new Date()
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}-${mm}-${date.getUTCFullYear()}`
}

function envelopeWithData(dataCheck) {
  return [{
    name: 'successful API response envelope',
    validate: (response) => {
      let body
      try { body = response.json() } catch (_) { return false }
      if (!body || body.success !== true || Number(body.statusCode) !== Number(response.status) || typeof body.message !== 'string') return false
      return dataCheck ? dataCheck(body.data) : true
    },
  }]
}

function sseResponseChecks() {
  const header = (response, name) => {
    const headers = response && response.headers ? response.headers : {}
    const key = Object.keys(headers).find(item => item.toLowerCase() === name.toLowerCase())
    return key ? String(headers[key]).toLowerCase() : ''
  }
  return [
    {
      name: 'SSE response is a stream or an explicit connection-cap rejection',
      validate: response => response.status === 429 || (response.status === 200 && header(response, 'content-type').includes('text/event-stream')),
    },
    {
      name: 'SSE buffering is disabled for accepted streams',
      validate: response => response.status === 429 || header(response, 'x-accel-buffering') === 'no',
    },
  ]
}

const cleanupNone = Object.freeze({ strategy: 'none', reason: 'read-only operation' })
const postconditionRead = Object.freeze({ verify: 'response_semantics', sideEffects: 'none' })

function descriptor(input) {
  return Object.freeze({
    expectedStatuses: [200],
    destructive: false,
    fixtureKeys: [],
    cleanup: cleanupNone,
    postcondition: postconditionRead,
    semanticChecks: envelopeWithData(),
    buildPath: () => input.pathTemplate,
    ...input,
  })
}

export const DOCTOR_OPERATIONS = Object.freeze([
  descriptor({
    id: 'GET /api/v1/doctors/doctors', method: 'GET', pathTemplate: `${DOCTORS}/doctors`, role: 'doctor',
    fixtureKeys: ['tokens.doctor'],
    semanticChecks: envelopeWithData(data => Array.isArray(data && data.doctors)),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/notifications', method: 'GET', pathTemplate: `${DOCTORS}/notifications`, role: 'doctor',
    fixtureKeys: ['tokens.doctor', 'ids.notificationId'],
    buildPath: () => `${DOCTORS}/notifications?page=1&limit=20&is_read=false`,
    semanticChecks: envelopeWithData(data => Array.isArray(data && data.notifications) && Number.isFinite(data.unread_count)),
  }),
  descriptor({
    id: 'PATCH /api/v1/doctors/notifications/{notification_id}/read', method: 'PATCH', pathTemplate: `${DOCTORS}/notifications/{notification_id}/read`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor', 'ids.notificationId'],
    cleanup: { strategy: 'fixture-reseed', resource: 'doctor notification unread state' },
    postcondition: { verify: 'notification is returned as read by list endpoint', idKey: 'notificationId' },
    buildPath: context => `${DOCTORS}/notifications/${requirePathValue(context, 'notificationId')}/read`,
  }),
  descriptor({
    id: 'PATCH /api/v1/doctors/notifications/read-all', method: 'PATCH', pathTemplate: `${DOCTORS}/notifications/read-all`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor'],
    cleanup: { strategy: 'fixture-reseed', resource: 'doctor notification unread states' },
    postcondition: { verify: 'doctor unread count is zero' },
    semanticChecks: envelopeWithData(data => Number.isInteger(data && data.marked_count) && data.marked_count >= 0),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/notifications/stream', method: 'GET', pathTemplate: `${DOCTORS}/notifications/stream`, role: 'doctor',
    protocol: 'sse', expectedStatuses: [200, 429], fixtureKeys: ['tokens.doctor'],
    cleanup: { strategy: 'abort-stream', resource: 'doctor SSE connection' },
    postcondition: { verify: 'connection bookkeeping returns below configured cap' },
    semanticChecks: sseResponseChecks(),
  }),
  descriptor({
    id: 'POST /api/v1/doctors/notifications/stream-ticket', method: 'POST', pathTemplate: `${DOCTORS}/notifications/stream-ticket`, role: 'doctor',
    fixtureKeys: ['tokens.doctor'],
    cleanup: { strategy: 'consume-or-expire', ttlSeconds: 30, resource: 'single-use SSE ticket' },
    postcondition: { verify: 'ticket is accepted once and replay is rejected' },
    semanticChecks: envelopeWithData(data => typeof (data && data.ticket) === 'string' && data.ticket.length > 20),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/notifications/unread-count', method: 'GET', pathTemplate: `${DOCTORS}/notifications/unread-count`, role: 'doctor',
    fixtureKeys: ['tokens.doctor'],
    semanticChecks: envelopeWithData(data => Number.isInteger(data && data.unread_count) && data.unread_count >= 0),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/patients', method: 'GET', pathTemplate: `${DOCTORS}/patients`, role: 'doctor',
    fixtureKeys: ['tokens.doctor', 'ids.patientOpNum'],
    semanticChecks: envelopeWithData(data => Array.isArray(data && data.patients)),
  }),
  descriptor({
    id: 'POST /api/v1/doctors/patients', method: 'POST', pathTemplate: `${DOCTORS}/patients`, role: 'doctor',
    expectedStatuses: [201], destructive: true, fixtureKeys: ['tokens.doctor', 'payloads.createPatient'],
    cleanup: { strategy: 'run-ledger-finalizer', capture: ['data.patient._id', 'data.user._id'], resource: 'created patient account/profile' },
    postcondition: { verify: 'created patient is visible to owning doctor and tenant only', capture: ['patient.login_id'] },
    buildBody: context => payload(context, 'createPatient', () => ({
      name: `load_${context.runId}_patient`, op_num: `load_${context.runId}_op`, gender: 'Other',
      contact_no: '+919999999999', kin_contact_number: '+919999999998', therapy: 'Warfarin',
      prescription: { monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1 },
    })),
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient && data.user)),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/patients/{op_num}', method: 'GET', pathTemplate: `${DOCTORS}/patients/{op_num}`, role: 'doctor',
    fixtureKeys: ['tokens.doctor', 'ids.patientOpNum'],
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}`,
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient)),
  }),
  descriptor({
    id: 'PUT /api/v1/doctors/patients/{op_num}/config', method: 'PUT', pathTemplate: `${DOCTORS}/patients/{op_num}/config`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor', 'ids.patientOpNum'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient next review date' },
    postcondition: { verify: 'patient detail returns requested next review date' },
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/config`,
    buildBody: context => payload(context, 'doctorConfig', () => ({ date: futureClinicalDate(30) })),
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient)),
  }),
  descriptor({
    id: 'PUT /api/v1/doctors/patients/{op_num}/dosage', method: 'PUT', pathTemplate: `${DOCTORS}/patients/{op_num}/dosage`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor', 'ids.patientOpNum'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient weekly dosage' },
    postcondition: { verify: 'patient detail returns exact weekly dosage' },
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/dosage`,
    buildBody: context => payload(context, 'doctorDosage', { prescription: { monday: 2, tuesday: 2, wednesday: 2, thursday: 2, friday: 2, saturday: 1, sunday: 1 } }),
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient)),
  }),
  descriptor({
    id: 'PUT /api/v1/doctors/patients/{op_num}/instructions', method: 'PUT', pathTemplate: `${DOCTORS}/patients/{op_num}/instructions`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor', 'ids.patientOpNum'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient instructions' },
    postcondition: { verify: 'patient detail returns exact instruction list' },
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/instructions`,
    buildBody: context => payload(context, 'doctorInstructions', { instructions: [`Synthetic load test ${context.runId}`] }),
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient)),
  }),
  descriptor({
    id: 'PATCH /api/v1/doctors/patients/{op_num}/reassign', method: 'PATCH', pathTemplate: `${DOCTORS}/patients/{op_num}/reassign`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor', 'ids.patientOpNum', 'ids.reassignDoctorId'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient doctor assignment and assignment fence' },
    postcondition: { verify: 'old doctor loses access and new same-tenant doctor gains access' },
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/reassign`,
    buildBody: context => payload(context, 'reassignPatient', { new_doctor_id: context.ids.reassignDoctorId }),
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient)),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/patients/{op_num}/reports', method: 'GET', pathTemplate: `${DOCTORS}/patients/{op_num}/reports`, role: 'doctor',
    fixtureKeys: ['tokens.doctor', 'ids.patientOpNum', 'ids.reportId'],
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/reports`,
    semanticChecks: envelopeWithData(data => Array.isArray(data && data.inr_history)),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/patients/{op_num}/reports/{report_id}', method: 'GET', pathTemplate: `${DOCTORS}/patients/{op_num}/reports/{report_id}`, role: 'doctor',
    fixtureKeys: ['tokens.doctor', 'ids.patientOpNum', 'ids.reportId'],
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/reports/${requirePathValue(context, 'reportId')}`,
    semanticChecks: envelopeWithData(data => Boolean(data && data.report)),
  }),
  descriptor({
    id: 'PUT /api/v1/doctors/patients/{op_num}/reports/{report_id}', method: 'PUT', pathTemplate: `${DOCTORS}/patients/{op_num}/reports/{report_id}`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor', 'ids.patientOpNum', 'ids.reportId'],
    cleanup: { strategy: 'fixture-reseed', resource: 'INR report notes and critical flag' },
    postcondition: { verify: 'report detail returns requested notes and critical flag' },
    buildPath: context => `${DOCTORS}/patients/${requirePathValue(context, 'patientOpNum')}/reports/${requirePathValue(context, 'reportId')}`,
    buildBody: context => payload(context, 'updateReport', { is_critical: false, notes: `Synthetic load test ${context.runId}` }),
    semanticChecks: envelopeWithData(data => Boolean(data && data.report)),
  }),
  descriptor({
    id: 'GET /api/v1/doctors/profile', method: 'GET', pathTemplate: `${DOCTORS}/profile`, role: 'doctor',
    fixtureKeys: ['tokens.doctor'],
    semanticChecks: envelopeWithData(data => Boolean(data && typeof data === 'object')),
  }),
  descriptor({
    id: 'PUT /api/v1/doctors/profile', method: 'PUT', pathTemplate: `${DOCTORS}/profile`, role: 'doctor',
    destructive: true, fixtureKeys: ['tokens.doctor'],
    cleanup: { strategy: 'fixture-reseed', resource: 'doctor profile fields' },
    postcondition: { verify: 'doctor profile returns updated values' },
    buildBody: context => payload(context, 'doctorProfile', { department: 'Synthetic Load Test' }),
  }),
  descriptor({
    id: 'POST /api/v1/doctors/profile-pic', method: 'POST', pathTemplate: `${DOCTORS}/profile-pic`, role: 'doctor', transport: 'multipart',
    destructive: true, fixtureKeys: ['tokens.doctor', 'files.profilePicture'],
    cleanup: { strategy: 'file-asset-finalizer', resource: 'doctor profile picture object and FileAsset' },
    postcondition: { verify: 'profile returns a signed profile picture URL and prior asset is retired' },
    buildBody: context => ({ file: context.files.profilePicture }),
  }),
])

export const PATIENT_OPERATIONS = Object.freeze([
  descriptor({
    id: 'GET /api/v1/patient/doctor-updates', method: 'GET', pathTemplate: `${PATIENT}/doctor-updates`, role: 'patient',
    fixtureKeys: ['tokens.patient', 'ids.doctorUpdateEventId'],
    buildPath: () => `${PATIENT}/doctor-updates?unread_only=false&limit=20`,
    semanticChecks: envelopeWithData(data => Array.isArray(data && data.updates)),
  }),
  descriptor({
    id: 'PATCH /api/v1/patient/doctor-updates/{event_id}/read', method: 'PATCH', pathTemplate: `${PATIENT}/doctor-updates/{event_id}/read`, role: 'patient',
    destructive: true, fixtureKeys: ['tokens.patient', 'ids.doctorUpdateEventId'],
    cleanup: { strategy: 'fixture-reseed', resource: 'doctor-update notification unread state' },
    postcondition: { verify: 'doctor update list returns event as read' },
    buildPath: context => `${PATIENT}/doctor-updates/${requirePathValue(context, 'doctorUpdateEventId')}/read`,
  }),
  descriptor({
    id: 'PATCH /api/v1/patient/doctor-updates/read-all', method: 'PATCH', pathTemplate: `${PATIENT}/doctor-updates/read-all`, role: 'patient',
    destructive: true, fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'fixture-reseed', resource: 'doctor-update unread states' },
    postcondition: { verify: 'doctor update summary unread count is zero' },
    semanticChecks: envelopeWithData(data => Number.isInteger(data && data.marked_count) && data.marked_count >= 0),
  }),
  descriptor({
    id: 'GET /api/v1/patient/doctor-updates/summary', method: 'GET', pathTemplate: `${PATIENT}/doctor-updates/summary`, role: 'patient',
    fixtureKeys: ['tokens.patient'],
    semanticChecks: envelopeWithData(data => Number.isInteger(data && data.unread_count) && data.unread_count >= 0 && Object.prototype.hasOwnProperty.call(data, 'latest')),
  }),
  descriptor({
    id: 'POST /api/v1/patient/dosage', method: 'POST', pathTemplate: `${PATIENT}/dosage`, role: 'patient',
    expectedStatuses: [200, 400, 409], destructive: true, fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient taken dosage entry' },
    postcondition: { verify: 'calendar marks dose taken exactly once; a replay is conflict' },
    buildBody: context => payload(context, 'takeDosage', () => ({ date: todayClinicalDate() })),
    semanticChecks: [{
      name: 'dosage result is success or explicit duplicate conflict',
      validate: response => {
        let body
        try { body = response.json() } catch (_) { return false }
        return response.status === 200
          ? body && body.success === true && Boolean(body.data && body.data.patient)
          : (response.status === 400 || response.status === 409) && body && body.success === false
      },
    }],
  }),
  descriptor({
    id: 'GET /api/v1/patient/dosage-calendar', method: 'GET', pathTemplate: `${PATIENT}/dosage-calendar`, role: 'patient',
    fixtureKeys: ['tokens.patient'],
    buildPath: () => `${PATIENT}/dosage-calendar?months=1`,
    semanticChecks: envelopeWithData(data => Boolean(data && typeof data === 'object')),
  }),
  descriptor({
    id: 'POST /api/v1/patient/health-logs', method: 'POST', pathTemplate: `${PATIENT}/health-logs`, role: 'patient',
    destructive: true, fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient health log' },
    postcondition: { verify: 'profile report returns health log with requested type and description' },
    buildBody: context => payload(context, 'healthLog', { type: 'LIFESTYLE', description: `Synthetic load test ${context.runId}` }),
  }),
  descriptor({
    id: 'GET /api/v1/patient/missed-doses', method: 'GET', pathTemplate: `${PATIENT}/missed-doses`, role: 'patient',
    fixtureKeys: ['tokens.patient'],
    semanticChecks: envelopeWithData(data => Boolean(data && typeof data === 'object')),
  }),
  descriptor({
    id: 'GET /api/v1/patient/notifications', method: 'GET', pathTemplate: `${PATIENT}/notifications`, role: 'patient',
    fixtureKeys: ['tokens.patient', 'ids.notificationId'],
    buildPath: () => `${PATIENT}/notifications?page=1&limit=20&is_read=false`,
    semanticChecks: envelopeWithData(data => Array.isArray(data && data.notifications) && Number.isFinite(data.unread_count)),
  }),
  descriptor({
    id: 'PATCH /api/v1/patient/notifications/{notification_id}/read', method: 'PATCH', pathTemplate: `${PATIENT}/notifications/{notification_id}/read`, role: 'patient',
    destructive: true, fixtureKeys: ['tokens.patient', 'ids.notificationId'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient notification unread state' },
    postcondition: { verify: 'notification is returned as read by list endpoint' },
    buildPath: context => `${PATIENT}/notifications/${requirePathValue(context, 'notificationId')}/read`,
  }),
  descriptor({
    id: 'PATCH /api/v1/patient/notifications/read-all', method: 'PATCH', pathTemplate: `${PATIENT}/notifications/read-all`, role: 'patient',
    destructive: true, fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient notification unread states' },
    postcondition: { verify: 'patient unread count is zero' },
    semanticChecks: envelopeWithData(data => Number.isInteger(data && data.marked_count) && data.marked_count >= 0),
  }),
  descriptor({
    id: 'GET /api/v1/patient/notifications/stream', method: 'GET', pathTemplate: `${PATIENT}/notifications/stream`, role: 'patient',
    protocol: 'sse', expectedStatuses: [200, 429], fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'abort-stream', resource: 'patient SSE connection' },
    postcondition: { verify: 'connection bookkeeping returns below configured cap' },
    semanticChecks: sseResponseChecks(),
  }),
  descriptor({
    id: 'POST /api/v1/patient/notifications/stream-ticket', method: 'POST', pathTemplate: `${PATIENT}/notifications/stream-ticket`, role: 'patient',
    fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'consume-or-expire', ttlSeconds: 30, resource: 'single-use SSE ticket' },
    postcondition: { verify: 'ticket is accepted once and replay is rejected' },
    semanticChecks: envelopeWithData(data => typeof (data && data.ticket) === 'string' && data.ticket.length > 20),
  }),
  descriptor({
    id: 'GET /api/v1/patient/notifications/unread-count', method: 'GET', pathTemplate: `${PATIENT}/notifications/unread-count`, role: 'patient',
    fixtureKeys: ['tokens.patient'],
    semanticChecks: envelopeWithData(data => Number.isInteger(data && data.unread_count) && data.unread_count >= 0),
  }),
  descriptor({
    id: 'GET /api/v1/patient/profile', method: 'GET', pathTemplate: `${PATIENT}/profile`, role: 'patient',
    fixtureKeys: ['tokens.patient'],
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient && data.doctor_updates)),
  }),
  descriptor({
    id: 'PUT /api/v1/patient/profile', method: 'PUT', pathTemplate: `${PATIENT}/profile`, role: 'patient',
    destructive: true, fixtureKeys: ['tokens.patient'],
    cleanup: { strategy: 'fixture-reseed', resource: 'patient editable profile fields' },
    postcondition: { verify: 'patient profile returns updated demographic fields' },
    // The fixture cleanup ownership signature is demographics.name, so the
    // default mutation deliberately changes a different editable field.
    buildBody: context => payload(context, 'patientProfile', { demographics: { age: 38 } }),
    semanticChecks: envelopeWithData(data => Boolean(data && data.profile)),
  }),
  descriptor({
    id: 'POST /api/v1/patient/profile-pic', method: 'POST', pathTemplate: `${PATIENT}/profile-pic`, role: 'patient', transport: 'multipart',
    destructive: true, fixtureKeys: ['tokens.patient', 'files.profilePicture'],
    cleanup: { strategy: 'file-asset-finalizer', resource: 'patient profile picture object and FileAsset' },
    postcondition: { verify: 'profile returns a signed profile picture URL and prior asset is retired' },
    buildBody: context => ({ file: context.files.profilePicture }),
  }),
  descriptor({
    id: 'GET /api/v1/patient/reports', method: 'GET', pathTemplate: `${PATIENT}/reports`, role: 'patient',
    fixtureKeys: ['tokens.patient', 'ids.reportId'],
    semanticChecks: envelopeWithData(data => Boolean(data && data.report)),
  }),
  descriptor({
    id: 'POST /api/v1/patient/reports', method: 'POST', pathTemplate: `${PATIENT}/reports`, role: 'patient', transport: 'multipart',
    destructive: true, fixtureKeys: ['tokens.patient', 'files.report'],
    cleanup: { strategy: 'file-asset-finalizer-and-fixture-reseed', resource: 'patient report object, FileAsset, and INR history entry' },
    postcondition: { verify: 'report list exposes one new report and tracked object metadata' },
    buildBody: context => ({
      file: context.files.report,
      inr_value: String(payload(context, 'reportInrValue', '2.5')),
      test_date: String(payload(context, 'reportTestDate', todayClinicalDate())),
    }),
    semanticChecks: envelopeWithData(data => Boolean(data && data.patient)),
  }),
])

export const CLINICAL_OPERATIONS = Object.freeze([...DOCTOR_OPERATIONS, ...PATIENT_OPERATIONS])
export const CLINICAL_OPERATION_IDS = Object.freeze(CLINICAL_OPERATIONS.map((operation) => operation.id))

export function assertClinicalCoverage(expectedIds) {
  const ids = CLINICAL_OPERATIONS.map(operation => operation.id)
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index)
  if (duplicates.length) throw new Error(`Duplicate clinical operation descriptors: ${[...new Set(duplicates)].join(', ')}`)
  if (DOCTOR_OPERATIONS.length !== 20 || PATIENT_OPERATIONS.length !== 19) {
    throw new Error(`Expected 20 doctor and 19 patient operations; found ${DOCTOR_OPERATIONS.length} and ${PATIENT_OPERATIONS.length}`)
  }
  for (const operation of CLINICAL_OPERATIONS) {
    for (const key of ['id', 'method', 'pathTemplate', 'role', 'expectedStatuses', 'fixtureKeys', 'cleanup', 'postcondition', 'buildPath', 'semanticChecks']) {
      if (operation[key] === undefined || operation[key] === null) throw new Error(`${operation.id} is missing descriptor field ${key}`)
    }
    if (typeof operation.destructive !== 'boolean') throw new Error(`${operation.id} destructive must be boolean`)
    if (!['doctor', 'patient'].includes(operation.role)) throw new Error(`${operation.id} has an invalid role`)
    if (!Array.isArray(operation.expectedStatuses) || !operation.expectedStatuses.length || operation.expectedStatuses.some(status => !Number.isInteger(status) || status < 100 || status > 599)) {
      throw new Error(`${operation.id} has invalid expected statuses`)
    }
    if (!Array.isArray(operation.fixtureKeys) || !operation.fixtureKeys.length) throw new Error(`${operation.id} has no declared fixture requirements`)
    if (!Array.isArray(operation.semanticChecks) || !operation.semanticChecks.length) throw new Error(`${operation.id} has no semantic checks`)
    if (operation.id !== `${operation.method} ${operation.pathTemplate}`) throw new Error(`${operation.id} does not match method/pathTemplate`)
  }
  if (expectedIds) {
    const expected = new Set(expectedIds)
    const actual = new Set(ids)
    const missing = [...expected].filter(id => !actual.has(id))
    const extra = [...actual].filter(id => !expected.has(id))
    if (missing.length || extra.length) throw new Error(`Clinical coverage mismatch; missing=[${missing.join(', ')}] extra=[${extra.join(', ')}]`)
  }
  return { doctor: DOCTOR_OPERATIONS.length, patient: PATIENT_OPERATIONS.length, total: ids.length, ids }
}

assertClinicalCoverage()
