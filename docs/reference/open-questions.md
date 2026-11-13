# Open questions and assumptions

## GCP database and storage evaluation, 2026-10-28

The [database and storage research](gcp-database-storage-research.md) compares options against inspected source. A target provider/engine is not selected. Actual hosting/tier, volumes, traffic, object inventory, region, budget, downtime tolerance, recovery objectives and data-location requirements remain unverified. Firestore partial-index replacements, PostgreSQL query/schema parity, Cloud Storage authorization/purge semantics, migration reconciliation, backup restoration and cost/performance need isolated evaluation. No production data or infrastructure changed; ADR-0002 and ADR-0005 remain the accepted implementation records.

No implementation claim in this site depends on the following unknowns. Each item records inspected evidence and what is missing.

## Hosted verification window, 2026-10-17

The user-supplied Cloud Run backend at `https://vitalink-ip-lab-98286338620.europe-west1.run.app` returned HTTP 200 for liveness, readiness, and the API version index. Readiness reported MongoDB connected, Firebase initialized, the notification worker started, and required runtime configuration present. This observation does not establish provider delivery or the full deployment topology.

The owner confirmed TOTP was intentionally disabled for testing. Existing administrator test accounts with accepted saved passwords could retrieve their identity, but administrator access was blocked by the required password change. The owner requested that passwords remain unchanged. Three saved credentials, for the test accounts ending in `app05`, `hospital05`, and `auditor05`, were rejected; the owner reported changing their passwords. Administrator workflows, tenant isolation, and successful Doctor/Patient workflows therefore remain unverified on this deployment. The payment webhook returned HTTP 503 with `PAYMENT_WEBHOOK_SECRET is not configured`; payment settlement remains unverified.

Initial single-host client-side measurements used fresh HTTPS connections. Twenty sequential readiness requests averaged 482.76 ms with p95 507.11 ms. Thirty readiness requests at five workers averaged 498.89 ms with p95 803.15 ms and observed throughput 7.94 requests/second. These are workstation-to-service observations, not server processing times, peak capacity, or an SLA. Cold starts and cloud resource telemetry were not measured.

Local automated results are separate from hosted evidence: all 660 backend tests passed across 43 suites in 182.54 seconds after installing the lockfile dependencies and starting Docker Desktop. The earlier 31-suite run passed 243 assertions while twelve MongoDB/Testcontainers suites were initially blocked by Docker; the final full run supersedes that limitation and uses disposable containers. No shared database was substituted for their fixtures. All 149 Flutter tests across 24 files and 17 deployment-script cases also passed. The initial Flutter compiler attempt failed because a temporary output path disappeared; the successful rerun used a workspace-local temporary directory.

The second user-supplied backend, `https://vitalink-uimf.onrender.com`, also returned ready health state, accepted the same 17 saved test-account credentials, and rejected the same three changed passwords. Its working administrator accounts hit the same required password-change gate. Its first observed readiness request took 41.998 seconds; subsequent warm samples were measured separately. This delay is not a confirmed provider cold start. The host comparison uses fresh, alternating request pairs after both route/account sweeps and the local backend suite; deployment revision equality and provider resource telemetry remain unverified.

All 246 requests in the paired comparison returned the expected HTTP 200. Twenty readiness requests per host averaged 471.32 ms for Cloud Run and 337.88 ms for Render, with p95 503.09 ms and 387.22 ms respectively. At five workers with 30 readiness samples per host, Cloud Run recorded p95 474.52 ms and 8.41 requests/second; Render recorded p95 782.07 ms and 9.86 requests/second. The shared route sweeps each contained 128 contract requests covering the 117-operation inventory plus public/index and negative checks, with no differences in HTTP status or checked response-contract assertions. These short samples do not establish equivalent releases, equal hardware, peak capacity, or successful business behavior.

