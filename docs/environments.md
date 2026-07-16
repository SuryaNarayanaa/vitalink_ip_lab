# Environment configuration

VitaLink uses four runtime profiles:

| Profile | Backend `NODE_ENV` | Purpose | Data and integrations |
| --- | --- | --- | --- |
| Dev | `development` | Local development and manual testing | Local or developer-owned resources |
| Test | `test` | Automated backend and Flutter tests | Isolated test data; external delivery disabled or mocked |
| UAT / staging | `staging` | Release-candidate validation | Dedicated non-production resources |
| Prod | `production` | Live service | Production-only resources and secrets |

UAT and staging mean the same environment in this repository. Use `staging` as the backend value because the configuration code recognizes that exact string.

## Configuration sources

### Backend

The backend loads environment variables through `dotenv` when the process starts. For local work, run commands from `backend/` and copy `backend/.env.example` to `backend/.env`. The deployment compose file instead loads `deploy/.env.production` explicitly.

Treat `backend/.env.example` as the authoritative inventory of backend variables. Do not commit populated `.env` files, service-account JSON, access keys, tokens, or passwords. Store UAT and production values in the deployment platform's secret store and inject them at runtime.

Changes to backend variables require a process or container restart. Validate a deployed instance with:

```bash
curl -fsS https://<api-host>/health/live
curl -fsS https://<api-host>/health/ready
```

`/health/live` only confirms that the HTTP process is running. `/health/ready` also checks MongoDB, Firebase initialization, the notification worker, and the required UAT/production configuration.

### Flutter app

The Flutter app reads two compile-time values. They must be supplied to every `flutter run`, `flutter test`, or `flutter build` that should not use the source defaults.

| Define | Meaning | Source default |
| --- | --- | --- |
| `API_BASE_URL` | Backend origin, without a trailing slash | `https://vitalink-uimf.onrender.com` |
| `API_PATH_PREFIX` | Versioned API prefix, with a leading slash | `/api/v1` |

Example:

```bash
flutter run \
  --dart-define=API_BASE_URL=http://localhost:3000 \
  --dart-define=API_PATH_PREFIX=/api/v1
```

These values are embedded in the resulting web, Android, or iOS artifact. A deployment-time environment-variable change cannot retarget an already-built Flutter app; rebuild it instead. Always pass `API_BASE_URL` explicitly in CI to prevent an accidental build against the source default.

For same-origin web deployments, pass an empty base URL:

```bash
flutter build web --release \
  --dart-define=API_BASE_URL= \
  --dart-define=API_PATH_PREFIX=/api/v1
```

The hosting proxy must then forward `/api/v1/*` to the backend.

## Environment profiles

### Dev

Create `backend/.env` from the example and use at least:

```dotenv
NODE_ENV=development
PORT=3000
MONGO_URI=mongodb://localhost:27017/VitaLink
JWT_SECRET=<developer-only-random-secret>
API_VERSION=v1
API_DOCS_ENABLED=true
API_DOCS_PATH=/docs
FCM_ENABLED=false
REDIS_URL=
NOTIFICATION_DELIVERY_ENABLED=false
```

Development defaults are permissive for convenience: when `CORS_ALLOWED_ORIGINS` is empty, browser origins are accepted; API docs are enabled; and local fallback values exist for MongoDB, JWT signing, and the file-asset cutoff. Do not rely on those fallbacks outside local development.

Run the backend and frontend in separate terminals:

```bash
cd backend
npm install
npm run dev
```

```bash
cd frontend
flutter pub get
flutter run \
  --dart-define=API_BASE_URL=http://localhost:3000 \
  --dart-define=API_PATH_PREFIX=/api/v1
```

Enable Redis, FCM, Twilio, S3-compatible storage, and notification delivery locally only when exercising those integrations. Use sandbox accounts and non-production buckets.

### Test

Run backend tests from `backend/`:

```bash
npm ci
npm test
```

