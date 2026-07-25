# VitaLink full-system load testing

This directory contains the guarded k6 harness, source-derived endpoint inventory,
synthetic fixtures, scenario descriptors, SSE runner, and report merger for an
authorized non-production VitaLink environment. It fails closed: production-like
hosts are rejected, target hosts must be explicitly allowlisted, profiles are
capped, and fixture cleanup uses exact IDs plus ownership signatures from a durable
journal.

## Coverage contract

The generated inventory currently requires **194 explicit operations**:

- 95 canonical Express/OpenAPI operations;
- 95 legacy `/api` aliases (reachability and deprecation parity, never capacity traffic);
- 3 global operations (`/`, liveness, and readiness);
- 1 Nginx edge-health operation.

Five documentation operations are conditional on documentation being enabled.
There are also 251 derived protocol checks, including HEAD, OPTIONS/CORS, SSE, and
relationship checks. They are inventoried separately and do not inflate the
194-operation mandatory denominator. The final endpoint report covers the 194
mandatory operations; derived checks that were not explicitly enabled must not be
claimed as executed.

Run the complete static gate from `backend`:

```powershell
npm.cmd run load:verify
```

```sh
npm run load:verify
```

This regenerates the deterministic inventory, reconciles source routes with
OpenAPI, type-checks all load-test TypeScript, proves scenario coverage, and runs
the report-merger unit test. CI additionally fails when regeneration changes the
committed `load-tests/generated/endpoints.json`.

## Smoke is not capacity

`smoke` is a one-VU, one-pass contract exercise. It answers whether routes are
reachable, status/envelope/tenant checks behave as expected, and every required
operation is accounted for. Legacy aliases and permission-denied probes belong
only in this phase.

`baseline`, `load`, `stress`, `spike`, `soak`, and `rate-limit` are capacity or
resilience profiles. Run them only after a clean smoke report, with approved SLOs,
monitoring, provider stubs or quotas, a rollback owner, and dedicated staging.
Never extrapolate capacity from smoke latency. Caps in `config/profiles.js` are
hard ceilings, not recommended targets.

The `degraded` profile is intentionally fail-closed for now. Its bounded profile
definition documents the intended workload, but the guard refuses execution
until an automated dependency fault coordinator and recovery verifier exist.
Merely sending normal traffic while labeling it degraded is not valid resilience
evidence.

The checked-in GitHub dispatch runs only the conservative public/auth/device
contract smoke in a protected `load-test-staging` environment. It uses `auto`
mode so operational GETs are exercised successfully while state-changing routes
use expected rejections, and it does not enable
`LOAD_TEST_VALID_MUTATIONS`; it is not a whole-system capacity test. The local
`load:suite` command covers all 194 operations by combining successful read paths,
safe rejection contracts for state-changing paths, legacy reachability, and SSE.

Configure the GitHub `load-test-staging` environment with required reviewers,
deployment-branch restrictions, and these environment secrets:

- `LOAD_TEST_EXECUTION_APPROVED` set to `true` only for an approved window;
- `LOAD_TEST_BASE_URL` containing the dedicated non-production HTTPS origin;
- `LOAD_TEST_ALLOWED_HOSTS` explicitly containing that origin's hostname;
- `LOAD_TEST_ENV_FINGERPRINT` matching the seeded staging environment;
- `LOAD_TEST_RUN_ID` matching the authorized synthetic fixture run;
- `LOAD_TEST_SCENARIO_CONTEXT_JSON` containing only the minimal smoke context.

The dispatch also requires the exact phrase `AUTHORIZED NON-PRODUCTION SMOKE`.
Repository secrets are intentionally not used for target authorization. Remove or
set `LOAD_TEST_EXECUTION_APPROVED=false` when the window closes. Because this
conservative job neither seeds nor finalizes remote fixtures, its artifact is
smoke evidence, not the final 194-operation report; the full operator workflow
must still reconcile cleanup and merge results.

## Safety prerequisites

Before live requests:

1. Obtain written authorization for target, window, ceilings, and stop conditions.
2. Use an isolated, synthetic, non-production database and accounts.
3. Ensure observability and an operator with authority to abort are present.
4. Disable or stub external email, SMS, payment, and push providers.
5. Use a unique run ID and retain the cleanup journal outside ephemeral containers.
6. Never put tokens, passwords, context JSON, or provider secrets in Git, logs, reports, or shell history.

