const LEGACY_IDS_TEXT = `
GET /api
GET /api/admin/audit-logs
POST /api/admin/billing/checkout/{invoiceId}
GET /api/admin/billing/invoices
POST /api/admin/billing/invoices
GET /api/admin/config
PUT /api/admin/config
GET /api/admin/doctors
POST /api/admin/doctors
DELETE /api/admin/doctors/{id}
PUT /api/admin/doctors/{id}
GET /api/admin/hospitals
POST /api/admin/hospitals
DELETE /api/admin/hospitals/{id}
GET /api/admin/hospitals/{id}
PUT /api/admin/hospitals/{id}
PATCH /api/admin/hospitals/{id}/status
GET /api/admin/legacy/doctor/{id}
GET /api/admin/legacy/patient/{op_num}
GET /api/admin/legacy/patients
POST /api/admin/notifications/broadcast
GET /api/admin/patients
POST /api/admin/patients
DELETE /api/admin/patients/{id}
PUT /api/admin/patients/{id}
PUT /api/admin/reassign/{op_num}
GET /api/admin/roles
PUT /api/admin/roles/{roleKey}
GET /api/admin/system/health
GET /api/admin/system/reminder-delivery-health
GET /api/admin/users
POST /api/admin/users
PUT /api/admin/users/{id}
POST /api/admin/users/{id}/mfa/reset
POST /api/admin/users/batch
POST /api/admin/users/reset-password
POST /api/auth/admin/mfa/totp/activate
POST /api/auth/admin/mfa/totp/setup
GET /api/auth/admin/mfa/totp/status
POST /api/auth/change-password
POST /api/auth/login
POST /api/auth/login/otp/resend
POST /api/auth/login/otp/verify
POST /api/auth/login/totp/verify
POST /api/auth/logout
GET /api/auth/me
POST /api/auth/refresh
POST /api/auth/revoke
DELETE /api/devices/{tokenId}
POST /api/devices/register
GET /api/doctors/doctors
GET /api/doctors/notifications
PATCH /api/doctors/notifications/{notification_id}/read
PATCH /api/doctors/notifications/read-all
GET /api/doctors/notifications/stream
POST /api/doctors/notifications/stream-ticket
GET /api/doctors/notifications/unread-count
GET /api/doctors/patients
POST /api/doctors/patients
GET /api/doctors/patients/{op_num}
PUT /api/doctors/patients/{op_num}/config
PUT /api/doctors/patients/{op_num}/dosage
PUT /api/doctors/patients/{op_num}/instructions
PATCH /api/doctors/patients/{op_num}/reassign
GET /api/doctors/patients/{op_num}/reports
GET /api/doctors/patients/{op_num}/reports/{report_id}
PUT /api/doctors/patients/{op_num}/reports/{report_id}
GET /api/doctors/profile
PUT /api/doctors/profile
POST /api/doctors/profile-pic
GET /api/patient/doctor-updates
PATCH /api/patient/doctor-updates/{event_id}/read
PATCH /api/patient/doctor-updates/read-all
GET /api/patient/doctor-updates/summary
POST /api/patient/dosage
GET /api/patient/dosage-calendar
POST /api/patient/health-logs
GET /api/patient/missed-doses
GET /api/patient/notifications
PATCH /api/patient/notifications/{notification_id}/read
PATCH /api/patient/notifications/read-all
GET /api/patient/notifications/stream
POST /api/patient/notifications/stream-ticket
GET /api/patient/notifications/unread-count
GET /api/patient/profile
PUT /api/patient/profile
POST /api/patient/profile-pic
GET /api/patient/reports
POST /api/patient/reports
GET /api/statistics/admin
GET /api/statistics/compliance
GET /api/statistics/period
GET /api/statistics/trends
GET /api/statistics/workload
POST /api/webhooks/payment
`;

export const LEGACY_OPERATION_IDS = Object.freeze(LEGACY_IDS_TEXT.trim().split('\n'));

const SAFE_REACHABILITY_STATUSES = Object.freeze([200, 201, 202, 204, 400, 401, 403, 404, 409, 415, 422, 429, 503]);

