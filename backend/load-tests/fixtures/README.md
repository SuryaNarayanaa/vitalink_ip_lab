# Load-test fixtures

These commands create synthetic records only. They fail closed unless the target database name is visibly load-test-specific, every host is allowlisted, `NODE_ENV` is not `production`, and a durable cleanup-journal directory is explicitly provided.

From `backend`, set these environment values without committing them:

```text
ALLOW_LOAD_TESTS=true
LOAD_TEST_RUN_ID=<unique 8-64 character run ID>
LOAD_TEST_MONGO_URI=mongodb://mongo:27017/vitalink_load_test?replicaSet=rs0
LOAD_TEST_ALLOWED_DB_HOSTS=mongo
LOAD_TEST_STATE_DIR=<absolute durable directory>
LOAD_TEST_FIXTURE_PASSWORD=<test-only value of at least 16 characters>
LOAD_TEST_JWT_SECRET=<test-only value of at least 32 characters; also set as JWT_SECRET on the isolated API>
```

Run with the repository's existing `tsx` development dependency:

```text
npx tsx load-tests/fixtures/seed.ts --dry-run
npx tsx load-tests/fixtures/seed.ts
npx tsx load-tests/fixtures/verify.ts
npx tsx load-tests/fixtures/finalize.ts
```

The password is never written to the journal or output. Seed creates test-only authenticated sessions and writes their access/refresh tokens to `<LOAD_TEST_STATE_DIR>/<runId>.session-secrets.json` with restrictive permissions; this ignored file must be supplied to the scenario setup and is deleted by successful finalization. The console prints only its path. Cleanup reads the durable journal and issues one deletion per exact `_id` plus its ownership signature. It never uses a prefix delete, `deleteMany`, or collection drop.

The default fixture contains four hospitals (two active, one suspended, one inactive), distinct admin/auditor tenant modes, four doctors, eight patients across lifecycle states, notifications, device tokens, invoices, and audit rows. Every name and identifier is synthetic and deterministically derived from the run ID.
