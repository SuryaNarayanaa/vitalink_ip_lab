import { sleep } from 'k6'

function boundedInteger(name, value, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}`)
  }
  return parsed
}

function boundedNumber(name, value, fallback, minimum, maximum) {
  const parsed = value === undefined || value === '' ? fallback : Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}`)
  }
  return parsed
}

const vus = boundedInteger('CAPACITY_VUS', __ENV.CAPACITY_VUS, 1, 250)
const durationSeconds = boundedInteger('CAPACITY_DURATION_SECONDS', __ENV.CAPACITY_DURATION_SECONDS, 1, 3600)
const allowedErrorRate = boundedNumber('CAPACITY_ALLOWED_ERROR_RATE', __ENV.CAPACITY_ALLOWED_ERROR_RATE, 0.01, 0, 0.2)
const p95Ms = boundedNumber('CAPACITY_P95_MS', __ENV.CAPACITY_P95_MS, 2000, 1, 120000)
const p99Ms = boundedNumber('CAPACITY_P99_MS', __ENV.CAPACITY_P99_MS, 5000, p95Ms, 180000)
const thinkTimeMs = boundedNumber('CAPACITY_THINK_TIME_MS', __ENV.CAPACITY_THINK_TIME_MS, 0, 0, 60000)

export const capacityOptions = {
  tags: {
    load_run_id: String(__ENV.LOAD_TEST_RUN_ID || 'unknown'),
  },
  scenarios: {
    endpoint_capacity: {
      executor: 'constant-vus',
      vus,
      duration: `${durationSeconds}s`,
      gracefulStop: '15s',
      tags: {
        capacity_endpoint_id: String(__ENV.LOAD_TEST_OPERATION_IDS || ''),
        capacity_phase: String(__ENV.CAPACITY_PHASE || 'measurement'),
      },
    },
  },
  thresholds: {
    checks: [`rate>=${1 - allowedErrorRate}`],
    http_req_failed: [`rate<=${allowedErrorRate}`],
    http_req_duration: [`p(95)<=${p95Ms}`, `p(99)<=${p99Ms}`],
    load_expected_status_rate: [`rate>=${1 - allowedErrorRate}`],
    load_semantic_success_rate: [`rate>=${1 - allowedErrorRate}`],
    load_authorization_violations: ['count==0'],
    load_tenant_violations: ['count==0'],
    load_integrity_failures: ['count==0'],
    load_cleanup_failures: ['count==0'],
    dropped_iterations: ['count==0'],
  },
  setupTimeout: '2m',
  teardownTimeout: '2m',
  discardResponseBodies: false,
  userAgent: `VitaLink-Endpoint-Capacity/${String(__ENV.LOAD_TEST_RUN_ID || 'unknown')}`,
}

export function executeCapacityIteration(runProfile, context) {
  runProfile(context)
  if (thinkTimeMs > 0) sleep(thinkTimeMs / 1000)
}

export function capacityHandleSummary(data) {
  const output = String(__ENV.CAPACITY_SUMMARY_FILE || '').trim()
  if (!output) throw new Error('CAPACITY_SUMMARY_FILE is required')
  return {
    stdout: `capacity step endpoint=${String(__ENV.LOAD_TEST_OPERATION_IDS || '')} vus=${vus}\n`,
    [output]: `${JSON.stringify(data, null, 2)}\n`,
  }
}
