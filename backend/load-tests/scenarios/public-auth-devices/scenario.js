import { sleep } from 'k6';
import execution from 'k6/execution';
import { Counter } from 'k6/metrics';
import { jsonBody, responseHeader } from '../../lib/checks.js';
import { loadRequest } from '../../lib/client.js';
import { createProfileConfig } from '../../profiles/profile-config.js';
import { verifyTargetIdentity } from '../../lib/preflight.js';
import { OPERATION_DESCRIPTORS, canRunValid, getOperationDescriptor } from './descriptors.js';
import { buildConformanceDescriptors } from './conformance.js';

const FALSEY = new Set(['', '0', 'false', 'no', 'off']);
const rateLimitResponses = new Counter('load_rate_limit_responses');

function envFlag(name, fallback = false) {
  const value = __ENV[name];
  if (value === undefined) return fallback;
  return !FALSEY.has(String(value).trim().toLowerCase());
}

function parseJson(name, fallback) {
  const raw = String(__ENV[name] || '').trim();
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_) {
    throw new Error(`${name} must contain valid JSON`);
  }
}

const contextFile = String(__ENV.LOAD_TEST_CONTEXT_FILE || '').trim();
let contextFromFile = null;
if (contextFile) {
  try {
    contextFromFile = JSON.parse(open(contextFile));
  } catch (_) {
    throw new Error('LOAD_TEST_CONTEXT_FILE must reference valid JSON readable by k6');
  }
}

