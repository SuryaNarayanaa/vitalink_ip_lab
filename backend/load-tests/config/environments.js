/**
 * Committed defaults intentionally include only local targets. Remote staging
 * hosts must be supplied explicitly through LOAD_TEST_ALLOWED_HOSTS.
 */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  '127.0.0.1',
  'localhost',
  'host.docker.internal',
  'vitalink-nginx',
]);

/** Known production targets are denied before the allowlist is considered. */
export const KNOWN_PRODUCTION_HOSTS = Object.freeze([
  'vitalink-uimf.onrender.com',
  'api.vitalink.invalid',
]);

export const PRODUCTION_HOST_PATTERNS = Object.freeze([
  /^api\.vitalink(?:\.|$)/i,
  /(?:^|[.-])prod(?:uction)?(?:[.-]|$)/i,
]);

export function splitHostList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

