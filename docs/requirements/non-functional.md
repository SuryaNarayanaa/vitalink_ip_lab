# Non-functional requirements

The table separates implemented constraints from desired-but-unproven outcomes. No numeric uptime, latency, recovery, or support target is inferred.

| Area | Confirmed implementation requirement | Evidence or limit |
| --- | --- | --- |
| Security | Requests use Helmet, configured CORS, body limits, request timeouts, rate limiting, authentication, role/capability checks, validation, audit middleware, and centralized errors. | `backend/src/app.ts` and middleware/config files |
| Tenant isolation | Tenant-scoped administrative and clinical operations must resolve hospital ownership and reject cross-hospital access. | Hospital-access, admin-access, doctor-assignment, file-asset services and tests |
| Session revocation | Every authenticated request must match a live persisted session and current user security generation. | Auth middleware and AuthSession service |
| Data integrity | Important multi-document operations use transactions, unique indexes, optimistic versions, leases, fences, or idempotency keys as applicable. | RBAC, assignment, lifecycle, file, invoice, notification code |
| Availability | Liveness is independent from readiness; readiness considers MongoDB, Firebase state, worker state, and required environment configuration. | `/health/live`, `/health/ready` |
| Deployment continuity | The checked-in EC2 path starts and health-checks an inactive slot before switching Nginx, then stops the old slot. | `deploy/deploy.sh` |
| Degraded operation | Selected Redis-backed functions have process-local or Mongo-backed fallback/recovery paths. | Rate limiter, stream tickets, realtime service, notification recovery |
| API compatibility | `/api/v1` is canonical; `/api` remains available with deprecation metadata until the configured sunset. | App mounts and version middleware |
| Performance bounds | JSON bodies, uploads, timeouts, pagination validators, rate limits, worker concurrency, and retry counts are bounded. | App config, validators, upload middleware, worker config |
| Observability | Requests carry `X-Request-Id`; logs are sanitized; optional Loki transport and notification delivery counters exist. | App logging and logger/metrics modules |
| Privacy | Sensitive query parameters and structured log fields are redacted; push copy is sanitized for clinical delivery. | Morgan safe URL token, logger sanitizer, notification delivery service |
| Testability | Backend build/Jest/OpenAPI lint and Flutter analyze/test are automated. | GitHub Actions and test trees |
| Accessibility | Product guidance asks for WCAG AA contrast and non-color-only errors; Flutter widgets include semantic/error behavior in selected surfaces. | `PRODUCT.md` and frontend source; repository has no complete automated WCAG audit |

## Unconfirmed targets

The following are valid architectural needs but are not defined as measurable requirements in source:

- uptime and latency SLOs;
- RPO, RTO, backup frequency, restore-test frequency, and multi-region recovery;
- log retention and audit retention policy beyond model-specific TTLs;
- alert thresholds and on-call response times;
- supported browser/OS matrix and accessibility conformance level;
- maximum supported tenants, users, concurrent SSE streams, queue depth, or storage volume.

They are tracked in [Open questions](../reference/open-questions.md), not silently converted into commitments.