function replacementFor(parameter, pathTemplate, context) {
  const ids = (context && context.ids) || {};
  const byParameter = {
    invoiceId: ids.invoiceId,
    tokenId: ids.tokenId,
    notification_id: ids.notificationId,
    event_id: ids.eventId,
    report_id: ids.reportId,
    op_num: ids.patientOpNum,
    roleKey: ids.roleKey || 'auditor',
  };
  if (byParameter[parameter]) return byParameter[parameter];
  if (parameter === 'id') {
    if (pathTemplate.includes('/hospitals/')) return ids.hospitalId;
    if (pathTemplate.includes('/doctors/')) return ids.doctorId;
    if (pathTemplate.includes('/patients/')) return ids.patientId;
    return ids.userId;
  }
  return undefined;
}

export function resolveLegacyPath(pathTemplate, context = {}) {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_match, parameter) => {
    const replacement = replacementFor(parameter, pathTemplate, context) || '000000000000000000000000';
    return encodeURIComponent(String(replacement));
  });
}

function toDescriptor(entry) {
  const canonicalId = entry.canonicalId;
  const canonicalPath = canonicalId.slice(canonicalId.indexOf(' ') + 1);
  return Object.freeze({
    id: entry.id,
    method: entry.method,
    pathTemplate: entry.path,
    canonicalId,
    canonicalPathTemplate: canonicalPath,
    role: 'anonymous',
    permission: null,
    expectedStatuses: SAFE_REACHABILITY_STATUSES,
    destructive: false,
    fixtureKeys: Object.freeze([]),
    cleanup: Object.freeze({ strategy: 'none-authless-reachability' }),
    postcondition: 'legacy request is routed, returns version/deprecation headers, and does not produce a 5xx other than explicit dependency-unavailable 503',
    buildPath: (context) => resolveLegacyPath(entry.path, context),
    buildBody: () => undefined,
    semanticChecks: Object.freeze(['legacy-version-headers', 'legacy-deprecation-headers', 'canonical-route-mapping']),
    parity: Object.freeze({ canonicalId, canonicalPathTemplate: canonicalPath, compareStatusWhenBaselineProvided: true }),
    concurrency: Object.freeze({ mode: 'single-smoke-attempt', capacityWeight: 0 }),
    idempotency: Object.freeze({ mode: 'authless-rejection-or-read-only' }),
  });
}

export function createLegacyDescriptors(inventory) {
  const entries = inventory && Array.isArray(inventory.explicitEndpoints)
    ? inventory.explicitEndpoints.filter((entry) => entry.scope === 'legacy')
    : [];
  return Object.freeze(entries.map(toDescriptor));
}

export function assertLegacyCoverage(inventory, descriptors = createLegacyDescriptors(inventory)) {
  const inventoryIds = (inventory && Array.isArray(inventory.explicitEndpoints) ? inventory.explicitEndpoints : [])
    .filter((entry) => entry.scope === 'legacy')
    .map((entry) => entry.id)
    .sort();
  const stableIds = [...LEGACY_OPERATION_IDS].sort();
  const descriptorIds = descriptors.map((entry) => entry.id).sort();
  const missing = inventoryIds.filter((id) => !descriptorIds.includes(id));
  const extra = descriptorIds.filter((id) => !inventoryIds.includes(id));
  const stableDrift = inventoryIds.filter((id) => !stableIds.includes(id)).concat(stableIds.filter((id) => !inventoryIds.includes(id)));
  const badMappings = descriptors.filter((entry) => entry.canonicalId !== `${entry.method} ${entry.pathTemplate.replace(/^\/api(?=\/|$)/, '/api/v1')}`);
  const duplicates = descriptorIds.filter((id, index) => descriptorIds.indexOf(id) !== index);
  if (inventoryIds.length !== 95 || descriptorIds.length !== 95 || stableIds.length !== 95 || missing.length || extra.length || stableDrift.length || badMappings.length || duplicates.length) {
    throw new Error(`Legacy coverage mismatch: inventory=${inventoryIds.length}, descriptors=${descriptorIds.length}, stable=${stableIds.length}, missing=${missing.join('|') || 'none'}, extra=${extra.join('|') || 'none'}, drift=${stableDrift.join('|') || 'none'}, badMappings=${badMappings.map((entry) => entry.id).join('|') || 'none'}, duplicates=${duplicates.join('|') || 'none'}`);
  }
  return Object.freeze({ total: 95, structurallyPaired: 95 });
}

