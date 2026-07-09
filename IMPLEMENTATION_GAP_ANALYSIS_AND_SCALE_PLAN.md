# VitaLink Admin Module Gap Analysis and 500-Patient Scale Plan

Date: 2026-07-06

Status legend used below:

- `[x]` Completed in the current codebase
- `[~]` Partially implemented; further work still needed
- `[ ]` Not yet implemented

## Scope

This review compares the current codebase against the technical design requirements in `VitaLink-AdminModule-TechnicalDesignRequirements.docx`. It covers implemented features, missing work, implementation sequencing, file upload readiness, a test/staging app track, and an estimated monthly cost model for roughly 500 patients.

Note: the request said "text app"; this plan assumes that means a test/staging app. If the intent is SMS/text-message delivery, use the notification section below and add an SMS provider such as Twilio, MSG91, or AWS SNS.

## What Is Already Implemented

### Application Shape

- Backend: Express 5 + TypeScript + MongoDB/Mongoose.
- Frontend: Flutter app for web/mobile, with patient, doctor, and admin flows.
- Deployment: Dockerized backend with blue-green containers behind Nginx.
- Build status: backend TypeScript build passes with `npm run build`.

### API and Mobile/Web Integration

- API base is mounted under `/api`.
- Auth, doctor, patient, admin, and statistics route groups exist.
- Flutter app uses a centralized Dio API client with bearer-token handling, response normalization, retries for transient GET failures, and session-expiry redirection.
- Existing patient UI supports INR submission, file picking, report history, dosage tracking, calendar, profile, notifications, and doctor updates.
- Existing doctor UI supports patient listing, patient detail, dosage updates, review-date updates, report review, and notifications.
- Existing admin UI supports doctors, patients, hospitals, users, roles, billing placeholders, system config, audit logs, health, broadcasts, and analytics.

### Authentication and Access Control

- JWT login, logout, `/me`, and password change exist.
- Session-bound JWTs, hashed refresh-token persistence, refresh rotation, revoke, and logout revocation are implemented.
- Patient and doctor first-login phone OTP verification is implemented through Twilio Verify.
- Admin authenticator-app MFA enrollment, activation, login challenge, and Flutter setup/login verification UI are implemented.
- Password hashing uses per-user salt.
- Role-based authorization exists for ADMIN, DOCTOR, and PATIENT.
- Route guards exist in Flutter based on stored authenticated user role.
- Admin profiles have app admin, hospital admin, and auditor roles.
- Service-side hospital tenant checks exist for many admin flows.

### Data Model

- User, AdminProfile, DoctorProfile, PatientProfile, Hospital, Invoice, Notification, SystemConfig, and AuditLog models exist.
- Patient data includes demographics, next of kin, assigned doctor, hospital, INR history, health logs, dosage schedule, medical config, account status, and profile picture key.
- Useful MongoDB indexes exist on user login/profile uniqueness, hospital IDs, notifications, audit logs, and status/date fields.

### File Upload

- Patient INR report upload exists at `POST /api/patient/reports`.
- Patient profile picture upload exists at `POST /api/patient/profile-pic`.
- Doctor profile picture upload exists at `POST /api/doctors/profile-pic`.
- Uploads use multer memory storage with size and MIME checks.
- INR report files allow PDF, PNG, JPEG up to 10 MB.
- Profile pictures allow PNG, JPEG, JPG, WEBP up to 5 MB.
- Files are uploaded to S3-compatible storage using presigned PUT URLs.
- Report/profile downloads use presigned GET URLs.
- Flutter INR page already uses `file_picker` and multipart upload.

### Notifications

- In-app notifications are persisted in MongoDB.
- Server-Sent Events streams exist for patient and doctor notification updates.
- Admin broadcast notifications exist for all users, doctors, patients, or specific users.
- Doctor updates trigger patient notifications for reassignment, dosage changes, report changes, next review date, and instructions.

### Audit and Logging

- Admin mutating routes are audited through middleware.
- Audit model captures user, action, resource, sanitized body, IP, user agent, success, errors, and metadata.
- Request ID generation and request logging exist.
- Winston logging exists with optional Loki transport.
- Health endpoints exist: live and ready.

### Deployment and Operations

- Backend Dockerfile exists.
- Blue-green Docker Compose deployment exists.
- Nginx proxy is configured with rate limiting and SSE support.
- EC2 manual deployment guide exists.
- Health checks are wired to `/health/ready`.

### Tests

