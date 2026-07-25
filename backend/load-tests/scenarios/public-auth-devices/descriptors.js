/*
 * Pure endpoint metadata: this module intentionally has no k6 imports so the
 * inventory/reporting Node processes can consume it directly.
 */

const MISSING_OBJECT_ID = '000000000000000000000000';

function valueAt(context, path) {
  return String(path || '').split('.').reduce((value, key) => (
    value && value[key] !== undefined ? value[key] : undefined
  ), context);
}

function authToken(context, role) {
  return valueAt(context, `tokens.${role}`);
}

function descriptor(input) {
  return Object.freeze({
    routeFamily: 'public_auth_devices',
    thresholdClass: 'authenticated_read',
    expectedRejectionStatuses: [401],
    destructive: false,
    fixtureKeys: [],
    cleanup: Object.freeze({ required: false, strategy: 'none' }),
    postcondition: Object.freeze({ kind: 'response_only' }),
    semanticChecks: Object.freeze(['json_envelope']),
    ...input,
  });
}

export const OPERATION_DESCRIPTORS = Object.freeze([
  descriptor({
    id: 'GET /api/v1', method: 'GET', pathTemplate: '/api/v1', role: 'anonymous',
    expectedStatuses: [200], thresholdClass: 'operational_read',
    semanticChecks: Object.freeze(['json_envelope_success', 'canonical_api_index']),
    buildPath: () => '/api/v1', buildBody: () => null,
  }),
  descriptor({
    id: 'POST /api/v1/auth/login', method: 'POST', pathTemplate: '/api/v1/auth/login', role: 'anonymous',
    expectedStatuses: [200, 202], expectedRejectionStatuses: [401, 429],
    fixtureKeys: ['payloads.login.loginId', 'payloads.login.password'],
    semanticChecks: Object.freeze(['json_envelope', 'login_result']),
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'revoke_sessions_or_cancel_challenge_by_run' }),
    postcondition: Object.freeze({ kind: 'session_or_mfa_challenge_created' }),
    buildPath: () => '/api/v1/auth/login',
    buildBody: (context, mode) => mode === 'valid'
      ? { login_id: valueAt(context, 'payloads.login.loginId'), password: valueAt(context, 'payloads.login.password') }
      : { login_id: `missing_${context.runId}@invalid.example`, password: 'Invalid-load-test-password-1!' },
  }),
  descriptor({
    id: 'POST /api/v1/auth/login/otp/verify', method: 'POST', pathTemplate: '/api/v1/auth/login/otp/verify', role: 'anonymous',
    expectedStatuses: [200], expectedRejectionStatuses: [404],
    fixtureKeys: ['challenges.otpId', 'payloads.otpCode', 'payloads.providerMode'],
    semanticChecks: Object.freeze(['json_envelope', 'session_payload']),
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'revoke_issued_session' }),
    postcondition: Object.freeze({ kind: 'otp_consumed_and_session_created' }),
    buildPath: () => '/api/v1/auth/login/otp/verify',
    buildBody: (context, mode) => ({
      challenge_id: mode === 'valid' ? valueAt(context, 'challenges.otpId') : MISSING_OBJECT_ID,
      code: mode === 'valid' ? valueAt(context, 'payloads.otpCode') : '000000',
    }),
    validWhen: (context) => valueAt(context, 'payloads.providerMode') === 'sandbox',
  }),
  descriptor({
    id: 'POST /api/v1/auth/login/otp/resend', method: 'POST', pathTemplate: '/api/v1/auth/login/otp/resend', role: 'anonymous',
    expectedStatuses: [200], expectedRejectionStatuses: [404],
    fixtureKeys: ['challenges.otpId', 'payloads.providerMode'],
    semanticChecks: Object.freeze(['json_envelope']),
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'cancel_or_consume_otp_challenge' }),
    postcondition: Object.freeze({ kind: 'otp_resend_state_updated' }),
    buildPath: () => '/api/v1/auth/login/otp/resend',
    buildBody: (context, mode) => ({ challenge_id: mode === 'valid' ? valueAt(context, 'challenges.otpId') : MISSING_OBJECT_ID }),
    validWhen: (context) => valueAt(context, 'payloads.providerMode') === 'sandbox',
  }),
  descriptor({
    id: 'POST /api/v1/auth/login/totp/verify', method: 'POST', pathTemplate: '/api/v1/auth/login/totp/verify', role: 'anonymous',
    expectedStatuses: [200], expectedRejectionStatuses: [404],
    fixtureKeys: ['challenges.totpChallengeId', 'payloads.totpCode'],
    semanticChecks: Object.freeze(['json_envelope', 'session_payload']),
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'revoke_issued_session' }),
    postcondition: Object.freeze({ kind: 'totp_challenge_consumed_and_session_created' }),
    buildPath: () => '/api/v1/auth/login/totp/verify',
    buildBody: (context, mode) => ({
      challenge_id: mode === 'valid' ? valueAt(context, 'challenges.totpChallengeId') : MISSING_OBJECT_ID,
      code: mode === 'valid' ? valueAt(context, 'payloads.totpCode') : '000000',
    }),
  }),
  descriptor({
    id: 'POST /api/v1/auth/refresh', method: 'POST', pathTemplate: '/api/v1/auth/refresh', role: 'anonymous',
    expectedStatuses: [200], expectedRejectionStatuses: [401],
    fixtureKeys: ['payloads.refreshToken'],
    semanticChecks: Object.freeze(['json_envelope', 'session_payload']),
    buildPath: () => '/api/v1/auth/refresh',
    buildBody: (context, mode) => ({ refresh_token: mode === 'valid' ? valueAt(context, 'payloads.refreshToken') : 'invalid-refresh-token' }),
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'revoke_rotated_session' }),
    postcondition: Object.freeze({ kind: 'refresh_rotated', replayMustFail: true }),
  }),
  descriptor({
    id: 'POST /api/v1/auth/revoke', method: 'POST', pathTemplate: '/api/v1/auth/revoke', role: 'anonymous',
    expectedStatuses: [200], expectedRejectionStatuses: [200],
    fixtureKeys: ['payloads.revokeRefreshToken'],
    semanticChecks: Object.freeze(['json_envelope_success']),
    buildPath: () => '/api/v1/auth/revoke',
    buildBody: (context, mode) => ({ refresh_token: mode === 'valid' ? valueAt(context, 'payloads.revokeRefreshToken') : 'invalid-refresh-token' }),
    destructive: true,
    cleanup: Object.freeze({ required: false, strategy: 'endpoint_is_idempotent' }),
    postcondition: Object.freeze({ kind: 'refresh_token_revoked', replayMustSucceed: true }),
  }),
  descriptor({
    id: 'POST /api/v1/auth/logout', method: 'POST', pathTemplate: '/api/v1/auth/logout', role: 'patient',
    expectedStatuses: [200], expectedRejectionStatuses: [401],
    fixtureKeys: ['tokens.patient'], semanticChecks: Object.freeze(['json_envelope']),
    buildPath: () => '/api/v1/auth/logout', buildBody: () => null,
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'patient') : undefined,
    destructive: true,
    cleanup: Object.freeze({ required: false, strategy: 'session_revoked_by_endpoint' }),
    postcondition: Object.freeze({ kind: 'access_token_rejected_after_logout' }),
  }),
  descriptor({
    id: 'GET /api/v1/auth/me', method: 'GET', pathTemplate: '/api/v1/auth/me', role: 'patient',
    expectedStatuses: [200], expectedRejectionStatuses: [401], fixtureKeys: ['tokens.patient'],
    semanticChecks: Object.freeze(['json_envelope', 'authenticated_user']),
    buildPath: () => '/api/v1/auth/me', buildBody: () => null,
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'patient') : undefined,
  }),
  descriptor({
    id: 'POST /api/v1/auth/change-password', method: 'POST', pathTemplate: '/api/v1/auth/change-password', role: 'patient',
    expectedStatuses: [200], expectedRejectionStatuses: [401],
    fixtureKeys: ['tokens.patient', 'payloads.currentPassword', 'payloads.newPassword'],
    semanticChecks: Object.freeze(['json_envelope', 'password_change_result']),
    buildPath: () => '/api/v1/auth/change-password',
    buildBody: (context, mode) => mode === 'valid'
      ? { current_password: valueAt(context, 'payloads.currentPassword'), new_password: valueAt(context, 'payloads.newPassword') }
      : { current_password: 'Wrong-current-password-1!', new_password: 'Distinct-new-password-2!' },
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'patient') : undefined,
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'fixture_reseed_password_and_sessions' }),
    postcondition: Object.freeze({ kind: 'password_changed_and_sessions_invalidated' }),
  }),
  descriptor({
    id: 'POST /api/v1/auth/admin/mfa/totp/setup', method: 'POST', pathTemplate: '/api/v1/auth/admin/mfa/totp/setup', role: 'admin',
    expectedStatuses: [200], expectedRejectionStatuses: [401], fixtureKeys: ['tokens.admin'],
    semanticChecks: Object.freeze(['json_envelope', 'totp_setup_result']),
    buildPath: () => '/api/v1/auth/admin/mfa/totp/setup', buildBody: () => null,
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'admin') : undefined,
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'remove_pending_totp_enrollment' }),
    postcondition: Object.freeze({ kind: 'pending_totp_enrollment_created' }),
  }),
  descriptor({
    id: 'GET /api/v1/auth/admin/mfa/totp/status', method: 'GET', pathTemplate: '/api/v1/auth/admin/mfa/totp/status', role: 'admin',
    expectedStatuses: [200], expectedRejectionStatuses: [401], fixtureKeys: ['tokens.admin'],
    semanticChecks: Object.freeze(['json_envelope', 'totp_status_result']),
    buildPath: () => '/api/v1/auth/admin/mfa/totp/status', buildBody: () => null,
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'admin') : undefined,
  }),
  descriptor({
    id: 'POST /api/v1/auth/admin/mfa/totp/activate', method: 'POST', pathTemplate: '/api/v1/auth/admin/mfa/totp/activate', role: 'admin',
    expectedStatuses: [200], expectedRejectionStatuses: [401],
    fixtureKeys: ['tokens.admin', 'payloads.totpActivationCode'],
    semanticChecks: Object.freeze(['json_envelope', 'totp_activation_result']),
    buildPath: () => '/api/v1/auth/admin/mfa/totp/activate',
    buildBody: (context, mode) => ({ code: mode === 'valid' ? valueAt(context, 'payloads.totpActivationCode') : '000000' }),
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'admin') : undefined,
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'restore_fixture_admin_mfa_state' }),
    postcondition: Object.freeze({ kind: 'totp_enabled_and_sessions_invalidated' }),
  }),
  descriptor({
    id: 'POST /api/v1/devices/register', method: 'POST', pathTemplate: '/api/v1/devices/register', role: 'patient',
    expectedStatuses: [201], expectedRejectionStatuses: [401], fixtureKeys: ['tokens.patient'],
    semanticChecks: Object.freeze(['json_envelope', 'device_registered']),
    buildPath: () => '/api/v1/devices/register',
    buildBody: (context) => ({
      fcm_token: `load_${context.runId}_${context.requestSuffix || 'single'}_synthetic_fcm_token`,
      platform: 'android', app_version: 'load-test',
    }),
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'patient') : undefined,
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'deactivate_registered_device_by_run_token' }),
    postcondition: Object.freeze({ kind: 'device_token_active_and_owned_by_caller' }),
  }),
  descriptor({
    id: 'DELETE /api/v1/devices/{tokenId}', method: 'DELETE', pathTemplate: '/api/v1/devices/{tokenId}', role: 'patient',
    expectedStatuses: [200], expectedRejectionStatuses: [401],
    fixtureKeys: ['tokens.patient', 'ids.deviceTokenId'], semanticChecks: Object.freeze(['json_envelope']),
    buildPath: (context, mode) => `/api/v1/devices/${mode === 'valid' ? valueAt(context, 'ids.deviceTokenId') : MISSING_OBJECT_ID}`,
    buildBody: () => null,
    selectToken: (context, mode) => mode === 'valid' ? authToken(context, 'patient') : undefined,
    destructive: true,
    cleanup: Object.freeze({ required: true, strategy: 'fixture_reseed_device_state' }),
    postcondition: Object.freeze({ kind: 'device_token_inactive' }),
  }),
  descriptor({
    id: 'GET /', method: 'GET', pathTemplate: '/', role: 'anonymous', expectedStatuses: [200],
    thresholdClass: 'operational_read', semanticChecks: Object.freeze(['json_envelope_success', 'root_index']),
    buildPath: () => '/', buildBody: () => null,
  }),
  descriptor({
    id: 'GET /health/live', method: 'GET', pathTemplate: '/health/live', role: 'anonymous', expectedStatuses: [200],
    thresholdClass: 'operational_read', semanticChecks: Object.freeze(['json_envelope_success', 'liveness']),
    buildPath: () => '/health/live', buildBody: () => null,
  }),
  descriptor({
    id: 'GET /health/ready', method: 'GET', pathTemplate: '/health/ready', role: 'anonymous', expectedStatuses: [200, 503],
    thresholdClass: 'operational_read', semanticChecks: Object.freeze(['json_envelope', 'readiness_consistency']),
    buildPath: () => '/health/ready', buildBody: () => null,
  }),
  descriptor({
    id: 'GET /nginx-health', method: 'GET', pathTemplate: '/nginx-health', role: 'anonymous', expectedStatuses: [200],
    thresholdClass: 'operational_read', semanticChecks: Object.freeze(['nginx_health']),
    verifyRequestId: false, contentType: 'text/plain', deriveHead: false, deriveOptions: false,
    buildPath: () => '/nginx-health', buildBody: () => null,
  }),
]);

export const OPERATION_IDS = Object.freeze(OPERATION_DESCRIPTORS.map((operation) => operation.id));

export function hasFixtureValue(context, path) {
  const value = valueAt(context, path);
  return value !== undefined && value !== null && value !== '';
}

export function canRunValid(descriptorValue, context) {
  return descriptorValue.fixtureKeys.every((key) => hasFixtureValue(context, key))
    && (!descriptorValue.validWhen || descriptorValue.validWhen(context) === true);
}

export function getOperationDescriptor(id) {
  return OPERATION_DESCRIPTORS.find((operation) => operation.id === id);
}
