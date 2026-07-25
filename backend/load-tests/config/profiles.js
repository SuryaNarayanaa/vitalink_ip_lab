const minute = 60;
const hour = 60 * minute;

/**
 * Hard safety ceilings. An execution may request values below these limits,
 * but never above them. Defaults are deliberately modest until staging
 * capacity and SLOs have been approved.
 */
export const PROFILE_DEFINITIONS = Object.freeze({
  smoke: Object.freeze({
    name: 'smoke',
    description: 'One controlled pass over the contract surface.',
    executor: 'shared-iterations',
    defaults: Object.freeze({ vus: 1, iterations: 1, duration: '30m', rps: 5, uploadBytes: 10 * 1024 * 1024, sseConnections: 1 }),
    caps: Object.freeze({ vus: 1, rps: 10, durationSeconds: 30 * minute, uploadBytes: 10 * 1024 * 1024, sseConnections: 2 }),
    destructive: true,
  }),
  baseline: Object.freeze({
    name: 'baseline',
    description: 'Low-concurrency isolated endpoint measurements.',
    executor: 'constant-arrival-rate',
    defaults: Object.freeze({ vus: 2, duration: '10m', rps: 10, uploadBytes: 10 * 1024 * 1024, sseConnections: 2 }),
    caps: Object.freeze({ vus: 5, rps: 25, durationSeconds: 30 * minute, uploadBytes: 10 * 1024 * 1024, sseConnections: 5 }),
    destructive: true,
  }),
  load: Object.freeze({
    name: 'load',
    description: 'Realistic weighted target load.',
    executor: 'constant-arrival-rate',
    defaults: Object.freeze({ vus: 25, rps: 20, duration: '30m', uploadBytes: 10 * 1024 * 1024, sseConnections: 20 }),
    caps: Object.freeze({ vus: 100, rps: 100, durationSeconds: hour, uploadBytes: 10 * 1024 * 1024, sseConnections: 100 }),
    destructive: true,
  }),
  stress: Object.freeze({
    name: 'stress',
    description: 'Bounded stepped search for the first saturation point.',
    executor: 'ramping-arrival-rate',
    defaults: Object.freeze({ vus: 50, rps: 40, duration: '30m', uploadBytes: 10 * 1024 * 1024, sseConnections: 50 }),
    caps: Object.freeze({ vus: 250, rps: 250, durationSeconds: hour, uploadBytes: 10 * 1024 * 1024, sseConnections: 250 }),
    destructive: true,
  }),
  spike: Object.freeze({
    name: 'spike',
    description: 'Short bounded traffic and reconnect burst.',
    executor: 'ramping-arrival-rate',
    defaults: Object.freeze({ vus: 75, rps: 75, duration: '10m', uploadBytes: 10 * 1024 * 1024, sseConnections: 75 }),
    caps: Object.freeze({ vus: 300, rps: 300, durationSeconds: 20 * minute, uploadBytes: 10 * 1024 * 1024, sseConnections: 300 }),
    destructive: true,
  }),
  soak: Object.freeze({
    name: 'soak',
    description: 'Sustained target load for leak and drift detection.',
    executor: 'constant-arrival-rate',
    defaults: Object.freeze({ vus: 25, rps: 20, duration: '2h', uploadBytes: 10 * 1024 * 1024, sseConnections: 20 }),
    caps: Object.freeze({ vus: 100, rps: 100, durationSeconds: 8 * hour, uploadBytes: 10 * 1024 * 1024, sseConnections: 100 }),
    destructive: true,
  }),
  'rate-limit': Object.freeze({
    name: 'rate-limit',
    description: 'Protection-on verification, separate from capacity results.',
    executor: 'constant-arrival-rate',
    defaults: Object.freeze({ vus: 10, rps: 35, duration: '5m', uploadBytes: 1024, sseConnections: 1 }),
    caps: Object.freeze({ vus: 50, rps: 150, durationSeconds: 15 * minute, uploadBytes: 1024, sseConnections: 5 }),
    destructive: false,
  }),
  degraded: Object.freeze({
    name: 'degraded',
    description: 'Bounded dependency-failure and recovery exercise.',
    executor: 'constant-arrival-rate',
    defaults: Object.freeze({ vus: 10, duration: '15m', rps: 15, uploadBytes: 10 * 1024 * 1024, sseConnections: 10 }),
    caps: Object.freeze({ vus: 50, rps: 75, durationSeconds: 30 * minute, uploadBytes: 10 * 1024 * 1024, sseConnections: 50 }),
    destructive: true,
  }),
});

export const PROFILE_ALIASES = Object.freeze({
  'contract-smoke': 'smoke',
  'endpoint-baseline': 'baseline',
  'realistic-load': 'load',
  'degraded-dependencies': 'degraded',
});

export function resolveProfileName(name) {
  const normalized = String(name || 'smoke').trim().toLowerCase();
  return PROFILE_ALIASES[normalized] || normalized;
}

export function getProfile(name) {
  const resolved = resolveProfileName(name);
  const profile = PROFILE_DEFINITIONS[resolved];
  if (!profile) {
    throw new Error(`Unknown load-test profile "${name}". Expected one of: ${Object.keys(PROFILE_DEFINITIONS).join(', ')}`);
  }
  return profile;
}
