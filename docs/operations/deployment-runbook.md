# Deployment runbook

This runbook describes the checked-in EC2/Docker path. It does not assert that EC2 is the current hosted production path.

## Preconditions

1. Confirm the intended environment and active provider accounts.
2. Confirm a database backup or restore point outside this repository and record who verified it.
3. Confirm `/opt/vitalink` is the dedicated deployment clone and the target commit is approved.
4. Populate `deploy/.env.production` from the backend variable inventory. Do not commit it.
5. Confirm `JWT_SECRET` is non-placeholder and at least 32 characters; also satisfy every variable reported by readiness.
6. Confirm CORS origins, Flutter compile-time API origin, object bucket, MongoDB, Redis, Twilio, Firebase, scanner, payment, and Loki belong to the same environment.
7. Confirm TLS termination at Nginx or an upstream edge; checked-in Nginx HTTP is not sufficient for public clinical traffic.

## First deployment

From the host:

```bash
cd /opt/vitalink/deploy
chmod +x deploy.sh
sudo ./deploy.sh initial
sudo ./deploy.sh status
curl -fsS http://localhost/health/live
curl -fsS http://localhost/health/ready
```

`initial` validates the JWT secret, builds/starts blue and Nginx, waits for the blue container healthcheck, and records blue as active.

## Upgrade deployment

```bash
cd /opt/vitalink
git fetch origin main
git reset --hard origin/main
cd deploy
sudo ./deploy.sh deploy
sudo ./deploy.sh status
curl -fsS http://localhost/health/ready
```

The script deploys only to the inactive slot, waits for readiness, switches and validates Nginx, then stops the previous slot. If the inactive slot never becomes healthy, it is stopped and the active upstream remains unchanged.

## Migration checkpoint

Migrations are not automatic. Use the active container name shown by `./deploy.sh status` and run only scripts applicable to the source data. Examples:

```bash
docker exec vitalink-blue node build/src/scripts/migrateAuthSchemaDefaults.js
docker exec vitalink-blue node build/src/scripts/backfillPatientHospitalIds.js --dry-run
docker exec vitalink-blue node build/src/scripts/backfillFileAssets.js
```

Review each dry-run summary and its script-specific documentation before adding `--execute`. Replace `vitalink-blue` with `vitalink-green` when green is active. Record preconditions, counts, failures, and verification queries. Do not run `purgePatientFiles` as a migration.

## Post-deploy verification

1. Verify Nginx and active slot status.
2. Verify `/health/live` and `/health/ready` from the host and public edge.
3. Confirm readiness details show the intended MongoDB, Firebase/worker state, and no missing required variables.
4. Review active-slot and Nginx logs for startup, Redis, Firebase, CORS, scanner, Twilio, payment, or migration errors.
5. Perform one authenticated, non-destructive smoke path for each affected role.
6. For notification changes, confirm outbox creation and worker outcome without using real clinical text in test pushes.
7. For file changes, use authorized sandbox data and confirm upload, presigned read, and cleanup.
8. Retain the commit, active slot, migration summaries, health output, and smoke-test result as release evidence.

## Stop condition

Stop and use the rollback or incident runbook if readiness fails, a migration reports unexplained failures, tenant checks fail, audit gaps appear, or any clinical mutation produces ambiguous state.
