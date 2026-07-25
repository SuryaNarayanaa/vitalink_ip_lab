import { check } from 'k6';

function header(response, name) {
  if (!response || !response.headers) return '';
  const wanted = String(name).toLowerCase();
  const key = Object.keys(response.headers).find((item) => item.toLowerCase() === wanted);
  return key ? String(response.headers[key]) : '';
}

export function normalizeExpectedStatuses(statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses === undefined ? 200 : statuses];
  const normalized = list.map(Number);
  if (normalized.length === 0 || normalized.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    throw new Error('expectedStatuses must contain valid HTTP status codes');
  }
  return normalized;
}

export function evaluateSemanticChecks(response, checks = [], context = {}) {
  const list = Array.isArray(checks)
    ? checks
    : Object.keys(checks).map((name) => ({ name, validate: checks[name] }));
  const results = {};
  const failures = [];

  list.forEach((entry, index) => {
    const name = typeof entry === 'function' ? `semantic check ${index + 1}` : entry.name;
    const validate = typeof entry === 'function' ? entry : entry.validate;
    if (!name || typeof validate !== 'function') throw new Error('Each semantic check needs a stable name and validate function');
    let passed = false;
    try {
      passed = validate(response, context) === true;
    } catch (_) {
      passed = false;
    }
    results[name] = passed;
    if (!passed) failures.push(name);
  });

  if (Object.keys(results).length > 0) {
    const k6Checks = {};
    Object.keys(results).forEach((name) => { k6Checks[name] = () => results[name]; });
    check(response, k6Checks, context.tags || {});
  }
  return { success: failures.length === 0, failures };
}

export function standardResponseChecks(options = {}) {
  const checks = [];
  if (options.contentType) {
    const contentTypes = Array.isArray(options.contentType) ? options.contentType : [options.contentType];
    checks.push({
      name: `content type is ${contentTypes.join(' or ')}`,
      validate: (response) => contentTypes.some((type) => header(response, 'content-type').toLowerCase().includes(String(type).toLowerCase())),
    });
  }
  if (options.requestId) {
    checks.push({
      name: 'response preserves X-Request-Id',
      validate: (response) => header(response, 'x-request-id') === options.requestId,
    });
  }
  return checks;
}

export function jsonBody(response) {
  try {
    return response.json();
  } catch (_) {
    return null;
  }
}

export function responseHeader(response, name) {
  return header(response, name);
}

