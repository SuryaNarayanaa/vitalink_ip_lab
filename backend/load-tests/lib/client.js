import http from 'k6/http';
import { check } from 'k6';
import { evaluateSemanticChecks, normalizeExpectedStatuses, standardResponseChecks } from './checks.js';
import { recordRequestResult, recordSafetyFailure } from './metrics.js';
import { normalizeEndpointTags, normalizeRouteTemplate } from './tags.js';

let requestSequence = 0;

function runtimeNumber(name, fallback) {
  if (name === 'vu' && typeof __VU !== 'undefined') return __VU;
  if (name === 'iteration' && typeof __ITER !== 'undefined') return __ITER;
  return fallback;
}

export function makeRequestId(runId) {
  requestSequence += 1;
  const safeRunId = String(runId || 'loadtest').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48);
  return `${safeRunId}-v${runtimeNumber('vu', 0)}-i${runtimeNumber('iteration', 0)}-r${requestSequence}`.slice(0, 120);
}

export function joinUrl(baseUrl, path) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const suffix = String(path || '');
  if (!base) throw new Error('A guarded baseUrl is required');
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function prepareBody(body, headers, encodeJson) {
  if (body === undefined || body === null) return null;
  if (encodeJson && typeof body === 'object' && !(body instanceof ArrayBuffer)) {
    if (!Object.keys(headers).some((name) => name.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(body);
  }
  return body;
}

function normalizeSemanticChecks(checks) {
  if (!checks) return [];
  if (Array.isArray(checks)) return checks;
  return Object.keys(checks).map((name) => ({ name, validate: checks[name] }));
}

/**
 * Instrumented HTTP request. Expected rejection statuses are passed to k6's
 * response callback so deliberate 401/403/409/429 tests do not pollute
 * http_req_failed.
 */
export function loadRequest(options) {
  const method = String(options.method || 'GET').toUpperCase();
  const expectedStatuses = normalizeExpectedStatuses(options.expectedStatuses);
  const requestId = options.requestId || makeRequestId(options.runId);
  const headers = { ...(options.params && options.params.headers ? options.params.headers : {}), ...(options.headers || {}) };
  headers['X-Request-Id'] = requestId;
  if (options.runId) headers['X-Load-Test-Run-Id'] = options.runId;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const routeTemplate = normalizeRouteTemplate(options.routeTemplate || options.path);
  const tags = normalizeEndpointTags({ ...options.tags, method, routeTemplate });
  const body = prepareBody(options.body, headers, options.json !== false);
  const params = {
    ...(options.params || {}),
    headers,
    tags: { ...((options.params && options.params.tags) || {}), ...tags },
    responseCallback: http.expectedStatuses(...expectedStatuses),
  };

  const response = http.request(method, joinUrl(options.baseUrl, options.path), body, params);
  const statusExpected = expectedStatuses.includes(response.status);
  check(response, { [`status is ${expectedStatuses.join(' or ')}`]: () => statusExpected }, tags);

  const semanticChecks = [
    ...standardResponseChecks({ contentType: options.contentType, requestId: options.verifyRequestId === false ? null : requestId }),
    ...normalizeSemanticChecks(options.semanticChecks),
  ];
  const semantics = evaluateSemanticChecks(response, semanticChecks, {
    tags,
    requestId,
    runId: options.runId,
    expectedStatuses,
  });
  recordRequestResult(response, {
    tags,
    statusExpected,
    semanticSuccess: semantics.success,
    semanticFailureCount: semantics.failures.length,
    requestBody: body,
  });
  const safetyFailures = new Set();
  if (!statusExpected && tags.response_class === 'expected_rejection') safetyFailures.add('authorization');
  if (semantics.failures.some((name) => /tenant/i.test(name))) safetyFailures.add('tenant');
  if (options.safetyKind && (!statusExpected || !semantics.success)) safetyFailures.add(options.safetyKind);
  safetyFailures.forEach((kind) => recordSafetyFailure(kind, tags));

  return { response, requestId, tags, statusExpected, semantic: semantics };
}

export function loadJsonRequest(options) {
  return loadRequest({ ...options, json: true, contentType: options.contentType || 'application/json' });
}
