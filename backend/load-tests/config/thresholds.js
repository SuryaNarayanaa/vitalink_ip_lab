/**
 * Latency values are conservative provisional gates. Override them with
 * approved values through buildThresholds({ latencyMsByClass }) before a
 * capacity sign-off; correctness gates are never optional.
 */
export const THRESHOLD_CLASSES = Object.freeze({
  operational_read: Object.freeze({ p95: 500, p99: 1000 }),
  authenticated_read: Object.freeze({ p95: 1000, p99: 2000 }),
  aggregation_read: Object.freeze({ p95: 2000, p99: 4000 }),
  clinical_write: Object.freeze({ p95: 1500, p99: 3000 }),
  admin_write: Object.freeze({ p95: 2500, p99: 5000 }),
  upload: Object.freeze({ p95: 5000, p99: 10000 }),
  external_provider: Object.freeze({ p95: 5000, p99: 10000 }),
  sse_connect: Object.freeze({ p95: 2000, p99: 5000 }),
});

export const CORRECTNESS_THRESHOLDS = Object.freeze({
  checks: ['rate==1'],
  load_expected_status_rate: ['rate==1'],
  load_semantic_success_rate: ['rate==1'],
  load_unexpected_statuses: ['count==0'],
  load_semantic_failures: ['count==0'],
  load_authorization_violations: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '1s' }],
  load_tenant_violations: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '1s' }],
  load_integrity_failures: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '1s' }],
  load_cleanup_failures: [{ threshold: 'count==0', abortOnFail: true, delayAbortEval: '1s' }],
  dropped_iterations: ['count==0'],
});

export function buildThresholds(options = {}) {
  const includeLatency = options.includeLatency !== false;
  const approved = options.latencyMsByClass || {};
  const thresholds = { ...CORRECTNESS_THRESHOLDS };
  if (options.continueOnSafetyFailure === true) {
    for (const metric of [
      'load_authorization_violations',
      'load_tenant_violations',
      'load_integrity_failures',
      'load_cleanup_failures',
    ]) {
      thresholds[metric] = ['count==0'];
    }
  }

  if (!includeLatency) return thresholds;

  Object.keys(THRESHOLD_CLASSES).forEach((className) => {
    const values = { ...THRESHOLD_CLASSES[className], ...(approved[className] || {}) };
    thresholds[`load_request_duration{threshold_class:${className}}`] = [
      `p(95)<${values.p95}`,
      `p(99)<${values.p99}`,
    ];
  });
  return thresholds;
}
