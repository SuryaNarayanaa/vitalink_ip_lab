# Clinical SSE runner

`runner.mjs` uses Node's built-in `fetch` and response streams. It covers both canonical doctor and patient notification streams with bearer and single-use ticket authentication, response headers, first-event time, heartbeats, optional notification-delivery latency, deliberate disconnect/reconnect, ticket replay rejection, and the three-connections-per-user cap.

Required environment values are `ALLOW_LOAD_TESTS=true`, `LOAD_TEST_RUN_ID`, `LOAD_TEST_BASE_URL`, and a context supplied with `LOAD_TEST_CONTEXT_FILE` (preferred), `LOAD_TEST_CONTEXT_JSON`, or `SSE_CONTEXT_JSON` containing `tokens.doctor` and `tokens.patient`. Credentials and ticket values are always redacted from output. Use `SSE_ROLES` or `SSE_AUTH_MODES` to run a subset.

An optional `sseTriggers.<role>` context object can contain `path`, `method`, `body`, `tokenRole`, and `expectedStatuses`. When supplied, the runner calls it only on the already guarded target and measures from request start to the next non-`connected` SSE event. Trigger bodies must contain synthetic data only.

Per-user caps are always checked when connection-cap testing is enabled. To exercise the per-IP cap as well, supply `sseCapIdentities` with at least eleven distinct `{ "role": "doctor|patient", "token": "..." }` objects. Set `SSE_REQUIRE_IP_CAP=true` to make a missing per-IP identity pool fail the run.

By default, each stream is held for 27 seconds so at least one 25-second heartbeat is observed. `SSE_OUTPUT_FILE` writes a new, redacted JSON report and refuses to overwrite an existing file.
