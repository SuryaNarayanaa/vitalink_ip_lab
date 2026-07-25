import {
  DEFAULT_ALLOWED_HOSTS,
  KNOWN_PRODUCTION_HOSTS,
  PRODUCTION_HOST_PATTERNS,
  splitHostList,
} from '../config/environments.js';
import { getProfile } from '../config/profiles.js';

const TRUE = 'true';

export function parseTargetUrl(value) {
  const input = String(value || '').trim();
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)?(?:\?[^#]*)?(?:#.*)?$/i.exec(input);
  if (!match) throw new Error('LOAD_TEST_BASE_URL must be an absolute http(s) URL');

  const authority = match[2];
  if (authority.includes('@')) throw new Error('LOAD_TEST_BASE_URL must not contain user information');

  let hostname = authority;
  let port = '';
  if (authority.startsWith('[')) {
    const close = authority.indexOf(']');
    if (close < 0) throw new Error('LOAD_TEST_BASE_URL contains an invalid IPv6 host');
    hostname = authority.slice(1, close);
    port = authority.slice(close + 1).replace(/^:/, '');
  } else {
    const colon = authority.lastIndexOf(':');
    if (colon > -1 && authority.indexOf(':') === colon) {
      hostname = authority.slice(0, colon);
      port = authority.slice(colon + 1);
    }
  }

  hostname = hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || /\s/.test(hostname)) throw new Error('LOAD_TEST_BASE_URL contains an invalid host');
  if (port && !/^\d{1,5}$/.test(port)) throw new Error('LOAD_TEST_BASE_URL contains an invalid port');

  return {
    input,
    protocol: match[1].toLowerCase(),
    hostname,
    port,
    origin: `${match[1].toLowerCase()}://${authority.toLowerCase()}`,
    pathname: match[3] || '',
  };
}

function normalizeAllowedHost(value) {
  const item = String(value || '').trim().toLowerCase();
  if (!item) return '';
  if (/^https?:\/\//.test(item)) return parseTargetUrl(item).hostname;
  return item.replace(/^\[|\]$/g, '').replace(/:\d+$/, '').replace(/\.$/, '');
}

function isProductionHost(hostname, productionHosts, patterns) {
  if (productionHosts.map(normalizeAllowedHost).includes(hostname)) return true;
  return patterns.some((pattern) => pattern.test(hostname));
}

export function assertAllowedTarget(options) {
  const parsed = parseTargetUrl(options.baseUrl);
  const productionHosts = splitHostList(options.productionHosts || KNOWN_PRODUCTION_HOSTS);
  const patterns = options.productionPatterns || PRODUCTION_HOST_PATTERNS;

  if (isProductionHost(parsed.hostname, productionHosts, patterns)) {
    throw new Error(`Refusing to load test known or production-like host: ${parsed.hostname}`);
  }

  const allowedHosts = splitHostList(options.allowedHosts).map(normalizeAllowedHost);
  if (allowedHosts.length === 0) {
    throw new Error('LOAD_TEST_ALLOWED_HOSTS must explicitly allow the target host');
  }
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`Target host ${parsed.hostname} is not in LOAD_TEST_ALLOWED_HOSTS`);
  }

  const local = ['localhost', '127.0.0.1', '::1', 'host.docker.internal', 'vitalink-nginx'].includes(parsed.hostname);
  if (parsed.protocol !== 'https' && !local && options.allowInsecureRemote !== true) {
    throw new Error('Remote load-test targets must use HTTPS');
  }
  return parsed;
}

export function parseDurationSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value;
  const input = String(value || '').trim().toLowerCase();
  if (!input) throw new Error('A bounded load-test duration is required');
  const unitSeconds = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400 };
  const regex = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let total = 0;
  let consumed = '';
  let match;
  while ((match = regex.exec(input)) !== null) {
    total += Number(match[1]) * unitSeconds[match[2]];
    consumed += match[0];
  }
  if (!Number.isFinite(total) || total <= 0 || consumed !== input) {
    throw new Error(`Invalid duration "${value}"; use a bounded value such as 30s, 10m, or 2h`);
  }
  return total;
}

function boundedNumber(value, fallback, label, options = {}) {
  const resolved = value === undefined || value === null || value === '' ? fallback : Number(value);
  const minimum = options.minimum === undefined ? 0 : options.minimum;
  if (!Number.isFinite(resolved) || resolved < minimum || (options.integer !== false && !Number.isInteger(resolved))) {
    throw new Error(`${label} must be a ${options.integer === false ? 'number' : 'whole number'} >= ${minimum}`);
  }
  return resolved;
}

