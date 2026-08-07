# Open questions and assumptions

No implementation claim in this site depends on the following unknowns. Each item records inspected evidence and what is missing.

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

**Assumption:** it is optional and defaults off; enabling it makes upload failures fail closed.

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