Every k6 entrypoint requires `ALLOW_LOAD_TESTS=true`, an explicitly allowlisted
base host, a matching environment fingerprint/run ID exposed by the target
readiness response, and a bounded profile. Start the isolated API with
`LOAD_TEST_IDENTITY_ENABLED=true`, `LOAD_TEST_ENV_FINGERPRINT`, and
`LOAD_TEST_RUN_ID`; the suite fails before VU traffic when either header differs.
Current
profiles are conservatively classified as destructive because they can exercise
stateful application paths, so `ALLOW_DESTRUCTIVE_LOAD=true` is also required.
That flag authorizes the guarded harness only. Valid mutations are deliberately
disabled until a durable dynamic mutation ledger can capture returned IDs,
restore snapshots, and reconcile provider/file side effects. Contract mode sends
state-changing routes explicit unauthenticated rejection probes instead.

## Local isolated dependencies

Docker Desktop (Windows) or Docker Engine with Compose is required. From the
repository root:

```powershell
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml up -d
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml ps
Invoke-WebRequest http://127.0.0.1:18081/nginx-health
```

```sh
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml up -d
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml ps
curl --fail --show-error http://127.0.0.1:18081/nginx-health
```

The project provides replica-set MongoDB on loopback port 27018, Redis on 6380,
a provider stub on 18080, and Nginx on 18081. Nginx proxies to a host-run API on
port 3001. Start that API with the same isolated Mongo/Redis configuration and JWT
secret used to seed sessions. Never target normal developer, shared, or production data.

## Fixture lifecycle

Use a unique 8-64 character run ID. These examples use placeholders; supply
test-only secrets through a secure shell or session-secret facility.

Windows PowerShell, from `backend`:

```powershell
$env:NODE_ENV = 'test'
$env:ALLOW_LOAD_TESTS = 'true'
$env:LOAD_TEST_RUN_ID = 'local_smoke_20260722_01'
$env:LOAD_TEST_MONGO_URI = 'mongodb://127.0.0.1:27018/vitalink_load_test?replicaSet=rs0&directConnection=true'
$env:LOAD_TEST_ALLOWED_DB_HOSTS = '127.0.0.1'
$env:LOAD_TEST_STATE_DIR = (Resolve-Path 'load-tests').Path + '\.state'
$env:LOAD_TEST_FIXTURE_PASSWORD = '<test-only-password-at-least-16-characters>'
$env:LOAD_TEST_JWT_SECRET = '<test-only-jwt-secret-at-least-32-characters>'
npm.cmd run load:fixtures:dry-run
npm.cmd run load:fixtures:seed
npm.cmd run load:fixtures:verify
npm.cmd run load:fixtures:context
```

POSIX shell, from `backend`:

```sh
export NODE_ENV=test
export ALLOW_LOAD_TESTS=true
export LOAD_TEST_RUN_ID=local_smoke_20260722_01
export LOAD_TEST_MONGO_URI='mongodb://127.0.0.1:27018/vitalink_load_test?replicaSet=rs0&directConnection=true'
export LOAD_TEST_ALLOWED_DB_HOSTS=127.0.0.1
export LOAD_TEST_STATE_DIR="$(pwd)/load-tests/.state"
export LOAD_TEST_FIXTURE_PASSWORD='<test-only-password-at-least-16-characters>'
export LOAD_TEST_JWT_SECRET='<test-only-jwt-secret-at-least-32-characters>'
npm run load:fixtures:dry-run
npm run load:fixtures:seed
npm run load:fixtures:verify
npm run load:fixtures:context
```

Seed writes `<runId>.cleanup-journal.json` and an ignored
`<runId>.session-secrets.json` under `LOAD_TEST_STATE_DIR`; the context command
creates an ignored `<runId>.scenario-context.json` without echoing credentials.
Pass that file with `LOAD_TEST_CONTEXT_FILE` (preferred) to every local runner.
The journal is
the recovery record; copy it to durable storage before a remote run.

Always finalize in an independent process, including after k6 failure, Ctrl+C,
timeout, or CI cancellation. Run it twice to prove idempotency:

```powershell
npm.cmd run load:fixtures:finalize
npm.cmd run load:fixtures:finalize
```

```sh
npm run load:fixtures:finalize
npm run load:fixtures:finalize
```

Success requires journal state `clean`; owned records and the session-secrets file
are removed. A failed or non-clean journal makes the report incomplete. Never
replace the finalizer with `deleteMany`, a database drop, or volume deletion.

After clean finalization, stop only this Compose project (volumes are retained):

```powershell
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml down
```

```sh
docker compose -p vitalink-load-test -f deploy/load-test/docker-compose.yml down
```