- Backend Jest tests exist for auth, admin, doctor, patient, statistics, and patient file upload.
- Tests use Testcontainers and MongoDB.
- Current local verification: `npm run build` passes.
- Current local test run could not execute because no working container runtime is available for Testcontainers.

## Missing or Incomplete Against the Requirements

### Critical Before Development

1. API contracts and versioning
   - `[x]` Formal OpenAPI/Swagger spec now exists at `backend/docs/api/openapi.yaml`.
   - `[x]` `/api/v1` versioning boundary now exists while legacy `/api` remains backward-compatible.
   - `[x]` Published human-readable integration contract now exists at `backend/docs/api-reference.md`.
   - `[~]` Further implementation needed:
     - Keep `openapi.yaml` synchronized with route/controller changes.
     - Continue tightening lint hygiene such as operation IDs and unused components.
     - Consider exposing versioned raw spec endpoints under `/api/v1/docs` as well if external integrators should stay fully under `/api`.

2. Mobile push notification contract
   - `[~]` In-app/SSE notifications exist.
   - `[ ]` Missing Firebase Cloud Messaging integration, device token model, push delivery worker, retries, and delivery status.

3. MFA and login hardening
   - Coordination workflow for the remaining auth-hardening work now exists at `backend/docs/codex-thread-workflow-auth-hardening.md`.
   - Verification and promotion runbook now exists at `backend/docs/auth-hardening-verification.md`.
   - `[x]` Admin authenticator-app MFA is implemented for privileged users, including enrollment, activation, login challenge, Flutter setup UI, and Flutter login verification UI.
   - `[x]` Patient and doctor first-login phone OTP verification is implemented through Twilio Verify, with registered-phone binding and Flutter login OTP UI.
   - `[x]` Failed-login counters and temporary account lockout are now implemented in `User` plus auth controller logic.
   - `[x]` Login throttling is now applied in Express and Nginx; global API limiter and stricter auth limiter are active in `backend/src/app.ts`.
   - `[x]` Refresh-token/session invalidation is implemented with persisted auth sessions, hashed refresh tokens, refresh rotation, revoke, logout revocation, and admin password-reset revocation.
   - `[x]` Password expiry/history is implemented with configurable defaults, salted/hashed password-history entries, login/`me` policy state, and enforcement on password change/reset.
   - `[x]` Login-attempt telemetry now records IP plus normalized login ID in auth audit metadata for matched users, with structured unmatched-user warnings for forensic correlation.

4. Secrets management
   - `[~]` `.env.example` now documents more runtime controls, including API docs settings.
   - `[ ]` Still need AWS Secrets Manager/SSM Parameter Store or equivalent, key rotation policy, and deployment-time injection.

5. Data model documentation
   - `[x]` Data model documentation now exists at `backend/docs/data-model.md`.
   - `[x]` The document includes schema/collection descriptions, ERD, index strategy, unique key inventory, sensitive-field notes, and migration policy.
   - `[~]` Further implementation needed:
     - Add a retention-and-purge policy document.
     - Add a file asset model proposal or implementation document once file metadata is normalized.
     - Keep the document updated as collections evolve.

6. Backup, restore, DR, retention, archival, purge
   - `[ ]` Missing documented backup schedules, restore runbook, RPO/RTO, retention policy, patient discharge/archive policy, and purge workflow.
   - `[ ]` Atlas backups may be configured outside code, but this repo still does not define the operational runbook.

### Operationally Important

1. Architecture diagram
   - `[ ]` Missing a checked-in architecture diagram covering Flutter app, backend, MongoDB Atlas, S3/Filebase, Firebase, Nginx, EC2, and monitoring.

2. Environment strategy
   - `[ ]` Some deployment files exist, but Dev/UAT/Prod environment matrix is not formalized.
   - `[ ]` No separate test/staging app build config and backend base URL contract.

3. Infrastructure sizing and upgrade strategy
   - `[~]` The plan below now contains concrete initial sizing guidance and scale-up triggers.
   - `[ ]` Still missing checked-in operational dashboards/alerts that enforce those thresholds.

4. Monitoring and alerting
   - `[~]` Health and logs exist.
   - `[ ]` Missing uptime monitoring, metrics, alerts, dashboards, API latency/error-rate SLOs, DB monitoring playbook, and incident notification channel.

