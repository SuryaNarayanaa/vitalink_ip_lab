export type MutationCapacityReadiness =
  | 'ledger-supported-requires-per-vu-pool'
  | 'blocked-auth-state-machine'
  | 'blocked-external-reconciler'
  | 'blocked-global-contention'

const LEDGER_SUPPORTED_REQUIRES_PER_VU_POOL = [
  'POST /api/v1/devices/register',
  'DELETE /api/v1/devices/{tokenId}',
  'PATCH /api/v1/doctors/notifications/{notification_id}/read',
  'PATCH /api/v1/doctors/notifications/read-all',
  'POST /api/v1/doctors/patients',
  'PUT /api/v1/doctors/patients/{op_num}/config',
  'PUT /api/v1/doctors/patients/{op_num}/dosage',
  'PUT /api/v1/doctors/patients/{op_num}/instructions',
  'PATCH /api/v1/doctors/patients/{op_num}/reassign',
  'PUT /api/v1/doctors/patients/{op_num}/reports/{report_id}',
  'PUT /api/v1/doctors/profile',
  'PATCH /api/v1/patient/doctor-updates/{event_id}/read',
  'PATCH /api/v1/patient/doctor-updates/read-all',
  'POST /api/v1/patient/dosage',
  'POST /api/v1/patient/health-logs',
  'PATCH /api/v1/patient/notifications/{notification_id}/read',
  'PATCH /api/v1/patient/notifications/read-all',
  'PUT /api/v1/patient/profile',
  'POST /api/v1/admin/hospitals',
  'PUT /api/v1/admin/hospitals/{id}',
  'PATCH /api/v1/admin/hospitals/{id}/status',
  'DELETE /api/v1/admin/hospitals/{id}',
  'POST /api/v1/admin/users',
  'POST /api/v1/admin/users/{id}/mfa/reset',
  'PUT /api/v1/admin/users/{id}',
  'POST /api/v1/admin/users/batch',
  'POST /api/v1/admin/users/reset-password',
  'POST /api/v1/admin/doctors',
  'PUT /api/v1/admin/doctors/{id}',
  'DELETE /api/v1/admin/doctors/{id}',
  'POST /api/v1/admin/patients',
  'PUT /api/v1/admin/patients/{id}',
  'DELETE /api/v1/admin/patients/{id}',
  'PUT /api/v1/admin/reassign/{op_num}',
] as const

const BLOCKED_AUTH_STATE_MACHINE = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/login/otp/verify',
  'POST /api/v1/auth/login/otp/resend',
  'POST /api/v1/auth/login/totp/verify',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/revoke',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/change-password',
  'POST /api/v1/auth/admin/mfa/totp/setup',
  'POST /api/v1/auth/admin/mfa/totp/activate',
] as const

const BLOCKED_EXTERNAL_RECONCILER = [
  'POST /api/v1/doctors/profile-pic',
  'POST /api/v1/patient/profile-pic',
  'POST /api/v1/patient/reports',
  'POST /api/v1/admin/billing/checkout/{invoiceId}',
  'POST /api/v1/admin/notifications/broadcast',
  'POST /api/v1/webhooks/payment',
] as const

const BLOCKED_GLOBAL_CONTENTION = [
  'PUT /api/v1/admin/roles/{roleKey}',
  'POST /api/v1/admin/billing/invoices',
  'PUT /api/v1/admin/config',
] as const

function entries(
  endpointIds: readonly string[],
  readiness: MutationCapacityReadiness,
  reason: string,
) {
  return endpointIds.map(endpointId => Object.freeze({ endpointId, readiness, reason }))
}

export const MUTATION_CAPACITY_READINESS = Object.freeze([
  ...entries(
    LEDGER_SUPPORTED_REQUIRES_PER_VU_POOL,
    'ledger-supported-requires-per-vu-pool',
    'Database-only cleanup can use exact delete/restore effects, but current scalar fixtures must be replaced by non-overlapping per-VU targets.',
  ),
  ...entries(
    BLOCKED_AUTH_STATE_MACHINE,
    'blocked-auth-state-machine',
    'Each iteration consumes or rotates credentials, sessions, challenges, or MFA state; a dedicated account/session/challenge factory is required.',
  ),
  ...entries(
    BLOCKED_EXTERNAL_RECONCILER,
    'blocked-external-reconciler',
    'The operation can create storage, malware-scan, notification-delivery, or payment-provider side effects for which no exact compensating handler is registered.',
  ),
  ...entries(
    BLOCKED_GLOBAL_CONTENTION,
    'blocked-global-contention',
    'This changes singleton or fleet-wide state; maximum-user concurrency would measure destructive contention unless an isolated clone/shard is created per worker.',
  ),
])

export function capacityReadiness(endpointId: string) {
  return MUTATION_CAPACITY_READINESS.find(entry => entry.endpointId === endpointId)
}

export function assertMutationReadinessCoverage(destructiveEndpointIds: readonly string[]): void {
  const expected = [...new Set(destructiveEndpointIds)].sort()
  const actual = MUTATION_CAPACITY_READINESS.map(entry => entry.endpointId).sort()
  const missing = expected.filter(id => !actual.includes(id))
  const extra = actual.filter(id => !expected.includes(id))
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index)
  if (missing.length || extra.length || duplicates.length) {
    throw new Error(
      `Mutation readiness mismatch: missing=${missing.join('|') || 'none'}, `
      + `extra=${extra.join('|') || 'none'}, duplicates=${duplicates.join('|') || 'none'}`,
    )
  }
}