The HTML report and raw receipts are local deliverables under the ignored `deliverables/hosted-backend-tests/` directory. Initial login probes discarded issued session tokens before cleanup; session management was also password-change gated. Those initial probe sessions could not be explicitly revoked and remain subject to server expiration or operator revocation. Subsequent authenticated probes log out their own sessions and test rejection of the logged-out token. No password, role policy, or clinical record was changed.

### Password-restoration prerequisite, 2026-10-17

The user subsequently requested temporary password changes followed by restoration of the original passwords. A fresh login and identity read on both hosts exposed `password_policy.history_count: 5`, `expiry_days: 90`, and `must_change_password: true`. The existing `should reject password reuse from recent password history` test passed against disposable MongoDB: after changing a password, restoring the previous value returns HTTP 400 with `New password cannot match a recently used password`. The follow-up run executed that one test, with 49 unrelated tests skipped by the name filter. No hosted password was changed during this preflight. Original-password restoration through the supported API is therefore blocked by the reported history policy; hosted administrator workflow coverage remains incomplete pending a test-account approach that does not require that rollback. Fresh preflight sessions were logged out.

## Vercel GitHub deployment verification, 2026-10-21

The existing `vitalinkwebapp` project shows `SuryaNarayanaa/vitalink_ip_lab` connected and Production tracking `main`. Flutter install/build commands, the `frontend` root, and `build/web` output were saved in its dashboard. The user selected the Cloud Run API origin. Manual Git-based production deployment `9r4rM5Zh8vFHXZdkZoqXC1ucM5gn` from commit `099edc4` reached Ready in 2m 55s. The production HTML, bootstrap JavaScript, and main JavaScript returned HTTP 200; the main bundle contains the selected Cloud Run hostname. Production-origin login preflight passed. A subsequent push-triggered build, authenticated application acceptance, and Preview-origin CORS acceptance remain unverified. These checks do not establish a production-ready clinical workflow or backend resource topology.

## OQ-01: What is the live production topology?

**Assumption used in diagrams:** the EC2/Docker topology is labeled “repository-defined production,” not “currently live.”

**Inspected:** `.github/workflows/backend-cd.yml`, `deploy/*`, `.github/workflows/deploy_web.yml`, `frontend/vercel.json`, `frontend/web/vercel.json`, `frontend/lib/core/constants/strings.dart`, APK workflow.

**Missing evidence:** deployment inventory or provider console state showing the live frontend origin, backend origin, TLS terminator, MongoDB/Redis hosts, regions, and active release.

## OQ-02: What backup, restore, RPO, and RTO policy applies?

**Assumption:** runbooks require an externally verified restore point but cannot create one.

**Inspected:** deployment scripts/README, Docker Compose volumes, GitHub Actions, models/migrations, existing environment documentation.

**Missing evidence:** scheduled backup configuration, retention, encryption, restore command, restore drill, ownership, RPO, RTO, and last successful test.

## OQ-03: Who owns support, incidents, security, privacy, and clinical governance?

**Assumption:** these stakeholder functions are implied but unnamed.

**Inspected:** product guidance, audit/access/security code, workflows, runbooks, repository documentation.

**Missing evidence:** contact/rota, escalation path, severity policy, breach notification process, clinical approval authority, data controller/processor roles, and regulator/customer obligations.

## OQ-04: What SLOs, capacity limits, and alert thresholds are approved?

**Assumption:** none are stated; monitoring recommendations are target state.

**Inspected:** health endpoints, logger/Loki transport, notification metrics, rate limits, timeouts, worker concurrency, Docker/Nginx limits, CI.

**Missing evidence:** availability/latency targets, load model, tenant/user/SSE/queue/storage capacity, dashboards, alert rules, paging response, and error budget.

## OQ-05: What retention/deletion policy applies to clinical, audit, billing, and account data?

**Assumption:** only schema TTLs are described as implemented.

**Inspected:** every model, patient file purge, notification delivery retention, challenge/session TTLs, environment examples.