5. Testing strategy
   - `[~]` Tests exist, but require Docker/Testcontainers.
   - `[ ]` Missing documented CI prerequisites, frontend test gate, e2e tests, security tests, load tests, and file-upload integration tests against staging storage.
   - `[~]` Further implementation needed:
     - Add CI workflow that provisions Docker/Testcontainers correctly.
     - Add local fallback test profile or document container runtime requirement clearly.
     - Continue tightening OpenAPI lint warnings beyond the structural validation gate.

6. Multi-tenancy completeness
   - `[~]` Hospital tenant fields and admin service checks exist.
   - `[ ]` Need policy middleware/centralized authorization for every resource access, especially doctor/patient routes and file access metadata.
   - `[ ]` Need tenant-scoped audit and export controls.

7. Scalability roadmap
   - `[~]` This document now includes a clearer phased roadmap for queues, notification delivery, compliance, monitoring, and staging.
   - `[ ]` Still no implemented roadmap artifacts for payments, EMR integration, AI services, or event-driven architecture decisions beyond planning text.

### Recommended Missing Requirements

1. Configuration management
   - `[~]` SystemConfig exists.
   - `[~]` Environment variable inventory is partially improved through `.env.example`.
   - `[ ]` Need config ownership, validation, audit detail, runtime reload behavior, and fuller feature flag strategy.

2. Data ownership and compliance
   - `[~]` PHI/PII-style field classification now exists in `backend/docs/data-model.md`.
   - `[ ]` Missing consent model, data export workflow, deletion request workflow, governance policy, and admin access justification.

3. Notification reliability
   - `[ ]` Missing scheduled medication reminders, retry policy, dead-letter queue, delivery success/failure tracking, and escalation.

4. Audit log requirements
   - `[~]` Audit logs exist.
   - `[ ]` Need retention period, tamper resistance/append-only storage, export, search UX depth, log integrity checks, and audit of doctor/patient sensitive actions.

5. Business continuity during internet failure
   - `[~]` Flutter has secure storage and some retry behavior.
   - `[ ]` Missing offline-first patient workflow, local queued dose/report submissions, sync conflict handling, and clear out-of-scope documentation.

## Implementation Plan

### Phase 0: Stabilize and Document Current System

Deliverables:

- `[x]` Create `docs/api/openapi.yaml` from existing routes.
- `[x]` Add `/api/v1` alias while keeping `/api` backward-compatible.
- `[x]` Create `docs/data-model.md` covering collections, references, indexes, unique keys, retention-sensitive fields, and PHI fields.
- `[x]` Add a professional API reference document at `backend/docs/api-reference.md`.
- `[x]` Add a Swagger UI docs route with environment controls and optional basic auth in `backend/src/routes/docs.routes.ts`.
- `[ ]` Create `docs/architecture.md` with architecture diagram and data-flow diagram.
- `[ ]` Create `docs/environments.md` for Dev/UAT/Prod and test/staging app configuration.
- `[ ]` Make CI capable of running Testcontainers, or add an alternate `mongodb-memory-server` test profile for local development.
- `[x]` Add OpenAPI validation/linting to CI so invalid spec changes are caught automatically.

Acceptance:

- `[x]` Backend build passes.
- `[ ]` Existing Jest suite runs in CI.
- `[ ]` Frontend `flutter test` and analyzer are added to CI.
- `[~]` OpenAPI now covers the implemented route surface at a useful level, but should still be tightened continuously as controllers evolve.
- `[x]` Backend CI validates `backend/docs/api/openapi.yaml` with Redocly before build/tests.

### Phase 1: Security Baseline

Deliverables:

- `[x]` Apply Express rate limiter globally and stricter auth limiter on `/api/auth/login`.
- `[x]` Add failed login tracking to `User`.
- `[x]` Lock account after configurable failed attempts.
- Add MFA for privileged users:
  - `[x]` TOTP secret enrollment for admins.
  - `[ ]` Recovery codes.
  - `[x]` MFA-required admin login flow is enforced for enrolled admins; production bootstrap policy fails closed for unenrolled admins.
  - `[x]` Login response changes for MFA challenge.
- Add refresh-token/session model:
  - `[x]` Access tokens are session-bound.
  - `[x]` Refresh token rotation.
  - `[x]` Logout invalidates the active session and refresh token.
  - `[x]` Admin password reset invalidates active target-user sessions and records the invalidation count in audit metadata.
- `[ ]` Move production secrets to AWS SSM/Secrets Manager or equivalent.
- `[~]` Expand audit logging to auth success/failure, doctor changes, patient report upload, file access, data export, and password changes.
  - Auth success/failure is now audited.
  - Further sensitive action coverage still needs to be added consistently.