function selectedOperations() {
  const requested = String(__ENV.LOAD_TEST_OPERATION_IDS || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (requested.length === 0) return OPERATION_DESCRIPTORS;
  const unknown = requested.filter((id) => !getOperationDescriptor(id));
  if (unknown.length) throw new Error(`Unknown LOAD_TEST_OPERATION_IDS: ${unknown.join(', ')}`);
  return requested.map((id) => getOperationDescriptor(id));
}

function protocolTargets() {
  const configured = parseJson('LOAD_TEST_PROTOCOL_TARGETS_JSON', null);
  if (configured === null) return OPERATION_DESCRIPTORS;
  if (!Array.isArray(configured)) throw new Error('LOAD_TEST_PROTOCOL_TARGETS_JSON must be a JSON array');
  return configured.map((target) => {
    if (!target || !target.method || !target.pathTemplate) throw new Error('Each protocol target needs method and pathTemplate');
    return target;
  });
}

const profileConfig = createProfileConfig({ scenarioName: 'public_auth_devices', exec: 'runProfile' });
const primaryDescriptors = Object.freeze(selectedOperations());
const conformanceDescriptors = buildConformanceDescriptors({
  docs: {
    enabled: envFlag('LOAD_TEST_DOCS_ENABLED'),
    path: __ENV.LOAD_TEST_DOCS_PATH || '/docs',
    asset: __ENV.LOAD_TEST_DOCS_ASSET || '',
  },
  targets: protocolTargets(),
  includeHead: envFlag('LOAD_TEST_INCLUDE_HEAD'),
  includeOptions: envFlag('LOAD_TEST_INCLUDE_OPTIONS'),
  corsOrigin: __ENV.LOAD_TEST_CORS_ORIGIN || '',
});
const allDescriptors = Object.freeze([...primaryDescriptors, ...conformanceDescriptors]);

export const options = profileConfig.guard.profile.name === 'rate-limit'
  ? { ...profileConfig.options, thresholds: { ...profileConfig.options.thresholds, load_rate_limit_responses: ['count>0'] } }
  : profileConfig.options;
export const handleSummary = profileConfig.handleSummary;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Secrets enter only through LOAD_TEST_SCENARIO_CONTEXT_JSON and stay inside
 * k6's setup/VU data channel. This function deliberately performs no logging.
 */
export function setup() {
  verifyTargetIdentity(profileConfig.guard);
  const supplied = contextFromFile || parseJson('LOAD_TEST_SCENARIO_CONTEXT_JSON', {});
  if (!isObject(supplied)) throw new Error('LOAD_TEST_SCENARIO_CONTEXT_JSON must be a JSON object');
  if (supplied.runId && supplied.runId !== profileConfig.guard.runId) {
    throw new Error('Scenario context runId does not match guarded LOAD_TEST_RUN_ID');
  }
  if (supplied.baseUrl && String(supplied.baseUrl).replace(/\/$/, '') !== profileConfig.guard.baseUrl) {
    throw new Error('Scenario context baseUrl does not match guarded LOAD_TEST_BASE_URL');
  }
  return {
    baseUrl: profileConfig.guard.baseUrl,
    runId: profileConfig.guard.runId,
    tokens: isObject(supplied.tokens) ? supplied.tokens : {},
    ids: isObject(supplied.ids) ? supplied.ids : {},
    challenges: isObject(supplied.challenges) ? supplied.challenges : {},
    payloads: isObject(supplied.payloads) ? supplied.payloads : {},
  };
}

function successfulStatus(response) {
  return response.status >= 200 && response.status < 300;
}

function envelope(response) {
  const body = jsonBody(response);
  if (!body || typeof body.success !== 'boolean' || typeof body.message !== 'string') return false;
  return body.statusCode === undefined || Number(body.statusCode) === Number(response.status);
}

function validOrExpectedRejection(response, validate) {
  return response.status >= 400 ? envelope(response) : validate(response, jsonBody(response));
}

const SEMANTIC_CHECKS = Object.freeze({
  json_envelope: (response) => envelope(response),
  json_envelope_success: (response) => envelope(response) && successfulStatus(response) && jsonBody(response).success === true,
  canonical_api_index: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && body.data.version === 'v1' && Array.isArray(body.data.routes) && body.data.routes.includes('auth')
  )),
  root_index: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && body.data.versioned_base_path === '/api/v1' && body.data.legacy_base_path === '/api'
  )),
  liveness: (response) => successfulStatus(response) && envelope(response) && /live/i.test(jsonBody(response).message),
  readiness_consistency: (response) => {
    if (!envelope(response)) return false;
    const data = jsonBody(response).data;
    if (!data || !data.database || !data.firebase || !data.notification_worker || !data.configuration) return false;
    const ready = data.database.connected === true
      && data.firebase.state !== 'failed'
      && (!data.notification_worker.enabled || data.notification_worker.state === 'started')
      && data.configuration.ready === true;
    return response.status === (ready ? 200 : 503);
  },
  nginx_health: (response) => response.status === 200 && String(response.body || '').trim().toLowerCase() === 'healthy',
  login_result: (response) => validOrExpectedRejection(response, (_response, body) => {
    if (response.status === 202) {
      return body.data && ['OTP_REQUIRED', 'TOTP_REQUIRED'].includes(body.data.auth_status)
        && body.data.challenge && /^[a-f\d]{24}$/i.test(String(body.data.challenge.challenge_id || ''));
    }
    return SEMANTIC_CHECKS.session_payload(response);
  }),
  session_payload: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && typeof body.data.token === 'string' && body.data.token.length > 20
      && typeof body.data.refresh_token === 'string' && body.data.refresh_token.length > 20
      && body.data.session && typeof body.data.session.session_id === 'string'
  )),
  authenticated_user: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && body.data.user && body.data.user.password === undefined && body.data.user.salt === undefined
  )),
  password_change_result: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && typeof body.data.invalidated_sessions === 'number' && typeof body.data.revocation_cleanup_completed === 'boolean'
  )),
  totp_setup_result: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && body.data.factor_type === 'AUTHENTICATOR_APP'
      && typeof body.data.secret === 'string' && body.data.secret.length > 0
      && /^otpauth:\/\//.test(String(body.data.otpauth_url || ''))
  )),
  totp_status_result: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && body.data.factor_type === 'AUTHENTICATOR_APP' && typeof body.data.status === 'string'
  )),
  totp_activation_result: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && body.data.factor_type === 'AUTHENTICATOR_APP' && body.data.status === 'ENABLED'
  )),
  device_registered: (response) => validOrExpectedRejection(response, (_response, body) => (
    body.data && /^[a-f\d]{24}$/i.test(String(body.data.token_id || ''))
  )),
  docs_html: (response) => response.status === 200 && /<html|swagger-ui/i.test(String(response.body || '')),
  openapi_document: (response) => response.status === 200 && /openapi:\s*3\./i.test(String(response.body || '')),
  nonempty_response: (response) => response.status === 200 && String(response.body || '').length > 0,
  head_conformance: (response) => response.status >= 200 && response.status < 600
    && (response.body === null || response.body === undefined || response.body === ''),
  cors_preflight: (response) => response.status === 204
    && (response.body === null || response.body === undefined || response.body === ''),
});

function semanticChecks(descriptor) {
  return descriptor.semanticChecks.map((name) => {
    const validate = SEMANTIC_CHECKS[name];
    if (!validate) throw new Error(`Unknown semantic check ${name} on ${descriptor.id}`);
    return { name: `${descriptor.id}: ${name}`, validate };
  });
}

function requestedMode(descriptor, context) {
  const configured = String(__ENV.LOAD_TEST_OPERATION_MODE || 'auto').trim().toLowerCase().replace(/-/g, '_');
  if (!['auto', 'valid', 'expected_rejection'].includes(configured)) {
    throw new Error('LOAD_TEST_OPERATION_MODE must be auto, valid, or expected_rejection');
  }
  if (configured === 'valid') {
    if (!canRunValid(descriptor, context)) throw new Error(`Valid mode lacks fixtures for ${descriptor.id}`);
    if (descriptor.destructive) {
      throw new Error(`Valid mutation mode is disabled until the durable dynamic cleanup ledger is implemented: ${descriptor.id}`);
    }
    return 'valid';
  }
  if (configured === 'expected_rejection') return descriptor.expectedRejectionStatuses ? 'expected_rejection' : 'valid';
  if (descriptor.destructive) return 'expected_rejection';
  return canRunValid(descriptor, context) ? 'valid' : (descriptor.expectedRejectionStatuses ? 'expected_rejection' : 'valid');
}

