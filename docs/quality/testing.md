# Testing strategy

## Current automated layers

| Layer | Current implementation | CI gate |
| --- | --- | --- |
| TypeScript compilation | `tsc` plus alias rewrite | Backend CI and CD |
| Backend unit/service tests | Jest/ts-jest with provider mocks | Backend CI and CD |
| Backend integration tests | Testcontainers MongoDB; replica-set helper for transactions | Backend CI where Docker is available |
| Contract lint | Redocly lint of OpenAPI | Backend CI and documentation CI |
| Route policy coverage | Tests verify administrator route policy registration/enforcement | Backend Jest |
| Flutter static analysis | `flutter analyze` with Flutter lints | Frontend CI |
| Flutter unit/widget tests | Repositories, models, access controller/gates, API client, patient/admin UI regressions | Frontend CI |
| Deployment-script tests | Bash fixture tests for production JWT-secret validation | Present in source; not currently called by GitHub Actions |
| Documentation tests | MkDocs strict build, links, API/entity parity, OpenAPI, Mermaid, Structurizr | Documentation CI |

The repository currently contains 41 tracked backend `*.test.ts` files and 20 tracked Flutter test files. Counts are file counts, not claims about unique test cases.

## Backend coverage policy

Jest collects `src/**/*.ts` except barrel indexes and type-only files. Global minimums are:

| Metric | Threshold |
| --- | ---: |
| Branches | 18% |
| Functions | 30% |
| Lines | 32% |
| Statements | 32% |

These thresholds are implemented but low for a healthcare workflow. Raising them should follow meaningful risk-based tests rather than line-only assertions.

## Risk-based test priorities

1. Tenant isolation and administrator global/tenant scope.
2. Authentication generations, OTP/TOTP challenges, refresh reuse, lockout, and password boundaries.
3. Patient assignment/lifecycle transactions and stale-owner fencing.
4. INR upload authorization, file compensation, malware scanner failure, presigned read, and purge.
5. Reminder idempotency, clinical validity, cancellation, recovery, retry, and dead-letter transitions.
6. Billing amount/session/signature/idempotency and cross-tenant denial.
7. Client session refresh concurrency, role guards, capability-aware empty/error/loading states, and small-screen critical flows.

## Environment rules

- Run backend commands from `backend/` with `NODE_ENV=test` and disposable Testcontainers resources.
- Tests must not inherit a live Redis endpoint; the config deliberately clears Redis in test.
- External S3, Twilio, Firebase, scanner, payment, and Loki interactions should be mocked unless a separately authorized sandbox integration suite is being run.
- Flutter repository tests should mock HTTP. Any end-to-end stack needs an isolated MongoDB database, unique credentials, and a dedicated port.

## Required release evidence

For a normal release, capture exact pass/fail status for documentation validation, backend build and tests, frontend analyze and tests, applicable migration dry runs, readiness, and a role-appropriate authenticated smoke test. A blocked Docker/Testcontainers run is incomplete integration evidence, not a passing result.

## Gaps

- No committed full-stack end-to-end browser/device suite.
- No performance/load, soak, chaos, accessibility, penetration, or backup-restore test workflow.
- Deployment script tests are not wired into CI.
- Backend CD does not run a post-deploy authenticated clinical smoke path.
- No ML serving tests exist because no ML serving implementation is tracked.