Acceptance:

- `[x]` Admin login requires MFA for enrolled admins, and production/staging policy requires authenticator enrollment.
- `[~]` Lockout and throttling are implemented; automated verification coverage should be strengthened.
- `[~]` Sensitive body/query fields are redacted in request URL logs and admin audit bodies; keep extending this as new logging surfaces are added.
- `[x]` Session invalidation verified for refresh rotation and logout.
- `[~]` Auth hardening verification runbook exists at `backend/docs/auth-hardening-verification.md`; local integration execution still requires Docker/Testcontainers.

### Phase 2: File Upload Hardening

Existing upload is a good start. Harden it before scaling:

- Add a FileAsset model:
  - tenant/hospital ID
  - owner user ID
  - patient profile ID
  - purpose: INR_REPORT, PROFILE_PICTURE, etc.
  - storage provider, bucket, key, MIME, size, checksum, upload status
  - created_by, deleted_at, retention/delete eligibility
- Change upload keys to include tenant and patient IDs:
  - `hospitals/{hospitalId}/patients/{patientId}/reports/{uuid}.pdf`
  - `hospitals/{hospitalId}/profiles/{userId}/{uuid}.webp`
- Use UUID/crypto-random keys instead of `Math.random`.
- Verify file magic bytes, not just client MIME type.
- Add optional virus/malware scan hook for production uploads.
- Keep file upload size limits:
  - INR report: 10 MB
  - profile image: 5 MB
  - revisit only after real usage data.
- Add object lifecycle:
  - active reports in S3 Standard
  - older reports to Standard-IA or Glacier after policy-approved window
  - hard deletion only after retention rules allow it.
- Add file deletion/purge workflow when patient data is purged.

Acceptance:

- Uploads are tenant-scoped.
- Doctor/admin cannot access another tenant's files.
- File metadata survives even if object key changes.
- Presigned URLs expire quickly and are never stored in DB.

### Phase 3: Notification and Reminder Reliability

Deliverables:

- Add DeviceToken model:
  - user_id, platform, token, app_version, last_seen_at, disabled_at.
- Add Firebase Cloud Messaging server integration.
- Add NotificationDelivery model:
  - notification_id, channel, provider_message_id, status, attempts, last_error.
- Add a job queue:
  - BullMQ + Redis, or AWS SQS + worker.
- Add scheduled jobs:
  - dosage reminders
  - INR test reminders
  - next review reminders
  - missed dose escalation
- Add retry and dead-letter handling.
- Keep SSE/in-app notifications as immediate UI channel; use FCM for mobile/background delivery.

Acceptance:

- A dosage reminder creates an in-app notification and a push attempt.
- Failures retry and eventually land in dead-letter state.
- Admin/ops can see delivery health.

### Phase 4: Compliance, Retention, and Data Governance

Deliverables:

- Add ConsentRecord model.
- Add DataRequest model for export/deletion/correction requests.
- Add patient data export endpoint for authorized admins.
- Add retention policy document:
  - active patient records
  - discharged/deceased patients
  - audit logs
  - uploaded reports
  - notification history.
- Add purge/anonymization workflow:
  - soft delete first
  - retention check
  - remove file objects
  - write immutable audit event.
- Add audit export with tenant filters.
- Add tamper-resistant audit option:
  - daily hash chain and/or write copy to S3 Object Lock bucket.

Acceptance:

- Data export/deletion requests are trackable.
- Retention rules are visible and enforceable.
- Audit logs cannot be silently edited in normal admin flows.

### Phase 5: Monitoring, Alerting, and DR

Deliverables:

- Add Prometheus-compatible `/metrics` or use managed APM.
- Track:
  - API latency p50/p95/p99
  - 4xx/5xx rates
  - auth failures/lockouts
  - queue depth
  - notification failures
  - upload failures
  - DB connection pool and slow queries
  - disk/memory/CPU/container restarts
  - active SSE connections.
- Add alerts:
  - API 5xx > 2% for 5 minutes
  - p95 latency > 1s for 10 minutes
  - DB CPU > 70% for 15 minutes
  - queue backlog > 500 jobs or oldest job > 10 minutes
  - upload failure rate > 5%
  - no successful backup in 24h.
- Create backup/restore runbook:
  - Atlas automated backups
  - point-in-time restore where tier supports it
  - monthly restore drill
  - RPO/RTO definitions.

