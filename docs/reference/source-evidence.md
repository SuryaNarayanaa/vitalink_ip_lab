# Source evidence and inspection scope

## Baseline

- Branch: `main`
- Inspected commit: `b73965c` (`Merge pull request #27 from SuryaNarayanaa/fix/security-bug-hunt-lockout-and-session`)
- Tracked-file inventory: 477 files from `git ls-files`
- Working tree was clean before documentation changes.

## Coverage accounting

| Area | Tracked inventory | Inspection method |
| --- | ---: | --- |
| Backend source | 123 files | Full filename inventory; deep reads of composition, routes, models, auth/access, services, jobs, config, utilities and validators; searches across all source |
| Backend tests/setup | 44 files, including 41 `*.test.ts` | Filename/topic inventory; Jest config and representative Testcontainers/replica-set/setup source inspected |
| Flutter application | 115 `frontend/lib` files | Full filename/class/route inventory; deep reads of router, API client, constants, session flow, repositories, realtime/push, role surfaces; searches across every Dart source |
| Flutter tests | 20 files | Full filename/topic inventory; frontend CI and analyzer configuration inspected |
| Backend route modules | 8 files including docs/index | Every route declaration inspected and machine-extracted |
| Mongoose model modules | 19 files including `index.ts` | Every schema/model file read; 18 exported model names compared with entity markers |
| Controllers/services | 10 controller and 28 service files | Full inventory; targeted reads/searches for every major workflow and external integration |
| GitHub Actions | 5 initial workflow files | Every workflow read; documentation workflow added and Pages workflow updated |
| Deployment | 10 files | Dockerfile, Compose, Nginx, deploy/setup/test scripts, examples and README inspected |
| ML areas | `ml-service` artifacts and `ml_pipeline` bytecode caches | Tracked inventory, `main.py`, dependency file and integration searches inspected |

## Primary files inspected by topic

### Product and frontend

- `PRODUCT.md`, `frontend/README.md`, `frontend/pubspec.yaml`
- `frontend/lib/app/routers.dart`
- `frontend/lib/core/constants/strings.dart`
- `frontend/lib/core/network/api_client.dart`
- `frontend/lib/core/auth/*`, `frontend/lib/core/storage/secure_storage.dart`
- Patient, doctor, administrator, login, notification and onboarding feature files
- Patient, doctor, administrator/access, and auth repositories
- Realtime EventSource/SSE and Firebase push services

### API and business behavior

- `backend/src/app.ts`, `server.ts`, every `backend/src/routes/*.ts`
- Every controller and validator inventory
- Authentication/session/password/OTP/TOTP services
- Hospital access, doctor assignment, administrator access/account/policy services
- File asset, malware scanner, purge, notification/realtime/delivery services
- Schedulers, queue, worker and recovery jobs
- Statistics/config/billing logic and payment webhook handling

### Data

- Every `backend/src/models/*.ts`
- `backend/src/config/db.ts`
- Every migration/purge script inventory and package command
- Existing `backend/docs/data-model.md` rechecked against current schemas

### Security and integrations

- Auth, administrator permission, system feature, audit, validation and error middleware
- JWT/password/logging/upload/rate-limit utilities and config
- Twilio Verify, Firebase, Redis/BullMQ, Filebase/S3, malware scanner, payment-provider and Loki integration code
- `backend/.env.example` and `deploy/.env.production.example`

### Infrastructure and quality

- Backend Dockerfile; Docker Compose; Nginx configuration; deploy/rollback script and tests
- All original GitHub Actions workflows
- Jest, TypeScript, Flutter analyzer and test inventories
- Existing backend OpenAPI and architecture/API documentation

## Evidence method

Behavioral claims require one or more of route/controller/service/model/client/config/test evidence. Existing prose was treated as a lead, not authority, and was corrected where current source differed. Live-provider and live-host facts were not inferred from example URLs or deployment scripts.

## Machine-enforced inventories

- API coverage: 113 implemented router operations plus the canonical version index must equal 114 OpenAPI operations.
- Entity coverage: all 18 exported Mongoose model names must appear once as `<!-- model: ... -->` markers.
- OpenAPI copies under `docs/` and `backend/docs/` must match exactly.

See [Validation](validation.md) for commands and observed results.
