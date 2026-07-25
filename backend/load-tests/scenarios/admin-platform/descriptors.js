const API = '/api/v1';

const SUCCESS = Object.freeze({
  appAdmin: [200],
  hospitalAdmin: [200],
  auditor: [200],
});

function value(context, key) {
  const ids = (context && context.ids) || {};
  const run = safeRunId(context || {});
  const fallbacks = {
    roleKey: 'auditor',
    disposableHospitalCode: `LT${run.toUpperCase()}`.slice(0, 32),
    disposableHospitalId: ids.hospitalId,
    billingPeriod: '2026-12',
    disposableAdminUserId: ids.userId,
    disposableUserId: ids.userId,
    disposableDoctorLoginId: `${run}_doctor`.toLowerCase(),
    disposableDoctorPhone: '+919876543210',
    disposableDoctorId: ids.doctorId,
    disposablePatientLoginId: `${run}_patient`.toLowerCase(),
    disposablePatientPhone: '+919876543211',
    disposablePatientId: ids.patientId,
    alternateDoctorId: ids.doctorId,
  };
  const candidate = ids[key] === undefined ? fallbacks[key] : ids[key];
  if (candidate === undefined || candidate === null || candidate === '') {
    throw new Error(`Admin/platform scenario requires context.ids.${key}`);
  }
  return encodeURIComponent(String(candidate));
}

function payload(context, key, fallback) {
  const candidate = context && context.payloads ? context.payloads[key] : undefined;
  return candidate === undefined ? fallback(context) : candidate;
}

function safeRunId(context) {
  return String(context.runId || 'loadtest').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32);
}

function access(allowedRoles, options = {}) {
  const allowed = new Set(allowedRoles);
  return ['appAdmin', 'hospitalAdmin', 'auditor'].map((role) => ({
    role,
    expectedStatuses: allowed.has(role) ? (options[role] || [200]) : [403],
    expectation: allowed.has(role) ? 'allowed' : 'permission-denied',
  }));
}

function op(definition) {
  const method = definition.method.toUpperCase();
  const id = `${method} ${API}${definition.pathTemplate}`;
  const destructive = definition.destructive === true;
  return Object.freeze({
    id,
    method,
    pathTemplate: `${API}${definition.pathTemplate}`,
    role: definition.role || 'appAdmin',
    permission: definition.permission || null,
    expectedStatuses: definition.expectedStatuses || [200],
    destructive,
    fixtureKeys: Object.freeze(definition.fixtureKeys || []),
    cleanup: definition.cleanup || (destructive ? { strategy: 'exact-id-journal-required' } : { strategy: 'none' }),
    postcondition: definition.postcondition || (destructive ? 'verify-exact-target-state-and-cleanup-journal' : 'response-only'),
    buildPath: definition.buildPath || (() => `${API}${definition.pathTemplate}`),
    buildBody: definition.buildBody || (() => undefined),
    semanticChecks: Object.freeze(definition.semanticChecks || ['api-envelope', 'success-true', 'data-present']),
    permissionCases: Object.freeze(definition.permissionCases || access(['appAdmin'])),
    tenantExpectation: definition.tenantExpectation || 'global',
    concurrency: Object.freeze(definition.concurrency || { mode: destructive ? 'single-writer' : 'parallel-safe' }),
    idempotency: Object.freeze(definition.idempotency || { mode: destructive ? 'not-idempotent' : 'read-only' }),
  });
}

const readTenant = {
  permissionCases: access(['appAdmin', 'hospitalAdmin']),
  tenantExpectation: 'hospital-admin sees only own hospital; app-admin sees all hospitals',
};

const mutateTenant = {
  destructive: true,
  permissionCases: access(['appAdmin', 'hospitalAdmin']),
  tenantExpectation: 'hospital-admin may mutate only exact resources in own hospital; cross-tenant target must return 403',
};