Do not add `--volumes` unless cleanup is clean and an operator explicitly approves
discarding isolated dependency data.

## k6 image and inspection

Use the pinned image `grafana/k6:2.1.0`. From the repository root, these commands
perform import/config inspection only and send no requests.

Windows PowerShell:

```powershell
$inspect = @(
  'load-tests/scenarios/public-auth-devices/scenario.js',
  'load-tests/scenarios/clinical/runner.js',
  'load-tests/scenarios/admin-platform/runner.js',
  'load-tests/scenarios/legacy/runner.js'
)
foreach ($entrypoint in $inspect) {
  docker run --rm -v "${PWD}:/work" -w /work/backend grafana/k6:2.1.0 inspect --no-color --summary-mode=disabled `
    -e ALLOW_LOAD_TESTS=true -e ALLOW_DESTRUCTIVE_LOAD=true `
    -e LOAD_TEST_RUN_ID=ci_inspect_contract -e LOAD_TEST_PROFILE=smoke `
    -e LOAD_TEST_BASE_URL=http://host.docker.internal:18081 `
    -e LOAD_TEST_ALLOWED_HOSTS=host.docker.internal `
    -e LOAD_TEST_ENV_FINGERPRINT=inspect-only `
    -e LOAD_TEST_CONTEXT_FILE=/work/backend/load-tests/config/inspect-context.json $entrypoint | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "k6 inspect failed: $entrypoint" }
}
```

POSIX shell:

```sh
for entrypoint in \
  load-tests/scenarios/public-auth-devices/scenario.js \
  load-tests/scenarios/clinical/runner.js \
  load-tests/scenarios/admin-platform/runner.js \
  load-tests/scenarios/legacy/runner.js
do
  docker run --rm -v "$PWD:/work" -w /work/backend grafana/k6:2.1.0 \
    inspect --no-color --summary-mode=disabled \
    -e ALLOW_LOAD_TESTS=true -e ALLOW_DESTRUCTIVE_LOAD=true \
    -e LOAD_TEST_RUN_ID=ci_inspect_contract -e LOAD_TEST_PROFILE=smoke \
    -e LOAD_TEST_BASE_URL=http://host.docker.internal:18081 \
    -e LOAD_TEST_ALLOWED_HOSTS=host.docker.internal \
    -e LOAD_TEST_ENV_FINGERPRINT=inspect-only \
    -e LOAD_TEST_CONTEXT_FILE=/work/backend/load-tests/config/inspect-context.json "$entrypoint" >/dev/null
done
```

## Authorized public contract smoke

Create the output directory first because `handleSummary` does not create nested
directories. The examples below use a minimal environment value because they run
expected rejections; fixture-backed runners should instead mount and set the
ignored `LOAD_TEST_CONTEXT_FILE`. This example intentionally does not enable valid
mutations.

Windows PowerShell, from the repository root:

```powershell
$runId = 'local_smoke_20260722_01'
$reportRoot = "backend/load-tests/reports/$runId-smoke"
New-Item -ItemType Directory -Force $reportRoot | Out-Null
$env:LOAD_TEST_SCENARIO_CONTEXT_JSON = '{"runId":"local_smoke_20260722_01"}'
docker run --rm -v "${PWD}:/work" -w /work/backend `
  -e LOAD_TEST_SCENARIO_CONTEXT_JSON `
  grafana/k6:2.1.0 run --no-color `
  -e ALLOW_LOAD_TESTS=true -e ALLOW_DESTRUCTIVE_LOAD=true `
  -e LOAD_TEST_RUN_ID=$runId -e LOAD_TEST_PROFILE=smoke `
  -e LOAD_TEST_BASE_URL=http://host.docker.internal:18081 `
  -e LOAD_TEST_ALLOWED_HOSTS=host.docker.internal `
  -e LOAD_TEST_ENV_FINGERPRINT=local-compose `
  -e LOAD_TEST_OPERATION_MODE=auto `
  -e LOAD_TEST_REPORT_DIR=load-tests/reports `
  --out "json=load-tests/reports/$runId-smoke/raw-k6.json" `
  load-tests/scenarios/public-auth-devices/scenario.js
```

POSIX shell, from the repository root:

