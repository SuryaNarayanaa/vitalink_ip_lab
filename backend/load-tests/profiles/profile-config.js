import { buildThresholds } from '../config/thresholds.js';
import { loadGuardConfigFromEnv } from '../lib/guards.js';
import { makeHandleSummary } from '../lib/summary.js';

function secondsDuration(seconds) {
  return `${Math.max(1, Math.floor(seconds))}s`;
}

function splitDuration(totalSeconds, weights) {
  let assigned = 0;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return Math.max(1, totalSeconds - assigned);
    const seconds = Math.max(1, Math.floor(totalSeconds * weight));
    assigned += seconds;
    return seconds;
  });
}

export function buildExecutionScenario(profile, workload, exec = 'runProfile') {
  const common = { exec, gracefulStop: '30s', tags: { load_profile: profile.name } };
  if (profile.executor === 'shared-iterations') {
    return {
      ...common,
      executor: 'shared-iterations',
      vus: workload.vus,
      iterations: profile.defaults.iterations || 1,
      maxDuration: workload.duration,
    };
  }
  if (profile.executor === 'constant-vus') {
    return { ...common, executor: 'constant-vus', vus: workload.vus, duration: workload.duration };
  }
  if (profile.executor === 'constant-arrival-rate') {
    return {
      ...common,
      executor: 'constant-arrival-rate',
      rate: workload.rps,
      timeUnit: '1s',
      duration: workload.duration,
      preAllocatedVUs: Math.max(1, Math.min(workload.vus, Math.ceil(workload.rps / 2))),
      maxVUs: workload.vus,
    };
  }
  if (profile.executor === 'ramping-arrival-rate') {
    const spike = profile.name === 'spike';
    const parts = splitDuration(workload.durationSeconds, spike ? [0.2, 0.2, 0.4, 0.2] : [0.2, 0.25, 0.25, 0.2, 0.1]);
    const rates = spike
      ? [Math.max(1, Math.floor(workload.rps * 0.2)), workload.rps, workload.rps, 0]
      : [Math.max(1, Math.floor(workload.rps * 0.25)), Math.max(1, Math.floor(workload.rps * 0.5)), Math.max(1, Math.floor(workload.rps * 0.75)), workload.rps, 0];
    return {
      ...common,
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      preAllocatedVUs: Math.max(1, Math.min(workload.vus, Math.ceil(workload.rps / 2))),
      maxVUs: workload.vus,
      stages: rates.map((target, index) => ({ target, duration: secondsDuration(parts[index]) })),
    };
  }
  throw new Error(`Unsupported k6 executor: ${profile.executor}`);
}

export function createProfileConfig(options = {}) {
  const guard = loadGuardConfigFromEnv(options.env);
  const env = options.env || (typeof __ENV !== 'undefined' ? __ENV : {});
  const scenarioName = options.scenarioName || `${guard.profile.name.replace(/-/g, '_')}_profile`;
  const k6Options = {
    scenarios: {
      [scenarioName]: buildExecutionScenario(guard.profile, guard.workload, options.exec || 'runProfile'),
    },
    thresholds: buildThresholds({
      includeLatency: options.includeLatency !== false,
      latencyMsByClass: options.latencyMsByClass,
      continueOnSafetyFailure: String(env.LOAD_TEST_REQUIRE_COMPLETE_COVERAGE || '').toLowerCase() === 'true',
    }),
    setupTimeout: options.setupTimeout || '10m',
    teardownTimeout: options.teardownTimeout || '10m',
    noConnectionReuse: false,
    userAgent: `VitaLink-Authorized-Load-Test/${guard.runId}`,
    tags: {
      load_profile: guard.profile.name,
      load_run_id: guard.runId,
    },
  };

  const handleSummary = makeHandleSummary({
    runId: guard.runId,
    profile: guard.profile.name,
    targetHost: guard.target.hostname,
    gitSha: env.LOAD_TEST_GIT_SHA || 'unknown',
    outputDir: env.LOAD_TEST_REPORT_DIR || 'load-tests/reports',
    cleanupStatus: 'pending_external_reconciliation',
  });
  return Object.freeze({ guard, options: k6Options, handleSummary });
}