**Missing evidence:** approved retention schedule, legal holds, audit/invoice/profile deletion rules, object-storage lifecycle, backup deletion, and patient data-subject workflow.

## OQ-06: Which payment provider and reconciliation process are used?

**Assumption:** the integration is provider-neutral.

**Inspected:** checkout and webhook services/controllers/routes, invoice model, environment example, OpenAPI.

**Missing evidence:** provider identity, production API contract, currency policy, refund/dispute/reconciliation jobs, key rotation, settlement reporting, and PCI scope.

## OQ-07: Is malware scanning required in each environment?

**Implemented behavior:** scanning defaults on in production/staging, and readiness requires the enabled flag and an HTTPS scanner URL. Development/test defaults off; when enabled, upload failures fail closed.

**Inspected:** `malware-scan.service.ts`, file upload/asset services, config and environment examples, tests.

**Missing evidence:** approved scanner product, service ownership, signature/update process, latency/availability target, quarantine procedure, and production flag state.

## OQ-08: What compliance and encryption controls exist outside the application?

**Assumption:** provider/storage encryption and certification are not claimed.

**Inspected:** application crypto/logging/file/session code, deployment and environment files.

**Missing evidence:** MongoDB/Redis/S3/backups encryption settings, KMS/secret manager, key rotation, access reviews, vulnerability management, penetration tests, and healthcare/privacy certification.

## OQ-09: What is the intended status of ML artifacts?

**Assumption:** ML is excluded from runtime architecture.

**Inspected:** all tracked `ml-service` and `ml_pipeline` files, backend/frontend dependency/import/URL searches.

**Missing evidence:** serving source, API contract, deployment configuration, model governance, validation, monitoring, approval, and any call from the application.

## OQ-10: What client/platform support and accessibility target is required?

**Assumption:** Flutter targets web/Android/iOS and product guidance aims for WCAG AA, but formal conformance is not claimed.

**Inspected:** Flutter platforms, routes/components, `PRODUCT.md`, analyzer/test configuration, build workflows.

**Missing evidence:** supported OS/browser/device matrix, assistive-technology test plan, audit results, localization policy, and conformance statement.

## Lifecycle and audit rollout verification, 2026-09-28

The fixes are local source changes. Live deployment, creation of the audit scope index in production, and recovery of accounts disabled by historical hospital suspensions have not been verified. No shared database migration was run. Historical audit hospital scope cannot be established from current membership and remains unclassified. The maintenance HTTP regression exercises fresh login and bootstrap; a browser reload through the Flutter portal remains a separate end-to-end check.

## Session visibility and step-up rollout verification, 2026-09-29

The local backend tests cover session revocation and request-local verification. Production gateway and observability configuration have not been inspected for redaction of `X-Step-Up-Password` and `X-Step-Up-Totp`. A deployed Flutter web flow with CORS, real authenticator devices, and multi-device sign-out remains unverified.

## Standalone Docker and Atlas verification, 2026-10-07

The standalone backend Compose path is source configuration. After the initial checks, user-supplied development settings were saved to ignored `backend/.env.docker` with mode 0600. An authenticated Atlas read-only ping succeeded from the local host; Firebase JSON/private-key parsing and local messaging initialization also succeeded without sending notifications. The supplied Render-style internal Redis hostname did not resolve from this host. The user subsequently requested a Redis container; Compose now defines persistent Redis, gates backend startup on its healthcheck, and overrides `REDIS_URL` with `redis://redis:6379`. The ignored runtime file was also updated to that URL with notification delivery enabled. No shared database migration, seeding, or application startup against Atlas was performed. Docker daemon access is denied to this session; image build, actual Redis startup/persistence, container-to-Atlas connectivity, runtime readiness, and graceful container shutdown remain unverified. Hosted Redis state was not migrated. The Node 24 image also affects future EC2 blue-green builds; no live rollout was performed.

## Backend CI audit follow-up, 2026-10-11