Jest uses `NODE_ENV=test`. In this profile the backend defaults to the `VitaLink_test` database and test-only JWT/TOTP keys. Redis is deliberately ignored and notification delivery is disabled, even if a developer's `.env` contains live values. S3 operations are mocked by the global Jest setup, and FCM defaults to disabled.

Tests that actually connect to MongoDB must use an isolated disposable database and must never point `MONGO_URI` at Dev, UAT, or Prod. Integration tests that need Redis or another provider must opt in within their own harness and use disposable resources.

Run Flutter tests with explicit API defines when a test observes endpoint construction:

```bash
cd frontend
flutter test \
  --dart-define=API_BASE_URL=http://127.0.0.1:3000 \
  --dart-define=API_PATH_PREFIX=/api/v1
```

Tests should mock HTTP by default. If an end-to-end test starts the backend, give it an isolated MongoDB database, unique credentials, and a non-conflicting port.

### UAT / staging

UAT must be isolated from production: use a separate MongoDB database, S3 bucket, Redis instance, Firebase project, Twilio configuration, encryption keys, API hostname, and frontend build. Never copy production customer data into UAT unless it has been approved and irreversibly anonymized.

Recommended backend profile:

```dotenv
NODE_ENV=staging
PORT=3000
MONGO_URI=<uat-mongodb-uri>
JWT_SECRET=<uat-random-secret>
ADMIN_TOTP_ENCRYPTION_KEY=<uat-encryption-key>
ACCESS_KEY_ID=<uat-storage-key-id>
SECRET_ACCESS_KEY=<uat-storage-secret>
S3_BUCKET_NAME=<uat-bucket>
FILE_ASSET_LEGACY_CUTOFF_AT=<coordinated-ISO-8601-instant>
CORS_ALLOWED_ORIGINS=https://uat.example.com
TRUST_PROXY=1
REDIS_URL=<uat-redis-url>
NOTIFICATION_DELIVERY_ENABLED=true
TWILIO_ACCOUNT_SID=<uat-account-sid>
TWILIO_AUTH_TOKEN=<uat-auth-token>
TWILIO_VERIFY_SERVICE_SID=<uat-verify-service-sid>
FCM_ENABLED=false
API_DOCS_ENABLED=true
API_DOCS_USERNAME=<uat-docs-user>
API_DOCS_PASSWORD=<uat-docs-password>
```

If push notifications are part of UAT, set `FCM_ENABLED=true` and inject `FIREBASE_SERVICE_ACCOUNT` as JSON encoded on one environment-variable line. Complete the device-token migration described in `backend/docs/device-token-migration.md` before enabling it for an existing environment.

Build a separate UAT app artifact:

```bash
cd frontend
flutter build web --release \
  --dart-define=API_BASE_URL=https://api-uat.example.com \
  --dart-define=API_PATH_PREFIX=/api/v1
```

Do not promote the UAT web artifact to production because its API origin is compiled in. Rebuild using the production values.

### Prod

Production uses `NODE_ENV=production`, dedicated production resources, and secrets supplied by the deployment platform. Start from `backend/.env.example`; `deploy/.env.production.example` is a deployment aid but does not currently list every setting checked by readiness.

At minimum, production readiness requires:

- `MONGO_URI`, `JWT_SECRET`, and `ADMIN_TOTP_ENCRYPTION_KEY`
- `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, and `FILE_ASSET_LEGACY_CUTOFF_AT`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID`
- `API_DOCS_USERNAME` and `API_DOCS_PASSWORD` when `API_DOCS_ENABLED=true`
- `FIREBASE_SERVICE_ACCOUNT` when `FCM_ENABLED=true`

Production should also set these values explicitly:

```dotenv
NODE_ENV=production
API_VERSION=v1
CORS_ALLOWED_ORIGINS=https://app.example.com
TRUST_PROXY=1
API_DOCS_ENABLED=false
FCM_ENABLED=<true-or-false>
REDIS_URL=redis://redis:6379
NOTIFICATION_DELIVERY_ENABLED=true
LOG_LEVEL=info
DOSAGE_REMINDER_TIMEZONE=Asia/Kolkata
```