function requestTags(descriptor, mode) {
  return {
    endpointId: descriptor.metricEndpointId,
    routeFamily: descriptor.routeFamily,
    scenario: profileConfig.guard.profile.name === 'rate-limit' ? 'auth_rate_limit' : 'public_auth_devices',
    role: descriptor.role,
    tenantMode: descriptor.role === 'anonymous' ? 'none' : 'fixture_tenant',
    responseClass: mode === 'valid' ? 'success' : 'expected_rejection',
    dependencyMode: __ENV.LOAD_TEST_DEPENDENCY_MODE || 'normal',
    thresholdClass: descriptor.thresholdClass,
  };
}

function runDescriptor(descriptor, setupContext, forcedMode, expectedStatusesOverride) {
  const context = {
    ...setupContext,
    requestSuffix: `v${typeof __VU === 'undefined' ? 0 : __VU}i${typeof __ITER === 'undefined' ? 0 : __ITER}`,
  };
  const mode = forcedMode || requestedMode(descriptor, context);
  const expectedStatuses = expectedStatusesOverride
    || (mode === 'valid' ? descriptor.expectedStatuses : descriptor.expectedRejectionStatuses);
  if (!expectedStatuses) throw new Error(`${descriptor.id} does not support ${mode} mode`);

  const result = loadRequest({
    method: descriptor.method,
    baseUrl: context.baseUrl,
    path: descriptor.buildPath(context, mode),
    routeTemplate: descriptor.pathTemplate,
    body: descriptor.buildBody(context, mode),
    token: descriptor.selectToken ? descriptor.selectToken(context, mode) : undefined,
    headers: descriptor.headers,
    expectedStatuses,
    contentType: descriptor.contentType || (!['HEAD', 'OPTIONS'].includes(descriptor.method) && descriptor.routeFamily !== 'documentation' ? 'application/json' : undefined),
    verifyRequestId: descriptor.verifyRequestId,
    semanticChecks: semanticChecks(descriptor),
    tags: requestTags(descriptor, mode),
    runId: context.runId,
  });
  return { ...result, mode, descriptor };
}

function runPostcondition(result, context) {
  if (result.mode !== 'valid' || !result.statusExpected || !result.semantic.success) return;
  const descriptor = result.descriptor;
  if (descriptor.id === 'POST /api/v1/auth/refresh') {
    runDescriptor(descriptor, context, 'valid', [401]);
  } else if (descriptor.id === 'POST /api/v1/auth/revoke') {
    runDescriptor(descriptor, context, 'valid', [200]);
  } else if (descriptor.id === 'POST /api/v1/auth/logout' || descriptor.id === 'POST /api/v1/auth/change-password') {
    runDescriptor(getOperationDescriptor('GET /api/v1/auth/me'), context, 'valid', [401]);
  } else if (descriptor.id === 'DELETE /api/v1/devices/{tokenId}') {
    runDescriptor(descriptor, context, 'valid', [404]);
  } else if (descriptor.id === 'POST /api/v1/devices/register') {
    const body = jsonBody(result.response);
    const tokenId = body && body.data && body.data.token_id;
    if (tokenId) {
      runDescriptor(getOperationDescriptor('DELETE /api/v1/devices/{tokenId}'), {
        ...context, ids: { ...context.ids, deviceTokenId: String(tokenId) },
      }, 'valid', [200]);
    }
  }
}

function runRateLimit(context) {
  const login = getOperationDescriptor('POST /api/v1/auth/login');
  const result = runDescriptor(login, context, 'expected_rejection', [401, 429]);
  if (result.response.status === 429) {
    rateLimitResponses.add(1, result.response.tags);
    if (Number(responseHeader(result.response, 'retry-after')) < 1) {
      throw new Error('Rate-limit response did not include a positive Retry-After header');
    }
  }
}

export function runProfile(context) {
  if (profileConfig.guard.profile.name === 'rate-limit') {
    runRateLimit(context);
    return;
  }

  if (profileConfig.guard.profile.name === 'smoke') {
    allDescriptors.forEach((descriptor) => {
      const result = runDescriptor(descriptor, context);
      runPostcondition(result, context);
    });
    return;
  }

  if (allDescriptors.length === 0) throw new Error('No public/auth/device descriptors selected');
  const index = Number(execution.scenario.iterationInTest || 0) % allDescriptors.length;
  const result = runDescriptor(allDescriptors[index], context);
  runPostcondition(result, context);
  const paceSeconds = Number(__ENV.LOAD_TEST_PACE_SECONDS || 0);
  if (Number.isFinite(paceSeconds) && paceSeconds > 0) sleep(Math.min(paceSeconds, 5));
}