The development-only `braces` stack-exhaustion advisory has no upstream fix at this review. Recheck upstream and remove the exact-path exception before its 2026-11-10 00:00 UTC expiry; do not treat the exception as a patched dependency. Local production audit success does not prove the absence of undisclosed vulnerabilities. Docker daemon access is still denied, so the database-backed tests and runtime image compatibility for the refreshed lockfile remain unverified locally. A successful hosted Backend CI rerun must also be established separately from the local audit/build/unit checks. The unrelated APK job's missing `GOOGLE_SERVICES_JSON` secret remains outside this fix.

## Administrator password control rollout, 2026-10-21

The Personal Security password entry is implemented locally. A live browser check and deployment of this frontend change remain unverified. ADM01 has not been changed or checked against a shared database; the account owner will submit the current and new passwords through the UI after rollout.

## Administrator security sidebar follow-up, 2026-10-21

Zen reproduced that Personal Security was absent from the deployed dashboard sidebar. The sidebar destination is now registered locally for all administrator roles; role-by-role navigation tests pass. Hosted verification of this follow-up remains pending. The account owner must enter and submit passwords personally.

## GCP manual operational acceptance 2026-10-22

The GCP deployment manual documents inspected source behavior and cited Google Cloud procedures. It does not establish the current project's IAM bindings, trigger definition, network egress, probe configuration, CPU billing, minimum instances, backup recoverability, or successful idle background delivery. Operators must verify these in the intended project and complete the manual's acceptance record before release handover. No cloud changes or live acceptance run were performed while authoring the manual.

## Doctor attention workflow, 2026-10-25

The source implements an explainable review queue and monthly recording calendar. Live deployment and hospital acceptance are not established. Historical report review cannot be inferred from notes; older entries remain unknown. Historical weekly prescription versions are absent, so old schedule gaps are estimates under the current plan. Reminder jobs retain their existing delivery eligibility and may differ from the overview for profiles missing therapy start. Global INR threshold configuration and the legacy/manual critical update field remain for compatibility; new upload classification and doctor overview do not use them. No historical critical-flag migration was run. The existing roster API is unpaginated; production-scale performance and queue acceptance need separate verification. Structured health-report review and symptom severity are outside this change.


## Runtime presentation properties, 2026-10-27

Production deployment, real-device offline/resume behavior and external image hosting remain unverified. Configuration is currently global; hospital-specific overrides and pre-login hospital selection are future work. Native launcher/splash/store metadata and provider-managed SMS/authenticator issuer settings remain outside runtime properties. Uploaded brand images are intentionally public and retained; automatic unreferenced-image cleanup is not implemented. Local validation evidence is recorded in the validation report.

## Client branding acceptance, 2026-10-28

The inspected source already provides public branding snapshots, protected draft/publication controls and logo uploads. This follow-up connects the administrator navigation logo and corrects the draft preview. A deployed administrator upload/save/publish/restore flow, installed-device refresh and offline behavior, and each client's image layout and color contrast still need acceptance in the intended environment. No client artwork or production configuration was supplied or published in this task. Hospital-specific branding within a shared backend remains unimplemented; the supported scope is one brand per backend deployment. Native icons, splash screens and store metadata still require a platform release.

## Doctor table selection acceptance, 2026-11-13

The table-only doctor workflow and selected-patient Reports navigation were verified locally with synthetic records. Hosted deployment and authenticated hospital acceptance remain unverified.

## Patient dose calendar acceptance, 2026-11-13

The recent-dose-only patient screen and shared calendar were verified locally with synthetic records. Hosted deployment and authenticated patient acceptance remain unverified. Roll out the additive patient dosage-calendar dose_history field before the corresponding frontend. Existing legacy calendar and missed-dose arrays remain compatible. Database-backed controller integration was not run in this change; service, build, contract and Flutter coverage do not establish a live database/API transaction. Calendar history uses the current weekly prescription and cannot reconstruct prior prescriptions.