Use `CORS_ALLOWED_ORIGINS`, not the legacy-looking `CORS_ORIGINS` name found in `deploy/.env.production.example`. Multiple origins are comma-separated and must include the scheme, for example `https://app.example.com,https://admin.example.com`. In production, an empty allowlist rejects browser requests that include an `Origin` header.

Build production clients with the production API origin:

```bash
cd frontend
flutter build web --release \
  --dart-define=API_BASE_URL=https://api.example.com \
  --dart-define=API_PATH_PREFIX=/api/v1

flutter build apk --release \
  --dart-define=API_BASE_URL=https://api.example.com \
  --dart-define=API_PATH_PREFIX=/api/v1
```

## Shared backend settings

The following groups are available in every backend profile. Defaults are documented in `backend/.env.example` and enforced in `backend/src/config/index.ts`.

| Group | Variables |
| --- | --- |
| HTTP and API | `PORT`, `API_VERSION`, `LEGACY_API_SUNSET_DATE`, `CORS_ALLOWED_ORIGINS`, `JSON_BODY_LIMIT`, `REQUEST_TIMEOUT_MS`, `TRUST_PROXY` |
| Authentication | `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRY_DAYS`, `MAX_FAILED_LOGIN_ATTEMPTS`, `ACCOUNT_LOCKOUT_MINUTES`, `PASSWORD_EXPIRY_DAYS`, `PASSWORD_HISTORY_COUNT` |
| Rate limiting | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`, `AUTH_RATE_LIMIT_WINDOW_MS`, `AUTH_RATE_LIMIT_MAX_REQUESTS` |
| Storage | `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, `S3_BUCKET_NAME`, `FILE_ASSET_LEGACY_CUTOFF_AT` |
| OTP and MFA | `OTP_*`, `TWILIO_*`, `ADMIN_TOTP_*` |
| Push and queues | `FCM_ENABLED`, `FIREBASE_SERVICE_ACCOUNT`, `REDIS_URL`, `NOTIFICATION_DELIVERY_*` |
| Clinical reminders | `DOSAGE_REMINDER_CRON`, `DOSAGE_REMINDER_TIMEZONE`, `INR_REMINDER_INTERVAL_DAYS`, `NEXT_REVIEW_REMINDER_LEAD_DAYS`, `MISSED_DOSE_ESCALATION_WINDOW_DAYS`, `MISSED_DOSE_ESCALATION_THRESHOLD` |
| Observability | `LOG_LEVEL`, `LOKI_URL`, `LOKI_USERNAME`, `LOKI_PASSWORD` |
| API docs | `API_DOCS_ENABLED`, `API_DOCS_PATH`, `API_DOCS_USERNAME`, `API_DOCS_PASSWORD` |
| Administrative scripts | `DEFAULT_ADMIN_LOGIN`, `DEFAULT_ADMIN_PASSWORD` |
| Billing | `PAYMENT_CHECKOUT_BASE_URL` |

`PAYMENT_CHECKOUT_BASE_URL` is only required when the hosted checkout flow is used. `DEFAULT_ADMIN_LOGIN` and `DEFAULT_ADMIN_PASSWORD` are inputs to the admin seed command; unset or remove them after controlled provisioning where the secret platform permits it.

## Release checklist

Before deploying UAT or Prod:

1. Confirm the Flutter artifact was built with the intended `API_BASE_URL` and `/api/v1` prefix.
2. Confirm MongoDB, storage, Redis, Firebase, and Twilio belong to the target environment.
3. Confirm `CORS_ALLOWED_ORIGINS` contains only the target frontend origins.
4. Use unique JWT, TOTP encryption, docs, database, and provider credentials; do not reuse secrets across environments.
5. Set `FILE_ASSET_LEGACY_CUTOFF_AT` to the coordinated migration instant, not an arbitrary deployment time.
6. Run migrations against the target environment before enabling dependent features.
7. Verify `/health/live`, then `/health/ready`, then an authenticated smoke test.
8. Check logs for database, Firebase, queue-worker, CORS, and provider errors without printing secret values.