export function assertWorkloadWithinProfile(profileName, requested = {}) {
  const profile = getProfile(profileName);
  const workload = {
    vus: boundedNumber(requested.vus, profile.defaults.vus, 'VUs'),
    rps: boundedNumber(requested.rps, profile.defaults.rps, 'RPS'),
    duration: requested.duration || profile.defaults.duration,
    uploadBytes: boundedNumber(requested.uploadBytes, profile.defaults.uploadBytes, 'upload bytes'),
    sseConnections: boundedNumber(requested.sseConnections, profile.defaults.sseConnections, 'SSE connections'),
  };
  workload.durationSeconds = parseDurationSeconds(workload.duration);

  const comparisons = [
    ['VUs', workload.vus, profile.caps.vus],
    ['RPS', workload.rps, profile.caps.rps],
    ['duration seconds', workload.durationSeconds, profile.caps.durationSeconds],
    ['upload bytes', workload.uploadBytes, profile.caps.uploadBytes],
    ['SSE connections', workload.sseConnections, profile.caps.sseConnections],
  ];
  comparisons.forEach(([label, actual, cap]) => {
    if (actual > cap) throw new Error(`${label} (${actual}) exceeds the ${profile.name} profile cap (${cap})`);
  });
  return { profile, workload };
}

export function assertEnvironmentFingerprint(expected, actual, expectedRunId, actualRunId) {
  if (!expected || !actual || expected !== actual) {
    throw new Error('Target environment fingerprint does not match the seeded load-test environment');
  }
  if (!expectedRunId || !actualRunId || expectedRunId !== actualRunId) {
    throw new Error('Target seed run ID does not match LOAD_TEST_RUN_ID');
  }
  return true;
}

export function getRuntimeEnv(explicitEnv) {
  if (explicitEnv) return explicitEnv;
  if (typeof __ENV !== 'undefined') return __ENV;
  return {};
}

export function loadGuardConfigFromEnv(explicitEnv) {
  const env = getRuntimeEnv(explicitEnv);
  if (String(env.ALLOW_LOAD_TESTS || '').toLowerCase() !== TRUE) {
    throw new Error('Refusing to run: ALLOW_LOAD_TESTS=true is required');
  }

  const profileName = env.LOAD_TEST_PROFILE || 'smoke';
  const guarded = assertWorkloadWithinProfile(profileName, {
    vus: env.LOAD_TEST_VUS,
    rps: env.LOAD_TEST_RPS,
    duration: env.LOAD_TEST_DURATION,
    uploadBytes: env.LOAD_TEST_UPLOAD_BYTES,
    sseConnections: env.LOAD_TEST_SSE_CONNECTIONS,
  });
  if (guarded.profile.name === 'degraded') {
    throw new Error('The degraded profile is disabled until a dependency fault coordinator and recovery verifier are implemented');
  }

  if (guarded.profile.destructive && String(env.ALLOW_DESTRUCTIVE_LOAD || '').toLowerCase() !== TRUE) {
    throw new Error(`Profile ${guarded.profile.name} is destructive; ALLOW_DESTRUCTIVE_LOAD=true is required`);
  }

  const runId = String(env.LOAD_TEST_RUN_ID || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(runId)) {
    throw new Error('LOAD_TEST_RUN_ID must be 6-80 safe characters and must identify the seeded fixture set');
  }

  const allowedHosts = [
    ...DEFAULT_ALLOWED_HOSTS,
    ...splitHostList(env.LOAD_TEST_ALLOWED_HOSTS),
  ];
  const target = assertAllowedTarget({
    baseUrl: env.LOAD_TEST_BASE_URL,
    allowedHosts,
    productionHosts: [
      ...KNOWN_PRODUCTION_HOSTS,
      ...splitHostList(env.LOAD_TEST_PRODUCTION_HOSTS),
    ],
    allowInsecureRemote: String(env.ALLOW_INSECURE_REMOTE_LOAD || '').toLowerCase() === TRUE,
  });

  const fingerprint = String(env.LOAD_TEST_ENV_FINGERPRINT || '').trim();
  if (!fingerprint) throw new Error('LOAD_TEST_ENV_FINGERPRINT is required');

  return Object.freeze({
    ...guarded,
    runId,
    fingerprint,
    baseUrl: target.input.replace(/\/$/, ''),
    target,
  });
}
