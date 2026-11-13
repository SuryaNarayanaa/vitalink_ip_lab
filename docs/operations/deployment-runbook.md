# Deployment runbook

This runbook describes the checked-in EC2/Docker path. It does not assert that EC2 is the current hosted production path.

For the Cloud Run backend and its Vercel frontend connection, use the [GCP deployment manual](gcp-deployment-manual.md).

For one backend instance and a Redis container using hosted MongoDB Atlas, follow the [backend Docker runbook](backend-docker-runbook.md).

## Vercel web deployments from GitHub

The existing Vercel project `surya54101qs-projects/vitalinkwebapp` is connected to `SuryaNarayanaa/vitalink_ip_lab`. Production tracks `main`. Pushing commits to GitHub triggers deployments; a local commit alone does not. Other branches use Preview deployments. The production domain is `https://vitalinkwebapp.vercel.app`.

Project settings saved in the dashboard on 2026-10-21:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | `frontend` |
| Output directory | `build/web` |
| Ignored build step | Automatic |
| Skip unaffected root-directory deployments | Disabled |

Install command, matching the Flutter version in `frontend-ci.yml`:

```bash
git clone --depth 1 --branch 3.44.8 https://github.com/flutter/flutter.git /tmp/vitalink-flutter && /tmp/vitalink-flutter/bin/flutter pub get
```

Build command:

```bash
/tmp/vitalink-flutter/bin/flutter build web --release --dart-define=API_BASE_URL=https://vitalink-ip-lab-98286338620.europe-west1.run.app --dart-define=API_PATH_PREFIX=/api/v1
```

The API origin is compiled into Flutter. Dashboard environment variables alone do not change it. Update the build command and redeploy to change origins. The checked-in `/api/*` rewrite still targets Render; the explicit Cloud Run origin sends application API calls directly to Cloud Run. Verify backend CORS for each intended frontend origin, particularly Preview URLs.

These settings live in Vercel rather than a new GitHub Actions workflow. Builds use the pushed repository state, excluding uncommitted local edits. Verify the deployment's Git SHA, build logs, Ready status, assets, and an authenticated workflow after a push. See [ADR-0014](../decisions/0014-vercel-github-web-deployments.md) and [remaining verification](../reference/open-questions.md#vercel-github-deployment-verification-2026-10-21).

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