const readAuditable = {
  permissionCases: access(['appAdmin', 'hospitalAdmin', 'auditor']),
  tenantExpectation: 'hospital-bound actors see only their tenant; global auditor and app-admin may see all tenants',
};

export const ADMIN_OPERATIONS = Object.freeze([
  op({
    method: 'GET', pathTemplate: '/admin/roles',
    permissionCases: access(['appAdmin', 'hospitalAdmin', 'auditor']),
    semanticChecks: ['api-envelope', 'success-true', 'data.roles-object'],
  }),
  op({
    method: 'PUT', pathTemplate: '/admin/roles/{roleKey}', permission: 'manage_roles', destructive: true,
    fixtureKeys: ['roleKey'],
    buildPath: (ctx) => `${API}/admin/roles/${value(ctx, 'roleKey')}`,
    buildBody: (ctx) => payload(ctx, 'updateRole', () => ({ permissions: { export_data: true } })),
    cleanup: { strategy: 'restore-exact-role-policy-snapshot', key: 'roleKey' },
    postcondition: 'role policy equals submitted partial update, then equals saved snapshot after cleanup',
    permissionCases: access(['appAdmin']),
    concurrency: { mode: 'serialized-cas-observation', collisionKey: 'roleKey' },
    idempotency: { mode: 'same-payload-idempotent', key: 'roleKey' },
  }),

  op({ method: 'GET', pathTemplate: '/admin/hospitals', permission: 'manage_hospitals', ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.hospitals-array', 'tenant-scoped'] }),
  op({
    method: 'POST', pathTemplate: '/admin/hospitals', permission: 'manage_hospitals', destructive: true,
    expectedStatuses: [201], fixtureKeys: ['disposableHospitalCode'],
    buildBody: (ctx) => payload(ctx, 'createHospital', () => ({
      code: value(ctx, 'disposableHospitalCode'), name: `${safeRunId(ctx)} disposable hospital`,
      location: 'Synthetic load-test locality', admin_email: `${safeRunId(ctx)}.hospital@invalid.example`,
      metadata: { load_test_run_id: ctx.runId, synthetic: true },
    })),
    cleanup: { strategy: 'delete-by-returned-id-and-run-signature', idJsonPath: 'data.hospital.id' },
    postcondition: 'one hospital exists with exact code and load_test_run_id, then exact returned ID is absent after cleanup',
    permissionCases: access(['appAdmin'], { appAdmin: [201] }),
    concurrency: { mode: 'parallel-unique-key', collisionKey: 'disposableHospitalCode' },
    idempotency: { mode: 'unique-conflict', duplicateExpectedStatuses: [409] },
  }),
  op({ method: 'GET', pathTemplate: '/admin/hospitals/{id}', permission: 'manage_hospitals', fixtureKeys: ['hospitalId'], buildPath: (ctx) => `${API}/admin/hospitals/${value(ctx, 'hospitalId')}`, ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.hospital', 'tenant-scoped'] }),
  op({ method: 'PUT', pathTemplate: '/admin/hospitals/{id}', permission: 'manage_hospitals', fixtureKeys: ['disposableHospitalId'], buildPath: (ctx) => `${API}/admin/hospitals/${value(ctx, 'disposableHospitalId')}`, buildBody: (ctx) => payload(ctx, 'updateHospital', () => ({ metadata: { load_test_run_id: ctx.runId, mutation: 'put' } })), cleanup: { strategy: 'restore-exact-hospital-snapshot', idKey: 'disposableHospitalId' }, postcondition: 'only exact disposable hospital changes and snapshot is restored', destructive: true, permissionCases: access(['appAdmin']), tenantExpectation: 'app-admin only; hospital-admin and auditor return 403', concurrency: { mode: 'single-writer', collisionKey: 'disposableHospitalId' }, idempotency: { mode: 'same-payload-idempotent' } }),
  op({ method: 'PATCH', pathTemplate: '/admin/hospitals/{id}/status', permission: 'manage_hospitals', fixtureKeys: ['disposableHospitalId'], buildPath: (ctx) => `${API}/admin/hospitals/${value(ctx, 'disposableHospitalId')}/status`, buildBody: (ctx) => payload(ctx, 'updateHospitalStatus', () => ({ status: 'suspended' })), cleanup: { strategy: 'restore-exact-hospital-snapshot', idKey: 'disposableHospitalId' }, postcondition: 'hospital lifecycle transition and member deactivation are internally consistent; snapshot restored', destructive: true, permissionCases: access(['appAdmin']), tenantExpectation: 'app-admin only', concurrency: { mode: 'contention-probe', collisionKey: 'disposableHospitalId', allowedStatuses: [200, 409] }, idempotency: { mode: 'terminal-state-repeatable' } }),
  op({ method: 'DELETE', pathTemplate: '/admin/hospitals/{id}', permission: 'manage_hospitals', fixtureKeys: ['disposableHospitalId'], buildPath: (ctx) => `${API}/admin/hospitals/${value(ctx, 'disposableHospitalId')}`, cleanup: { strategy: 'restore-exact-hospital-snapshot', idKey: 'disposableHospitalId' }, postcondition: 'exact disposable hospital is inactive and its members cannot authenticate; snapshot restored', destructive: true, permissionCases: access(['appAdmin']), tenantExpectation: 'app-admin only', concurrency: { mode: 'contention-probe', collisionKey: 'disposableHospitalId', allowedStatuses: [200, 409] }, idempotency: { mode: 'terminal-state-repeatable' } }),

  op({ method: 'GET', pathTemplate: '/admin/billing/invoices', permission: 'manage_billing', ...readAuditable, semanticChecks: ['api-envelope', 'success-true', 'data.invoices-array', 'tenant-scoped'] }),
  op({
    method: 'POST', pathTemplate: '/admin/billing/invoices', permission: 'manage_billing', destructive: true,
    expectedStatuses: [201], fixtureKeys: ['billingPeriod'],
    buildBody: (ctx) => payload(ctx, 'generateInvoices', () => ({ billing_period: value(ctx, 'billingPeriod'), plan: 'Synthetic load test', amount: 1000 })),
    cleanup: { strategy: 'delete-returned-invoice-ids-for-exact-period-and-run-owned-hospitals' },
    postcondition: 'one invoice per active hospital and no duplicate hospital-period pair',
    permissionCases: access(['appAdmin'], { appAdmin: [201] }),
    concurrency: { mode: 'parallel-idempotency-probe', collisionKey: 'billingPeriod' },
    idempotency: { mode: 'database-unique-upsert', key: ['hospital_id', 'billing_period'] },
  }),
  op({
    method: 'POST', pathTemplate: '/admin/billing/checkout/{invoiceId}', permission: 'manage_billing',
    destructive: true,
    fixtureKeys: ['invoiceId'], buildPath: (ctx) => `${API}/admin/billing/checkout/${value(ctx, 'invoiceId')}`,
    cleanup: { strategy: 'restore-exact-invoice-and-checkout-session-snapshot', idKey: 'invoiceId' },
    postcondition: 'provider session and invoice checkout metadata are reconciled, then the exact invoice snapshot is restored',
    permissionCases: access(['appAdmin', 'hospitalAdmin']), tenantExpectation: 'hospital-admin may reserve checkout only for own tenant invoice; cross-tenant returns 403',
    semanticChecks: ['api-envelope', 'success-true', 'data.checkout_url-https'],
    concurrency: { mode: 'parallel-session-reservation', collisionKey: 'invoiceId', allowedStatuses: [200, 409, 502, 503] },
    idempotency: { mode: 'new-session-per-success', reconciliationKey: 'provider session ID' },
  }),

  op({ method: 'GET', pathTemplate: '/admin/users', permission: 'manage_users', ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.users-array', 'tenant-scoped'] }),
  op({
    method: 'POST', pathTemplate: '/admin/users', permission: 'manage_users', expectedStatuses: [201], destructive: true,
    fixtureKeys: ['hospitalId'],
    buildBody: (ctx) => payload(ctx, 'inviteUser', () => ({ name: `${safeRunId(ctx)} disposable admin`, email: `${safeRunId(ctx)}.admin@invalid.example`, role: 'hospital_admin', hospital_id: decodeURIComponent(value(ctx, 'hospitalId')) })),
    cleanup: { strategy: 'delete-returned-user-and-profile-by-exact-ids', userIdJsonPath: 'data.user.id' },
    postcondition: 'returned user and linked profile carry run-owned identity and are both absent after cleanup',
    permissionCases: access(['appAdmin', 'hospitalAdmin'], { appAdmin: [201], hospitalAdmin: [201] }),
    tenantExpectation: 'hospital-admin invite is forced to own active hospital; cross-tenant hospital_id returns 403',
    concurrency: { mode: 'parallel-unique-key', collisionKey: 'email' }, idempotency: { mode: 'unique-conflict', duplicateExpectedStatuses: [409] },
  }),
  op({ method: 'POST', pathTemplate: '/admin/users/{id}/mfa/reset', permission: 'manage_users', destructive: true, fixtureKeys: ['disposableAdminUserId'], buildPath: (ctx) => `${API}/admin/users/${value(ctx, 'disposableAdminUserId')}/mfa/reset`, cleanup: { strategy: 'discard-exact-disposable-admin-user', idKey: 'disposableAdminUserId' }, postcondition: 'factor generation increments and prior sessions are revoked for exact target', permissionCases: access(['appAdmin']), tenantExpectation: 'app-admin only and self-reset is rejected', concurrency: { mode: 'serialized-security-mutation', collisionKey: 'disposableAdminUserId' }, idempotency: { mode: 'non-idempotent-factor-rotation' }, semanticChecks: ['api-envelope', 'success-true', 'data.setup-secret-present', 'data.factor_type-authenticator'] }),
  op({ method: 'PUT', pathTemplate: '/admin/users/{id}', permission: 'manage_users', fixtureKeys: ['disposableAdminUserId'], buildPath: (ctx) => `${API}/admin/users/${value(ctx, 'disposableAdminUserId')}`, buildBody: (ctx) => payload(ctx, 'updateUser', () => ({ name: `${safeRunId(ctx)} updated admin` })), cleanup: { strategy: 'restore-exact-admin-user-and-profile-snapshot', idKey: 'disposableAdminUserId' }, postcondition: 'only exact target fields change and tenant membership remains valid; snapshot restored', ...mutateTenant, concurrency: { mode: 'single-writer', collisionKey: 'disposableAdminUserId' }, idempotency: { mode: 'same-payload-idempotent' } }),
  op({ method: 'POST', pathTemplate: '/admin/users/batch', permission: 'manage_users', fixtureKeys: ['disposableUserId'], buildBody: (ctx) => payload(ctx, 'batchUsers', () => ({ operation: 'deactivate', user_ids: [decodeURIComponent(value(ctx, 'disposableUserId'))] })), cleanup: { strategy: 'restore-exact-user-snapshots', idKeys: ['disposableUserId'] }, postcondition: 'result count equals exact submitted IDs and no cross-tenant user changes', ...mutateTenant, concurrency: { mode: 'single-writer-per-user', collisionKey: 'user_ids' }, idempotency: { mode: 'terminal-state-repeatable' }, semanticChecks: ['api-envelope', 'success-true', 'data.batch-counts-consistent'] }),
  op({ method: 'POST', pathTemplate: '/admin/users/reset-password', permission: 'manage_users', fixtureKeys: ['disposableUserId'], buildBody: (ctx) => payload(ctx, 'resetPassword', () => ({ target_user_id: decodeURIComponent(value(ctx, 'disposableUserId')), new_password: 'LoadTest9!Disposable' })), cleanup: { strategy: 'discard-exact-disposable-user', idKey: 'disposableUserId' }, postcondition: 'security version increments and prior sessions are revoked for exact target', ...mutateTenant, concurrency: { mode: 'serialized-security-mutation', collisionKey: 'disposableUserId' }, idempotency: { mode: 'non-idempotent-security-version' } }),

  op({ method: 'GET', pathTemplate: '/admin/doctors', permission: 'manage_doctors', ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.doctors-array', 'tenant-scoped'] }),
  op({ method: 'POST', pathTemplate: '/admin/doctors', permission: 'manage_doctors', expectedStatuses: [201], fixtureKeys: ['hospitalId', 'disposableDoctorLoginId', 'disposableDoctorPhone'], buildBody: (ctx) => payload(ctx, 'createDoctor', () => ({ login_id: decodeURIComponent(value(ctx, 'disposableDoctorLoginId')), password: 'LoadTest9!Disposable', name: `${safeRunId(ctx)} disposable doctor`, department: 'Load Testing', contact_number: decodeURIComponent(value(ctx, 'disposableDoctorPhone')), hospital_id: decodeURIComponent(value(ctx, 'hospitalId')) })), cleanup: { strategy: 'delete-returned-user-and-profile-by-exact-ids', userIdJsonPath: 'data.user.id' }, postcondition: 'exact user/profile pair exists in intended tenant and both are absent after cleanup', ...mutateTenant, permissionCases: access(['appAdmin', 'hospitalAdmin'], { appAdmin: [201], hospitalAdmin: [201] }), concurrency: { mode: 'parallel-unique-key', collisionKey: 'disposableDoctorLoginId' }, idempotency: { mode: 'unique-conflict', duplicateExpectedStatuses: [409] } }),
  op({ method: 'PUT', pathTemplate: '/admin/doctors/{id}', permission: 'manage_doctors', fixtureKeys: ['disposableDoctorId'], buildPath: (ctx) => `${API}/admin/doctors/${value(ctx, 'disposableDoctorId')}`, buildBody: (ctx) => payload(ctx, 'updateDoctor', () => ({ department: 'Load Testing Updated' })), cleanup: { strategy: 'restore-exact-doctor-user-and-profile-snapshot', idKey: 'disposableDoctorId' }, postcondition: 'exact doctor changes without cross-tenant reassignment; snapshot restored', ...mutateTenant, concurrency: { mode: 'single-writer', collisionKey: 'disposableDoctorId' }, idempotency: { mode: 'same-payload-idempotent' } }),
  op({ method: 'DELETE', pathTemplate: '/admin/doctors/{id}', permission: 'manage_doctors', fixtureKeys: ['disposableDoctorId'], buildPath: (ctx) => `${API}/admin/doctors/${value(ctx, 'disposableDoctorId')}`, cleanup: { strategy: 'restore-exact-doctor-user-and-profile-snapshot', idKey: 'disposableDoctorId' }, postcondition: 'exact doctor becomes inactive only after assignment guard succeeds; snapshot restored', ...mutateTenant, concurrency: { mode: 'contention-probe', collisionKey: 'disposableDoctorId', allowedStatuses: [200, 409] }, idempotency: { mode: 'terminal-state-repeatable' } }),

  op({ method: 'GET', pathTemplate: '/admin/patients', permission: 'manage_patients', ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.patients-array', 'tenant-scoped'] }),
  op({ method: 'POST', pathTemplate: '/admin/patients', permission: 'manage_patients', expectedStatuses: [201], fixtureKeys: ['hospitalId', 'doctorId', 'disposablePatientLoginId', 'disposablePatientPhone'], buildBody: (ctx) => payload(ctx, 'createPatient', () => ({ login_id: decodeURIComponent(value(ctx, 'disposablePatientLoginId')), password: 'LoadTest9!Disposable', assigned_doctor_id: decodeURIComponent(value(ctx, 'doctorId')), demographics: { name: `${safeRunId(ctx)} disposable patient`, age: 40, gender: 'Other', phone: decodeURIComponent(value(ctx, 'disposablePatientPhone')) }, medical_config: { diagnosis: 'Synthetic load test', therapy_drug: 'Warfarin', target_inr: { min: 2, max: 3 } }, hospital_id: decodeURIComponent(value(ctx, 'hospitalId')) })), cleanup: { strategy: 'delete-returned-user-and-profile-by-exact-ids', userIdJsonPath: 'data.user.id' }, postcondition: 'exact user/profile pair belongs to doctor tenant and both are absent after cleanup', ...mutateTenant, permissionCases: access(['appAdmin', 'hospitalAdmin'], { appAdmin: [201], hospitalAdmin: [201] }), concurrency: { mode: 'parallel-unique-key', collisionKey: 'disposablePatientLoginId' }, idempotency: { mode: 'unique-conflict', duplicateExpectedStatuses: [409] } }),
  op({ method: 'PUT', pathTemplate: '/admin/patients/{id}', permission: 'manage_patients', fixtureKeys: ['disposablePatientId'], buildPath: (ctx) => `${API}/admin/patients/${value(ctx, 'disposablePatientId')}`, buildBody: (ctx) => payload(ctx, 'updatePatient', () => ({ medical_config: { diagnosis: 'Synthetic load test updated' } })), cleanup: { strategy: 'restore-exact-patient-user-and-profile-snapshot', idKey: 'disposablePatientId' }, postcondition: 'exact patient changes atomically and snapshot is restored', ...mutateTenant, concurrency: { mode: 'single-writer', collisionKey: 'disposablePatientId' }, idempotency: { mode: 'same-payload-idempotent' } }),
  op({ method: 'DELETE', pathTemplate: '/admin/patients/{id}', permission: 'manage_patients', fixtureKeys: ['disposablePatientId'], buildPath: (ctx) => `${API}/admin/patients/${value(ctx, 'disposablePatientId')}`, cleanup: { strategy: 'restore-exact-patient-user-and-profile-snapshot', idKey: 'disposablePatientId' }, postcondition: 'exact patient terminalizes, file purge invariants hold, and snapshot is restored', ...mutateTenant, concurrency: { mode: 'contention-probe', collisionKey: 'disposablePatientId', allowedStatuses: [200, 409] }, idempotency: { mode: 'terminal-state-repeatable' } }),
  op({ method: 'PUT', pathTemplate: '/admin/reassign/{op_num}', permission: 'manage_patients', fixtureKeys: ['patientOpNum', 'alternateDoctorId'], buildPath: (ctx) => `${API}/admin/reassign/${value(ctx, 'patientOpNum')}`, buildBody: (ctx) => payload(ctx, 'reassignPatient', () => ({ new_doctor_id: decodeURIComponent(value(ctx, 'alternateDoctorId')) })), cleanup: { strategy: 'restore-exact-patient-assignment-snapshot', idKey: 'patientOpNum' }, postcondition: 'patient assignment and outbox notification commit atomically exactly once', ...mutateTenant, concurrency: { mode: 'contention-probe', collisionKey: 'patientOpNum', allowedStatuses: [200, 409] }, idempotency: { mode: 'assignment-target-repeatable', notificationDeduplicationRequired: true } }),

  op({ method: 'GET', pathTemplate: '/admin/audit-logs', permission: 'view_audit', ...readAuditable, semanticChecks: ['api-envelope', 'success-true', 'data.logs-array', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/admin/config', permission: 'manage_system', permissionCases: access(['appAdmin', 'hospitalAdmin']), semanticChecks: ['api-envelope', 'success-true', 'data-present'] }),
  op({ method: 'PUT', pathTemplate: '/admin/config', permission: 'manage_system', buildBody: (ctx) => payload(ctx, 'updateConfig', () => ({ feature_flags: { [`load_test_${safeRunId(ctx)}`]: true } })), cleanup: { strategy: 'restore-exact-system-config-snapshot' }, postcondition: 'submitted keys change and complete pre-run config is restored', destructive: true, permissionCases: access(['appAdmin', 'hospitalAdmin']), tenantExpectation: 'auditor must return 403 and never change configuration', concurrency: { mode: 'single-writer-global' }, idempotency: { mode: 'same-payload-idempotent' } }),
  op({ method: 'POST', pathTemplate: '/admin/notifications/broadcast', permission: 'manage_system', buildBody: (ctx) => payload(ctx, 'broadcastNotification', () => ({ title: `${safeRunId(ctx)} synthetic broadcast`, message: 'Authorized synthetic load test only', target: 'SPECIFIC', user_ids: [decodeURIComponent(value(ctx, 'userId'))], priority: 'LOW' })), fixtureKeys: ['userId'], cleanup: { strategy: 'delete-returned-notification-and-delivery-ids-with-run-signature' }, postcondition: 'only intended tenant recipients receive one notification/delivery set', destructive: true, permissionCases: access(['appAdmin', 'hospitalAdmin']), tenantExpectation: 'hospital-admin recipients are limited to own tenant; cross-tenant IDs must not deliver', concurrency: { mode: 'parallel-unique-title', collisionKey: ['runId', 'requestId'] }, idempotency: { mode: 'non-idempotent', deduplicationAtDeliveryLayer: true } }),
  op({ method: 'GET', pathTemplate: '/admin/system/health', permission: 'manage_system', permissionCases: access(['appAdmin', 'hospitalAdmin']), semanticChecks: ['api-envelope', 'success-true', 'data.database-state'] }),
  op({ method: 'GET', pathTemplate: '/admin/system/reminder-delivery-health', permission: 'manage_system', permissionCases: access(['appAdmin', 'hospitalAdmin']), tenantExpectation: 'hospital-admin metrics include only own tenant reminders; app-admin includes all', semanticChecks: ['api-envelope', 'success-true', 'data.reminder-health', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/admin/legacy/patients', permission: 'manage_patients', ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.patients-array', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/admin/legacy/patient/{op_num}', permission: 'manage_patients', fixtureKeys: ['patientOpNum'], buildPath: (ctx) => `${API}/admin/legacy/patient/${value(ctx, 'patientOpNum')}`, ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.patient', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/admin/legacy/doctor/{id}', permission: 'manage_doctors', fixtureKeys: ['doctorId'], buildPath: (ctx) => `${API}/admin/legacy/doctor/${value(ctx, 'doctorId')}`, ...readTenant, semanticChecks: ['api-envelope', 'success-true', 'data.doctor', 'tenant-scoped'] }),
]);

export const STATISTICS_OPERATIONS = Object.freeze([
  op({ method: 'GET', pathTemplate: '/statistics/admin', role: 'hospitalAdmin', ...readAuditable, semanticChecks: ['api-envelope', 'success-true', 'data.statistics-counts-nonnegative', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/statistics/trends', role: 'hospitalAdmin', ...readAuditable, buildPath: () => `${API}/statistics/trends?period=30d`, semanticChecks: ['api-envelope', 'success-true', 'data.trends-arrays', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/statistics/compliance', role: 'hospitalAdmin', ...readAuditable, semanticChecks: ['api-envelope', 'success-true', 'data.compliance-total-consistent', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/statistics/workload', role: 'hospitalAdmin', ...readAuditable, semanticChecks: ['api-envelope', 'success-true', 'data.workload-array', 'tenant-scoped'] }),
  op({ method: 'GET', pathTemplate: '/statistics/period', role: 'hospitalAdmin', ...readAuditable, buildPath: (ctx) => payload(ctx, 'statisticsPeriodPath', () => `${API}/statistics/period?start_date=2026-01-01&end_date=2026-12-31`), semanticChecks: ['api-envelope', 'success-true', 'data.period-valid', 'tenant-scoped'] }),
]);

export const WEBHOOK_OPERATIONS = Object.freeze([
  op({
    method: 'POST', pathTemplate: '/webhooks/payment', role: 'none', expectedStatuses: [200], destructive: true,
    fixtureKeys: ['invoiceId'],
    buildBody: (ctx) => payload(ctx, 'paymentWebhook', () => ({
      session_id: ctx.webhook && ctx.webhook.sessionId,
      invoice_number: ctx.webhook && (ctx.webhook.invoiceNumber || ctx.ids.invoiceId),
      amount: ctx.webhook && ctx.webhook.amount,
      currency: (ctx.webhook && ctx.webhook.currency) || 'INR',
      provider_event_id: ctx.webhook && ctx.webhook.eventId,
      timestamp: ctx.webhook && ctx.webhook.timestamp,
    })),
    cleanup: { strategy: 'restore-exact-invoice-and-checkout-session-snapshot', idKey: 'invoiceId' },
    postcondition: 'invoice transitions to Paid once; duplicate signed delivery returns already_paid without a second transition',
    permissionCases: [], tenantExpectation: 'no bearer token; HMAC-bound exact invoice/session controls tenant impact',
    concurrency: { mode: 'parallel-duplicate-delivery', collisionKey: ['invoiceId', 'provider_event_id'], expectedStatuses: [200] },
    idempotency: { mode: 'compare-and-set-exactly-once-business-transition', replayResult: 'already_paid=true' },
    semanticChecks: ['api-envelope', 'success-true', 'data.invoice-paid', 'data.already_paid-boolean'],
  }),
]);

export const ADMIN_PLATFORM_OPERATIONS = Object.freeze([
  ...ADMIN_OPERATIONS,
  ...STATISTICS_OPERATIONS,
  ...WEBHOOK_OPERATIONS,
]);

export const ADMIN_OPERATION_IDS = Object.freeze(ADMIN_OPERATIONS.map((entry) => entry.id));
export const STATISTICS_OPERATION_IDS = Object.freeze(STATISTICS_OPERATIONS.map((entry) => entry.id));
export const WEBHOOK_OPERATION_IDS = Object.freeze(WEBHOOK_OPERATIONS.map((entry) => entry.id));
export const ADMIN_PLATFORM_OPERATION_IDS = Object.freeze(ADMIN_PLATFORM_OPERATIONS.map((entry) => entry.id));

export function assertAdminPlatformCoverage(inventory) {
  const endpoints = inventory && Array.isArray(inventory.explicitEndpoints) ? inventory.explicitEndpoints : [];
  const expected = endpoints
    .filter((entry) => entry.scope === 'canonical' && (
      entry.path.startsWith('/api/v1/admin/') ||
      entry.path.startsWith('/api/v1/statistics/') ||
      entry.path === '/api/v1/webhooks/payment'
    ))
    .map((entry) => entry.id)
    .sort();
  const actual = [...ADMIN_PLATFORM_OPERATION_IDS].sort();
  const missing = expected.filter((id) => !actual.includes(id));
  const extra = actual.filter((id) => !expected.includes(id));
  const duplicates = actual.filter((id, index) => actual.indexOf(id) !== index);
  if (expected.length !== 41 || ADMIN_OPERATION_IDS.length !== 35 || STATISTICS_OPERATION_IDS.length !== 5 || WEBHOOK_OPERATION_IDS.length !== 1 || missing.length || extra.length || duplicates.length) {
    throw new Error(`Admin/platform coverage mismatch: expected=${expected.length}, actual=${actual.length}, missing=${missing.join('|') || 'none'}, extra=${extra.join('|') || 'none'}, duplicates=${duplicates.join('|') || 'none'}`);
  }
  return Object.freeze({ total: actual.length, admin: 35, statistics: 5, webhook: 1 });
}
