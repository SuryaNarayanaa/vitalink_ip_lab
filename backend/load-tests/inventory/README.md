# Endpoint inventory

This directory contains the source-derived route inventory used by the stress-test harness.
It parses Express registrations with the TypeScript compiler API, recursively resolves
router mounts and chained `router.route()` methods, reconciles the canonical runtime routes
with OpenAPI, and records conditional documentation and derived protocol checks separately.

From `backend`, regenerate and verify with:

```powershell
npx.cmd tsx load-tests/inventory/generate-inventory.ts
npx.cmd tsx load-tests/inventory/verify-inventory.ts
```

Both commands exit nonzero when the canonical runtime/OpenAPI sets drift or the mandatory
explicit operation total is no longer 194. The generated JSON intentionally contains no
timestamp, so identical source produces byte-for-byte identical output.