```sh
run_id=local_smoke_20260722_01
mkdir -p "backend/load-tests/reports/$run_id-smoke"
export LOAD_TEST_SCENARIO_CONTEXT_JSON="{\"runId\":\"$run_id\"}"
docker run --rm -v "$PWD:/work" -w /work/backend \
  -e LOAD_TEST_SCENARIO_CONTEXT_JSON \
  grafana/k6:2.1.0 run --no-color \
  -e ALLOW_LOAD_TESTS=true -e ALLOW_DESTRUCTIVE_LOAD=true \
  -e LOAD_TEST_RUN_ID="$run_id" -e LOAD_TEST_PROFILE=smoke \
  -e LOAD_TEST_BASE_URL=http://host.docker.internal:18081 \
  -e LOAD_TEST_ALLOWED_HOSTS=host.docker.internal \
  -e LOAD_TEST_ENV_FINGERPRINT=local-compose \
  -e LOAD_TEST_OPERATION_MODE=auto \
  -e LOAD_TEST_REPORT_DIR=load-tests/reports \
  --out "json=load-tests/reports/$run_id-smoke/raw-k6.json" \
  load-tests/scenarios/public-auth-devices/scenario.js
```

## Complete guarded 194-operation suite

After dependencies, the isolated API, fixtures, and scenario context are ready,
set `LOAD_TEST_SSE_BASE_URL` to the host-reachable edge URL (normally
`http://127.0.0.1:18081`) and run from `backend`:

```powershell
$env:LOAD_TEST_CONTEXT_FILE = (Resolve-Path "load-tests/.state/$env:LOAD_TEST_RUN_ID.scenario-context.json").Path
$env:LOAD_TEST_SSE_BASE_URL = 'http://127.0.0.1:18081'
npm.cmd run load:suite
```

```sh
export LOAD_TEST_CONTEXT_FILE="$(pwd)/load-tests/.state/$LOAD_TEST_RUN_ID.scenario-context.json"
export LOAD_TEST_SSE_BASE_URL=http://127.0.0.1:18081
npm run load:suite
```

The suite runs public/auth/device `auto` mode, clinical/admin `contract` mode,
the 95 legacy aliases exactly once, and the guarded SSE runner. Its `finally`
path always runs the exact-ID fixture finalizer. It then merges all raw JSON-lines
and SSE evidence into JSON, CSV, Markdown, and HTML under
`load-tests/reports/<run-id>/final`. The report records evidence classes and lists
every rejection-only operation so it cannot be confused with valid mutation
coverage. Missing operations, mixed run IDs, failed SSE protocol checks, or
non-clean finalization make the suite fail.

Legacy aliases must remain reachability-only; never include them in baseline,
load, or stress traffic. Capacity profiles operate only on non-mutating paths
until the mutation ledger is implemented.

## Merge results and generate the report

Run finalization first so the merger can prove cleanup. From `backend`:

```powershell
npm.cmd run load:report -- --inventory load-tests/generated/endpoints.json `
  --k6-json load-tests/reports/<run-id>/public.json `
  --k6-json load-tests/reports/<run-id>/clinical.json `
  --k6-json load-tests/reports/<run-id>/admin.json `
  --k6-json load-tests/reports/<run-id>/legacy.json `
  --sse-json load-tests/reports/<run-id>/sse-summary.json `
  --environment load-tests/reports/<run-id>/environment.json `
  --cleanup-journal load-tests/.state/<run-id>.cleanup-journal.json `
  --output load-tests/reports/<run-id>/final
```

```sh
npm run load:report -- \
  --inventory load-tests/generated/endpoints.json \
  --k6-json load-tests/reports/<run-id>/public.json \
  --k6-json load-tests/reports/<run-id>/clinical.json \
  --k6-json load-tests/reports/<run-id>/admin.json \
  --k6-json load-tests/reports/<run-id>/legacy.json \
  --sse-json load-tests/reports/<run-id>/sse-summary.json \
  --environment load-tests/reports/<run-id>/environment.json \
  --cleanup-journal load-tests/.state/<run-id>.cleanup-journal.json \
  --output load-tests/reports/<run-id>/final
```

Add `--include-docs` only when the five conditional documentation operations were
enabled and executed. Outputs are `summary.json`, `endpoints.csv`, `report.md`, and
`report.html`. The command exits nonzero when coverage is missing, checks fail, or
cleanup is not clean. Store raw k6/SSE data, inventory digest, application and
infrastructure telemetry, sanitized environment metadata, and final report together.

## Abort conditions

Stop immediately for tenant leakage, authorization bypass, clinical-integrity
errors, cleanup ownership mismatch, unexpected provider traffic, sustained errors
beyond the approved SLO, dependency saturation that threatens the environment, or
an operator request. Preserve evidence, run the out-of-process finalizer, and mark
the run incomplete even if k6 thresholds happened to pass.