Acceptance:

- Uptime dashboard exists.
- Alerts route to email/Slack/PagerDuty.
- A restore drill is documented with measured restore time.

### Phase 6: Test/Staging App

Deliverables:

- Create staging backend environment:
  - separate MongoDB Atlas cluster/db
  - separate S3 bucket/prefix
  - separate Firebase project
  - separate admin seed.
- Create Flutter flavors:
  - `dev`
  - `staging`
  - `prod`
- Add app display names:
  - VitaLink Dev
  - VitaLink Staging
  - VitaLink
- Use `--dart-define=API_BASE_URL=...` per flavor.
- Add staging smoke tests:
  - login
  - create patient
  - upload INR report with file
  - doctor reviews report
  - patient receives update notification
  - admin audit log contains the actions.

Acceptance:

- Test/staging app can be installed or opened independently of production.
- Staging uses no production patient data.
- Release checklist requires staging smoke pass.

## 500-Patient Capacity Plan

### Assumptions

- 500 active patients.
- 25-50 doctors/admin users.
- Each patient uploads 2 INR reports per month.
- Average report file size: 1.5 MB.
- Profile images: 1 MB average, one-time plus occasional updates.
- 1,000 report uploads/month = about 1.5 GB/month new report storage.
- Report downloads/views: 2-4 views per report.
- Patient app traffic is low to moderate, with brief daily bursts.
- Database is MongoDB Atlas, app runs on AWS EC2 or equivalent, uploads go to S3-compatible storage.

### Recommended Initial Production Shape

- App/API: 1 EC2 `t3.small` or `t3.medium`, Dockerized, Nginx reverse proxy.
- Database: MongoDB Atlas M10 dedicated cluster to start.
- Storage: S3 Standard or Filebase/S3-compatible bucket with lifecycle policies.
- Push: Firebase Cloud Messaging.
- Logs/monitoring: Grafana Cloud/CloudWatch/Loki or equivalent.
- Backups: Atlas automated backups plus tested restore runbook.

### Scale-Up Triggers

- Move app from `t3.small` to `t3.medium` when:
  - CPU > 60% sustained for 15 minutes
  - memory > 70% sustained
  - p95 API latency > 800 ms under normal DB health
  - SSE connections cause worker memory pressure.
- Add second app instance/load balancer when:
  - need high availability
  - deploy downtime is unacceptable
  - sustained concurrent users exceed one instance comfort zone.
- Move MongoDB Atlas M10 to M20 when:
  - storage approaches 70% of tier limit
  - DB CPU > 60-70% sustained
  - read/write latency is consistently high
  - working set no longer fits RAM
  - indexes or aggregation queries become slow at 500+ patients.
- Add Redis/queue worker when:
  - scheduled reminders and push retries are enabled
  - notification work should not block API requests.

## Estimated Monthly Running Cost for 500 Patients

Prices vary by region and vendor discounts. Use this as a planning estimate, not a purchase order.

### Lean Single-Instance Setup

| Component | Estimate/month | Notes |
|---|---:|---|
| EC2 app server | $15-$35 | `t3.small` to `t3.medium`, Linux on-demand style pricing |
| EBS disk | $3-$8 | 30-80 GB gp3 for OS/log buffer |
| MongoDB Atlas M10 | ~$60-$75 | dedicated starter tier; backups extra |
| S3/File storage | <$5 | 10-50 GB active files at low request volume |
| Data transfer | $0-$10 | likely low for 500 patients unless reports are downloaded heavily |
| Monitoring/logging | $0-$30 | free/basic tier or small Grafana/Loki/CloudWatch usage |
| Firebase Cloud Messaging | $0 | FCM itself is free; server/queue costs still apply |
| Domain/SSL | $1-$2 | domain amortized monthly; Let's Encrypt SSL is free |
| Total | ~$80-$165/month | Good for pilot/early production with careful monitoring |

### More Production-Ready HA Setup

| Component | Estimate/month | Notes |
|---|---:|---|
| 2 app instances | $30-$70 | two `t3.small`/`t3.medium` instances |
| Application Load Balancer | ~$20-$30 | base ALB plus low LCU usage |
| EBS | $6-$15 | per-instance disks |
| MongoDB Atlas M10/M20 | ~$60-$160 | M10 initially; M20 if load/working set requires |
| Redis/queue | $10-$30 | small managed Redis or self-hosted worker store |
| S3/File storage | <$10 | depends on retention and report sizes |
| Monitoring/logging | $20-$75 | production dashboards and alerting |
| Backups | $5-$30 | depends on Atlas backup size and retention |
| Total | ~$150-$420/month | Better reliability and room for reminder/push workloads |

