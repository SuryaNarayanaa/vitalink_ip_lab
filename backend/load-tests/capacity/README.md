# Per-endpoint concurrent virtual-user capacity discovery

This controller runs one eligible endpoint and one authorized workload variant
at a time with k6's closed `constant-vus` model. It performs a configurable
staircase, stops after the first failure, binary-refines the passing/failing
boundary, and repeats the final passing candidate. It records achieved RPS as
well as active VUs.

The current fixture context reuses one authenticated session per role. These
results therefore measure concurrent k6 virtual users (VUs), not distinct
logged-in human identities. Do not present them as a unique-account limit until
per-VU account/session pools are generated.

The controller does **not** start the API, Docker Compose, seed fixtures, or
finalize fixtures. Those remain the external orchestrator's responsibility.
`checkpoint.json` always records whether external fixture finalization is
required.

## Evidence boundaries

- Valid read-only and descriptor-declared bounded/expiring operations are
  eligible.
- Valid mutations are blocked until the dynamic mutation ledger can restore
  every changed record and provider/storage side effect.
- Uploads are separately labelled and are not assigned a write-capacity claim.
- Legacy aliases inherit the canonical handler's result and are not saturated a
  second time.
- SSE streams are labelled for the specialized distinct-identity connection
  runner; ordinary HTTP VUs do not represent long-lived stream capacity.
- Admin endpoints run every authorized role variant. The endpoint result is the
  minimum passing capacity across variants, so a Hospital Admin failure cannot
  be hidden by a passing App Admin run.

Passing at the configured ceiling produces `>=N`, not an exact maximum.

## Plan-only inventory

From `backend`:

```powershell
$env:LOAD_TEST_RUN_ID = "capacity_plan_001"
node load-tests/capacity/controller.mjs
```

This sends no requests and writes `manifest.json`, `capacity.json`,
`capacity.csv`, `capacity.md`, and `capacity.html`.

## Execute against an already-running isolated API

The target must return HTTP 200 and expose the exact load-test environment
fingerprint and run ID on `/health/ready` before and after every step. The
context file must be inside `backend`.

```powershell
$env:ALLOW_LOAD_TESTS = "true"
$env:ALLOW_CAPACITY_DISCOVERY = "true"
$env:CAPACITY_EXECUTE = "true"
$env:LOAD_TEST_RUN_ID = "capacity_local_001"
$env:LOAD_TEST_BASE_URL = "http://host.docker.internal:18081"
$env:LOAD_TEST_ALLOWED_HOSTS = "host.docker.internal"
$env:LOAD_TEST_ENV_FINGERPRINT = "local-capacity-001"
$env:LOAD_TEST_CONTEXT_FILE = "C:\Projects\vitalink_ip_lab\backend\load-tests\.state\capacity_local_001.scenario-context.json"
$env:CAPACITY_MAX_VUS = "100"
$env:CAPACITY_STEPS = "1,2,5,10,20,40,80,100"
$env:CAPACITY_STEP_DURATION = "30s"
$env:CAPACITY_WARMUP_DURATION = "10s"
$env:CAPACITY_CONFIRMATIONS = "3"
$env:CAPACITY_THINK_TIME_MS = "0"
$env:CAPACITY_PROMETHEUS_RW_URL = "http://host.docker.internal:19090/api/v1/write"
$env:CAPACITY_PUSHGATEWAY_URL = "http://127.0.0.1:19091"
$env:CAPACITY_DASHBOARD_URL = "http://127.0.0.1:13000/d/vitalink-endpoint-capacity"
node load-tests/capacity/controller.mjs
```

Optional controls:

- `CAPACITY_ENDPOINT_IDS`: comma-separated isolated subset.
- `CAPACITY_MAX_ENDPOINTS`: bounded prefix for a rehearsal.
- `CAPACITY_ALLOWED_ERROR_RATE`: default `0.01`.
- `CAPACITY_P95_MS` and `CAPACITY_P99_MS`: global approved SLO overrides.
- `CAPACITY_MAX_REFINEMENTS`: default `16`.
- `CAPACITY_OUTPUT_DIR`: must remain inside `backend`.
- `CAPACITY_PROMETHEUS_RW_URL`: optional local Prometheus remote-write receiver
  used for live k6 metrics.
- `CAPACITY_PUSHGATEWAY_URL`: optional loopback Pushgateway URL. When set, a
  completed breakpoint must publish successfully or the controller fails.
- `CAPACITY_METRICS_URL` and `CAPACITY_DASHBOARD_URL`: recorded as report links.

## Resume

Use the exact same run ID, target, endpoint selection, staircase, durations,
thresholds, and output directory:

```powershell
$env:CAPACITY_RESUME = "true"
node load-tests/capacity/controller.mjs
```

The checkpoint is updated after every role/tenant load step and every completed
endpoint. A mismatched configuration is refused.

## Pass/fail decision

The core result uses k6 correctness, expected-status, semantic, HTTP-error,
latency, authorization, tenant-isolation, integrity, cleanup, and
dropped-iteration thresholds. Prometheus and Grafana provide supporting system
telemetry but do not silently turn an invalid HTTP result into a pass.

Run the controller tests from `backend`:

```powershell
node --test load-tests/capacity/capacity.test.mjs
```
