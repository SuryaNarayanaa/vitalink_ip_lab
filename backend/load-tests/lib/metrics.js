import { Counter, Rate, Trend } from 'k6/metrics';

export const requestAttempts = new Counter('load_request_attempts');
export const expectedStatusRate = new Rate('load_expected_status_rate');
export const unexpectedStatuses = new Counter('load_unexpected_statuses');
export const semanticSuccessRate = new Rate('load_semantic_success_rate');
export const semanticFailures = new Counter('load_semantic_failures');
export const authorizationViolations = new Counter('load_authorization_violations');
export const tenantViolations = new Counter('load_tenant_violations');
export const integrityFailures = new Counter('load_integrity_failures');
export const cleanupFailures = new Counter('load_cleanup_failures');
export const responseStatuses = new Counter('load_response_statuses');
export const requestDuration = new Trend('load_request_duration', true);
export const responseBytes = new Counter('load_response_bytes');
export const requestBytes = new Counter('load_request_bytes');

function byteLength(value) {
  if (value === null || value === undefined) return 0;
  // k6 strings are UTF-8; this avoids depending on TextEncoder support.
  return unescape(encodeURIComponent(String(value))).length;
}

export function recordRequestResult(response, details) {
  const tags = details.tags || {};
  const statusTags = { ...tags, status: String(response.status || 0) };
  requestAttempts.add(1, tags);
  responseStatuses.add(1, statusTags);
  expectedStatusRate.add(details.statusExpected, tags);
  semanticSuccessRate.add(details.semanticSuccess, tags);
  if (!details.statusExpected) unexpectedStatuses.add(1, statusTags);
  if (!details.semanticSuccess) semanticFailures.add(details.semanticFailureCount || 1, tags);
  requestDuration.add(response.timings && Number.isFinite(response.timings.duration) ? response.timings.duration : 0, tags);
  responseBytes.add(byteLength(response.body), tags);
  requestBytes.add(byteLength(details.requestBody), tags);
}

export function recordSafetyFailure(kind, tags = {}) {
  const metric = {
    authorization: authorizationViolations,
    tenant: tenantViolations,
    integrity: integrityFailures,
    cleanup: cleanupFailures,
  }[kind];
  if (!metric) throw new Error(`Unknown safety failure kind: ${kind}`);
  metric.add(1, tags);
}