### Cost Notes From Current Public Pricing Sources

- MongoDB Atlas dedicated clusters are advertised from about $60/month for dedicated tiers; M10/M20 exact cost varies by cloud/region and backup settings.
- AWS S3 Standard in US regions is commonly listed at $0.023/GB-month for the first 50 TB.
- FCM is free as a messaging service; surrounding infrastructure may cost money.
- ALB pricing has a base hourly charge plus LCU usage; low-traffic apps are usually around the low tens of dollars per month.
- EC2 instance costs vary by family/region; use the current AWS calculator before procurement.

## Priority Backlog

### Must Do Before Clinical Production

1. `[x]` MFA for admins plus refresh-token/session invalidation.
2. Tenant authorization audit across all routes.
3. File metadata model and tenant-scoped file access.
4. Backup/restore/DR runbook and first restore drill.
5. Monitoring/alerting dashboard.
6. Notification reliability design for reminders.
7. Retention, consent, export, and purge policy.
8. CI test environment that actually runs the existing Jest suite.
9. OpenAPI operational ownership for keeping docs current and resolving remaining lint warnings.

### Should Do Before 500 Patients

1. FCM push notifications and device-token management.
2. Queue/worker for reminders, retries, and dead-letter handling.
3. Staging/test app with separate backend, DB, storage, and Firebase.
4. Load test for patient login, report upload, doctor report review, and notification fanout.
5. S3 lifecycle policies and storage cost reporting.
6. Audit export and tamper-resistance.
7. Frontend offline queue for dose marking and INR report draft/submission retry.

### Can Wait Until Later

1. Payment gateway integration.
2. EMR integration.
3. AI services.
4. Advanced analytics/data warehouse.
5. Multi-region active-active deployment.

## Verification Performed

- Read current backend, frontend, and deployment source.
- Ran `npm run build` in `backend`: passed.
- Ran `npm test -- --runInBand` in `backend`: failed because Testcontainers could not find a working container runtime strategy on this machine.
- Latest local Jest attempt also surfaced an existing `twilioconfig.test.ts` expectation mismatch: staging config now fails first on missing `ADMIN_TOTP_ENCRYPTION_KEY` before the Twilio Verify variables asserted by that test.
- Added Redocly OpenAPI validation to backend CI and verified `npm run lint:openapi` passes for `backend/docs/api/openapi.yaml` with existing style warnings.
- Verified first-login phone OTP and Twilio Verify integration on deployed doctor flow, including successful OTP completion and subsequent normal login.
- Verified deployed session hardening behavior: `/me` succeeds with a valid token, refresh rotates tokens, old access tokens are rejected after refresh, logout revokes the session, and refresh tokens are rejected after logout.
- Verified Twilio Verify template TTL support locally and against Twilio; direct Verify start with template SID plus `ttl` substitution returned pending.
- Verified formal API documentation artifacts now exist:
  - `backend/docs/api/openapi.yaml`
  - `backend/docs/api-reference.md`
  - `backend/docs/data-model.md`
- Added auth hardening verification artifact:
  - `backend/docs/auth-hardening-verification.md`
- Verified Swagger UI integration exists and is wired through:
  - `backend/src/routes/docs.routes.ts`
  - `backend/src/app.ts`
  - `backend/.env.example`

## Key Code References

- Backend health readiness: `backend/src/app.ts`
- Swagger/OpenAPI docs route: `backend/src/routes/docs.routes.ts`
- OpenAPI contract: `backend/docs/api/openapi.yaml`
- Human-readable API contract: `backend/docs/api-reference.md`
- Data model documentation: `backend/docs/data-model.md`
- Patient report routes and upload limits: `backend/src/routes/patient.routes.ts`
- Patient upload/download controller logic: `backend/src/controllers/patient.controller.ts`
- S3-compatible upload utilities: `backend/src/utils/fileUpload.ts`
- Tenant-aware admin service logic: `backend/src/services/admin.service.ts`
- Audit log model and indexes: `backend/src/models/auditlog.model.ts`
- Notification service and broadcasts: `backend/src/services/notification.service.ts`
- Blue-green deployment: `deploy/docker-compose.yml`
- Flutter INR upload UI: `frontend/lib/features/patient/patient_update_inr_page.dart`
