# Dynamic mutation safety

This subsystem is intentionally fail-closed. It makes a valid write eligible for
capacity testing only after the runner has an exclusive per-VU fixture and has
durably planned every possible side effect **before** sending the API request.
It does not, by itself, authorize valid mutation traffic.

## Lifecycle

1. The Node orchestrator starts `sidecar.ts` on loopback with the normal fixture
   guards plus `ALLOW_DESTRUCTIVE_LOAD=true` and a secret
   `LOAD_TEST_MUTATION_SECRET` of at least 32 characters.
2. Before the measured API call, k6 sends `POST /v1/plan` with its stable
   endpoint ID, `__VU`, `exec.scenario.iterationInTest`, and the complete cleanup
   effect plan. The sidecar returns a deterministic allocation and lease token.
3. The request body includes `allocation.requestSuffix` or
   `allocation.ownershipToken` in a field that survives in every created
   record. Snapshot mutations journal the complete pre-request snapshot and its
   `snapshotDigest()` before the API call.
4. The API call is timed. Sidecar calls must not be included in endpoint latency.
5. k6 sends `POST /v1/observe` with the response status and returned exact IDs.
   Observed effects must exactly match the predeclared effect kinds,
   collections/providers, and ownership signatures.
6. The out-of-process finalizer runs even after k6 cancellation:
   `npx tsx load-tests/mutations/finalize.ts`.
7. The report may claim valid-write evidence only if the dynamic ledger is
   `clean`, every entry is `reconciled`, and the static fixture journal is also
   clean.

The durable plan closes the crash window between an API success and the load
generator recording its response. Database creates may initially omit the ID;
the reconciler locates at most one record using the exact predeclared ownership
signatures. More than one match, an ownership mismatch, a corrupt snapshot, or
an unknown effect kind stops cleanup.

## Effect types

- `database-delete`: exact ID when known plus one or more immutable ownership
  signatures. A missing ID is allowed only for create recovery.
- `database-restore`: exact ID, immutable ownership signatures, complete
  pre-request snapshot, and SHA-256 digest.
- `session`: exact ID/signatures, with explicit delete or revoke action.
- `provider`: provider ID, external ID, action, and ownership. No built-in
  handler exists.
- `file`: storage provider/key, metadata identity/snapshot, and ownership. No
  built-in handler exists.

Provider and file effects are recordable but deliberately unreconcilable until
the orchestrator registers an exact, idempotent compensating handler. This
keeps payment, FCM, object-storage, and malware-scan flows blocked.

## k6 request shape

```javascript
const planned = http.post(`${ledgerUrl}/v1/plan`, JSON.stringify({
  endpointId: operation.id,
  vuId: __VU,
  iteration: exec.scenario.iterationInTest,
  effects: cleanupEffects,
}), {
  headers: {
    'content-type': 'application/json',
    'x-load-mutation-secret': __ENV.LOAD_TEST_MUTATION_SECRET,
  },
  tags: { internal_control: 'mutation-plan' },
})
```

Never reuse a scalar mutable fixture through modulo selection. The future
scenario-context schema must contain at least one doctor/patient/disposable
target per configured VU; `selectExclusiveVuContext()` refuses undersized pools.

## Current readiness

`readiness.ts` classifies all 53 destructive canonical endpoints exactly once:

- 34 database-only operations are ledger-supported but still require exclusive
  per-VU fixture pools and runner integration.
- 10 authentication operations remain blocked on a per-iteration
  account/session/challenge factory.
- 6 operations remain blocked on exact external-provider or file reconcilers.
- 3 singleton/fleet-wide mutations remain blocked because concurrent users
  would contend on shared global state rather than independent user work.

Therefore no valid-write maximum-concurrency result should be reported yet.
Read endpoints, rejection probes, and SSE capacity can be measured independently.
