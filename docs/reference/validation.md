# Documentation validation report

## Doctor web table row containment, 2026-11-13

Inspected the shared attention chips and doctor table. Table cells now use a padded, minimum-height Column instead of Wrap, so intrinsic row sizing contains all labels. Cards retain wrapping. A synthetic preview uses the production DoctorPatientTable without a backend or patient data.

- Two widget regression checks passed at 100% and 200% text scale. They check all four chip bounds, vertical padding, separation from the next patient, and absence of layout exceptions.
- Focused Dart analysis passed with no issues. The UI detector returned no findings.
- Documentation contract validation and strict MkDocs build passed. OpenAPI lint passed with 106 existing warnings; API copies remain identical. Mermaid and Structurizr inputs did not change.
- Release web preview build passed. Headless Edge rendered the production table with synthetic patients; the inspected 1440x1000 screenshot shows all four labels above the row divider, followed by one-reason and no-attention rows. Local evidence: `build/verification/attention-table.png`.
- Shared preview capture was unavailable because the desktop browser produced no frames. Local browser evidence uses synthetic fixtures, not a deployed or authenticated patient workflow. Production deployment and hospital acceptance remain unverified.


## GCP Docker image tutorial, 2026-11-01

Reviewed the backend Dockerfile, environment example, readiness implementation, existing deployment manual and Google Cloud provider guidance. Added an illustrated account-neutral image build/copy and Cloud Run tutorial. No cloud deployment or provider connectivity was exercised.

`python scripts/docs/validate_docs.py` passed with 111 links, 122 matching API operations, 20 matching models and identical OpenAPI copies. `mkdocs build --strict` passed; the existing unlisted property audit page remains informational. OpenAPI lint passed with 106 warnings. `git diff --check` passed. Mermaid and Structurizr inputs did not change.

## GCP database and storage research, 2026-10-28

Inspected current models, database connection, account/policy transactions, statistics aggregations, file upload/purge integration, installed MongoDB driver tree, and accepted database/file ADRs before writing the [research comparison](gcp-database-storage-research.md). Provider capabilities and pricing models were checked against linked primary documentation. Recommendations remain proposals; no application, API, persistence schema, credentials, cloud resources or production data changed.

- `python scripts/docs/validate_docs.py` passed: 109 local links, 122 matching API operations, 20 matching models, identical OpenAPI copies and six parsed workflow files.
- `mkdocs build --strict` passed. It reported the existing unlisted `reference/property-implementation-audit.md` page as informational output.
- `npm.cmd run lint:openapi --prefix backend` passed with 106 existing warnings.
- `git diff --check` passed. Mermaid and Structurizr inputs did not change, so their render/CLI checks were not rerun.
- No runtime migration, compatibility benchmark, backup restoration or monthly-cost estimate was performed. Required evidence is tracked in [open questions](open-questions.md#gcp-database-and-storage-evaluation-2026-10-28). Unrelated working-tree changes were preserved.

## Vercel GitHub configuration, 2026-10-21

Inspected Flutter source, both Vercel rewrite files, frontend CI, and existing deployment documentation before saving settings in the existing `vitalinkwebapp` project. The dashboard confirms the GitHub repository, Production branch `main`, root `frontend`, output `build/web`, and custom Flutter 3.44.8 install/build commands. The user selected Cloud Run. A manual Git-based production build was started from pushed commit `099edc42288b12a5f29aec2070bb62cc9e3c3c2e`, without committing or pushing local edits.

`python scripts/docs/validate_docs.py` passed with 90 local links, 117 matching API operations, 18 matching models, identical OpenAPI copies, and 6 parsed workflow YAML files. `mkdocs build --strict` passed. `npm.cmd run lint:openapi --prefix backend` passed with 106 existing warnings. `git diff --check` passed. No OpenAPI, Mermaid fences, or Structurizr inputs changed.

The Cloud Run `/health/live` probe returned HTTP 200. An OPTIONS request to `/api/v1/auth/login` from `https://vitalinkwebapp.vercel.app` returned HTTP 204 with `Access-Control-Allow-Origin` equal to that origin and POST included in the allowed methods. This verifies production-origin preflight, not an authenticated workflow or Preview origins.

Git-based production deployment `9r4rM5Zh8vFHXZdkZoqXC1ucM5gn` reached Ready in 2m 55s. Logs confirm `Built build/web` and deployment completion. Production `/`, `/flutter_bootstrap.js`, and `/main.dart.js` returned HTTP 200 with HTML/JavaScript content types. The 4,470,429-byte main bundle contains the selected Cloud Run hostname. A live Zen browser check rendered the Welcome Back login screen with username/password controls. A later push-triggered build and authenticated application acceptance were not exercised.

This page records the reproducible validation contract and the results observed against source commit `b73965c` on 2026-08-04.

## Commands

From the repository root:

```powershell
python -m pip install -r requirements-docs.txt
python scripts/docs/validate_docs.py
python scripts/docs/extract_mermaid.py --output build/mermaid-validation.md
npx.cmd -y puppeteer browsers install chrome-headless-shell
npx.cmd -y @mermaid-js/mermaid-cli -p scripts/docs/puppeteer-config.json -i build/mermaid-validation.md -o build/mermaid-rendered.md
docker run --rm -v "${PWD}/docs/architecture:/usr/local/structurizr" structurizr/cli:2025.11.09 validate -workspace /usr/local/structurizr/workspace.dsl
mkdocs build --strict
```

OpenAPI is additionally linted with the backend's pinned dependency tree:

```powershell
cd backend
npm.cmd run lint:openapi
```

## What `validate_docs.py` checks

- local Markdown targets and section anchors;
- MkDocs navigation target existence;
- OpenAPI parsing, version, response presence, and exact duplicate-copy equality;
- exact canonical route parity with all Express router declarations plus the API version index;
- exact entity-marker parity with all Mongoose model declarations under `backend/src/models/`;
- non-empty Structurizr workspace and required view keys;
- required documentation files and the root `AGENTS.md` contract;
- YAML syntax for every checked-in GitHub Actions workflow.

## Observed results

| Check | Result | Evidence |
| --- | --- | --- |
| MkDocs strict build | Pass | Material site built successfully; the CLI emitted only its upstream MkDocs 2.0 advisory |
| Local link validation | Pass | 41 local targets/anchors checked; MkDocs emitted no unresolved-link messages after correction |
| OpenAPI parse/lint | Pass with warnings | Redocly reports a valid description and 104 non-blocking quality warnings, principally missing `operationId` and standard 4xx responses |
| API route comparison | Pass | 114 implemented canonical operations = 114 OpenAPI operations |
| Entity comparison | Pass | 18 discovered Mongoose models = 18 documented model markers |
| Mermaid parse/render | Pass | All 23 Mermaid fences extracted and rendered by Mermaid CLI |
| Structurizr validation | Pass | `workspace.dsl` validated with the pinned `structurizr/cli:2025.11.09` image |
| Backend documentation copy parity | Pass | `docs/api/openapi.yaml` is byte-for-byte identical to `backend/docs/api/openapi.yaml` |
| GitHub Actions YAML syntax | Pass | All 6 workflow YAML files parsed |

Runtime application tests are reported separately from documentation validators. A documentation build does not prove a live deployment, provider account, backup, or clinical end-to-end path.

## Administrator lifecycle and audit fixes, 2026-09-28

Validated local working-tree changes for findings B1-B5. Database tests used disposable Docker MongoDB instances, including a real replica set for transaction rollback and concurrency checks. No shared deployment or database was changed.

| Check | Result | Evidence |
| --- | --- | --- |
| Backend TypeScript build | Pass | `npm.cmd run build --prefix backend` |
| Admin, authentication, and new critical regression suites | Pass | 167 tests passed with `npm.cmd test --prefix backend -- --runInBand admin-critical-regressions admincontroller authcontroller` |
| Final hospital security-version regression and admin routes | Pass | 118 tests passed with `npm.cmd test --prefix backend -- --runInBand admin-critical-regressions admincontroller` after preserving suspension security-version bumps |
| Final transactional guard writes and related checks | Pass across runs | The six-suite run covering critical regressions, runtime configuration, lifecycle enforcement, RBAC, admin access, and protected surfaces passed 62/63 tests. The sole failure was an idle HTTP socket reset in the RBAC probe after source compilation. Its test client now disables keep-alive; all 6 RBAC tests passed on rerun. The remaining 5 suites passed, including all 11 critical regressions after the final transaction guard change |
| Flutter access, permission UI, and confirmation tests | Pass | 34 tests passed with `flutter.bat test test/features/admin/admin_access_controller_test.dart test/features/admin/admin_permission_ux_test.dart test/core/widgets/admin/admin_action_confirmation_test.dart` from `frontend/` |
| Documentation contract | Pass | `python scripts/docs/validate_docs.py`: 53 local links, 114 implemented/documented operations, 18 implemented/documented models, identical OpenAPI copies, 6 workflow YAML files |
| MkDocs strict build | Pass | `mkdocs build --strict` |
| OpenAPI lint | Pass with warnings | `npm.cmd run lint:openapi --prefix backend`: valid description, 104 non-blocking warnings |
| Mermaid | Pass | Extracted and rendered all 27 diagrams using the commands above |
| Structurizr | Pass | Pinned `structurizr/cli:2025.11.09` validated the workspace |
| Whitespace/diff integrity | Pass | `git diff --check` |

The new regressions cover patient-write rollback, expected-state rejection, shared individual/batch transitions, doctor security-version changes, cleanup failure after commit, tenant audit visibility after actor transfer, immutable event scope, platform hospital and administrator-transfer events, suspension/reactivation without restoring independently disabled accounts, stale login snapshot rejection, authenticated maintenance recovery, and omission of patient searches/identifiers from real HTTP access logs.

Maintenance was verified through HTTP enable, fresh login, authenticated bootstrap, configuration read, disable, and normal route recovery. Flutter access/navigation tests passed separately. A complete browser reload through the deployed portal and production index/migration rollout remain unverified; see [open questions](open-questions.md#lifecycle-and-audit-rollout-verification-2026-09-28).

## Backend dependency compatibility, 2026-09-28

After pinning Mongoose 8.24.4, `npm.cmd run build` and six focused unit suites passed (51 tests). `npm.cmd audit --omit=dev --audit-level=high` reported zero vulnerabilities. Documentation validation, the strict MkDocs build, and OpenAPI lint passed; OpenAPI lint retained 104 pre-existing warnings. The full backend suite could not complete because Docker Desktop's Linux engine was unavailable to Testcontainers. Database-backed runtime compatibility remains unverified in this run. Mermaid and Structurizr inputs did not change.

With Docker Desktop's Linux engine available, the full backend suite passed: 42 suites and 649 tests using `npm.cmd test -- --runInBand` from `backend/`. The backend TypeScript build also passed. The follow-up fixes made audit middleware tolerate a response without `locals` and made the challenge-retention test assert the TTL index contract without depending on Mongoose's default `background` option.

## Account mutation dialogs, 2026-09-29

The administrator account edit and invitation dialogs, doctor registration, and patient onboarding were checked in the local Flutter tree. The focused administrator permission UI suite passed 21 tests, and the new one-time credential acknowledgment widget test passed. `dart analyze` reported no issues for the changed widgets and test. The Impeccable detector returned no findings for the changed Flutter widgets. `python scripts/docs/validate_docs.py` passed with 53 local links, 115 matching API operations, 18 matching models, and identical OpenAPI copies. `mkdocs build --strict` passed. OpenAPI lint reported a valid description with 104 existing warnings. Structurizr validation passed. Mermaid extraction and CLI rendering passed for all 27 diagrams. These are local checks; no live administrator, doctor, or patient account was created.

## Patient directory projection, 2026-09-29

The admin patient directory now returns a field-allowlisted profile. The focused database-backed `admincontroller` pagination and projection test passed (1 test), as did the backend TypeScript build, `python scripts/docs/validate_docs.py` (115 routes, 18 models, identical OpenAPI copies), `mkdocs build --strict`, OpenAPI lint (valid, 104 warnings), Mermaid extraction and rendering (27 diagrams), Structurizr validation, and `git diff --check`. The broader backend suite was not run for this scoped change.

## Session inventory and administrator step-up, 2026-09-29

The local backend build passed. The final full backend run passed 42 suites and 651 tests. The database-backed regression tests include missing or incorrect step-up rejection, single-use TOTP for account transfers, denial of MFA reset and policy writes without verification, caller-owned session inventory, and selective revocation. The Flutter administrator permission suite passed 22 tests, including the verification prompt and session list/revoke flow. The administrator repository, login repository, and patient repository suites passed another 22 tests, including verification-header forwarding. Dart analysis reported no issues in the changed application and administrator test files. The Impeccable detector returned no findings for the changed administrator UI files.

Documentation checks passed: `python scripts/docs/validate_docs.py` found 117 matching implemented and documented operations, 18 matching models, and byte-identical OpenAPI copies; `mkdocs build --strict` succeeded; OpenAPI lint found a valid contract with 106 non-blocking quality warnings; Mermaid extraction and rendering completed for 27 diagrams; Structurizr validation succeeded; `git diff --check` found no whitespace errors. Production gateway header redaction and live multi-device behavior remain unverified; see [open questions](open-questions.md#session-visibility-and-step-up-rollout-verification-2026-09-29).

## Backend-only Docker with Atlas, 2026-10-07

Initially validated the standalone Compose path before the Redis-container follow-up below, shared image configuration, Node 24 CI/CD runtime, and affected deployment documentation locally. No Atlas application startup, shared migration, or administrator seeding was performed.

| Check | Result | Evidence |
| --- | --- | --- |
| Compose configuration | Pass | Docker Compose 5.5.1 rendered the template with synthetic values: exactly one backend service, Atlas URI, raw dollar signs/quotes/Firebase JSON retained in the generated configuration, fixed container port 3000, localhost host ports 3000 and 3001, init process and 30-second stop grace period. Missing `.env.docker` was rejected. Temporary synthetic runtime files were removed |
| Backend build | Pass | `npm run build --prefix backend`; TypeScript and alias rewriting also passed under Node 24.21.0 using `npx --package=node@24` |
| Focused configuration tests | Pass | Node 24 Jest run: `fileassetconfig`, `firebaseconfig`, and `twilioconfig`; 3 suites, 16 tests |
| Runtime dependency smoke check | Pass | Node 24 imported Firebase Admin, MongoDB, Mongoose, Express, and native bcrypt; bcrypt hash/compare succeeded on the local Linux host |
| Image health command | Pass locally | The exact Dockerfile probe was executed under Node 24 against a disposable local HTTP server: `/health/ready` HTTP 200 exited 0, HTTP 503 exited 1, and refused connection exited 1 |
| Documentation contract | Pass | `python scripts/docs/validate_docs.py`: 71 local links, 117 matching API operations, 18 matching models, identical OpenAPI copies, 6 workflow YAML files |
| MkDocs strict build | Pass | `mkdocs build --strict` using the repository documentation requirements in an isolated temporary virtual environment |
| OpenAPI lint | Pass with warnings | `npm run lint:openapi --prefix backend`: valid contract, 106 existing quality warnings |
| Mermaid | Pass | All 27 diagrams extracted and rendered with Mermaid CLI 12.0.0 and local Chromium using the repository headless flags |
| Structurizr | Pass | Structurizr CLI 2025.11.09 `validate -workspace docs/architecture/workspace.dsl`; downloaded release CLI used directly with a checksum-verified temporary Java 21 runtime because Docker access was unavailable |
| Whitespace integrity | Pass | `git diff --check` |
| Docker image build and live Atlas readiness | Unverified | `docker build --target runtime -t vitalink-backend:validation backend` failed before building because this session cannot access `/var/run/docker.sock`. No populated backend/deployment environment file was present at this initial check |

Local dependency imports do not validate Alpine native binaries or actual container shutdown. Those checks require building and running the image with the intended Atlas and provider settings; see [open questions](open-questions.md#standalone-docker-and-atlas-verification-2026-10-07) and the [backend Docker runbook](../operations/backend-docker-runbook.md).

### Supplied development configuration follow-up

User-supplied environment values were saved only to the ignored `backend/.env.docker` file with mode 0600. Development mode, administrator MFA flag, FCM, and notification-delivery flags were preserved. The JWT inline comment was removed for raw env-file compatibility; a CORS origin's trailing slash was removed to match browser origins; `TRUST_PROXY=false` was selected for direct localhost HTTP access.

`docker compose -f backend/compose.yaml config --quiet` passed with the populated file. Under Node 24, the compiled backend configuration loaded with no missing development requirements; Firebase JSON/private-key parsing and local messaging initialization passed. The native MongoDB client authenticated and executed only `{ping: 1}` against the configured Atlas database, then closed. Atlas SRV lookup returned three records. No application server, schedulers, migrations, seeds, or push deliveries were run. The supplied Render-style Redis internal hostname failed local DNS lookup; no external URL has been supplied or verified. Docker daemon access remains denied, so container runtime verification is still pending.

The documentation contract and strict MkDocs build passed again after adding environment-conversion and Render Redis guidance. OpenAPI, Mermaid, and Structurizr inputs did not change in this follow-up.

### Container Redis follow-up

The user requested Redis as a container. The standalone stack now defines `backend` and `redis`, with Redis append-only data on a named volume and backend startup gated on Redis health. Compose overrides `REDIS_URL` with `redis://redis:6379`. Only the Redis URL and notification-delivery setting were updated in the ignored development runtime file; Atlas/provider credentials and mode 0600 were retained. ADR-0012 supersedes the earlier external-Redis placement without rewriting ADR-0011's history.

| Check | Result | Evidence |
| --- | --- | --- |
| Compose configuration | Pass | Docker Compose 5.5.1 rendered exactly `backend` and `redis`; verified internal Redis URL, preserved Atlas/development/FCM settings, enabled delivery, `service_healthy` dependency, Redis ping probe, append-only/every-second fsync/noeviction command, named `/data` volume, common network, no published Redis port, no backend secrets injected into Redis, and API host ports 3000/3001 |
| Hosted Redis override | Pass | A temporary env-file override supplied a stale hosted Redis URL; Compose still selected the container URL. Temporary files were removed |
| Runtime file isolation | Pass | `backend/.env.docker` remains Git-ignored, uses container Redis, enables delivery, and has mode 0600 |
| Documentation contract | Pass | `python scripts/docs/validate_docs.py`: 77 local links, 117 matching API operations, 18 matching models, identical OpenAPI copies, 6 workflow YAML files |
| MkDocs strict build | Pass | `mkdocs build --strict` |
| OpenAPI lint | Pass with warnings | Valid contract; 106 existing warnings. API inputs unchanged |
| Mermaid | Pass | All 28 diagrams extracted and rendered, including the standalone backend/Redis/Atlas deployment |
| Structurizr | Pass | Structurizr CLI 2025.11.09 validated the updated standalone Redis deployment model using the temporary Java 21 runtime |
| Whitespace integrity | Pass | `git diff --check` |
| Stack startup | Unverified | `docker compose -f backend/compose.yaml up --build -d --wait --wait-timeout 120` failed before container creation because `/var/run/docker.sock` access is denied. Non-interactive sudo also requires a password |

No application source, API payload, model schema, or index changed. Redis runtime connectivity/persistence, actual queue processing, container-to-Atlas connectivity, and full readiness remain unverified. No shared Redis state or Atlas data was migrated, and no background delivery was started by these local checks.

## PR #50 Backend CI dependency audit, 2026-10-11

Reproduced the failing `backend` job before edits with Node 24.21.0 and npm 11.19.0, matching the hosted job runtime. `npm audit --audit-level=high` exited 1 locally with 47 vulnerability entries (6 moderate, 39 high, 2 critical). The hosted log failed at that same step before build/tests; advisory counts changed since the 2026-10-07 run.

Compatible lockfile updates cover axios, proxy-addr, undici, gRPC, busboy, handlebars, ip-address, and the brace-expansion override; tsc-alias also updates within its declared range. Nodemon moves to development dependencies. The new gate preserves a strict production audit and a full-tree high/critical audit with the exact-path, expiring exception described in [ADR-0013](../decisions/0013-time-limited-development-audit-exception.md). The raw full-tree audit still reports 39 entries (5 moderate, 34 high); all high entries derive from the one unpatched development `braces` advisory.

| Check | Result | Evidence |
| --- | --- | --- |
| Clean dependency installation | Pass | `npm ci` under Node 24.21.0 / npm 11.19.0, using the refreshed lockfile |
| Production dependency audit | Pass | `npm audit --omit=dev --audit-level=high`: zero vulnerabilities |
| Combined dependency gate | Pass | `npm run audit:dependencies`; without the exception the full-tree branch exited 1, and with the reviewed policy it passed |
| Backend build | Pass | `npm run build`: TypeScript and tsc-alias |
| Tests independent of containers | Pass | `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath` with the 31 test files that import neither Testcontainers nor the replica-set helper: 243 tests passed |
| Audit policy regressions | Pass | Included 8 tests using synthetic npm reports and the real audit-ci parser: allowed path before expiry; rejection of different high/critical advisories, unreviewed paths, a direct vulnerable dependency, the deadline, and registry errors; moderate threshold preserved |
| Documentation contract | Pass | `python scripts/docs/validate_docs.py`: 83 local links, 117 matching API operations, 18 matching models, identical OpenAPI copies, 6 workflow YAML files |
| MkDocs strict build | Pass | `mkdocs build --strict` in a temporary environment using `requirements-docs.txt` |
| OpenAPI lint | Pass with warnings | `npm run lint:openapi`: valid contract, 106 existing quality warnings |
| Whitespace integrity | Pass | `git diff --check` |
| Full Jest coverage / container tests | Unverified | `docker ps` was denied access to `/var/run/docker.sock`; the 12 container-dependent suites were not rerun and the full CI coverage threshold was not established locally |
| Hosted Backend CI rerun | Unverified | Local results establish the gate fix, not a new hosted run |

OpenAPI, Mermaid fences, and Structurizr inputs did not change. No application startup, shared database access, migrations, or provider deliveries were performed. The APK missing-secret failure is outside this backend fix. Follow-up requirements are recorded in [open questions](open-questions.md#backend-ci-audit-follow-up-2026-10-11).

## Administrator self-service password entry, 2026-10-21

The Personal Security page now links to the existing authenticated password-change screen independently of MFA loading. The focused Flutter administrator permission UI suite passed all 22 tests. The Impeccable detector reported no findings. Documentation validation passed with 90 links, 117 matching operations, 18 matching models, and identical OpenAPI copies; the strict MkDocs build and diff whitespace check passed. No API, model, Mermaid, or Structurizr inputs changed. No account password was changed. Browser rendering and hosted deployment are unverified.

## Administrator security navigation repair, 2026-10-21

A Zen browser check of the deployed dashboard reproduced the missing Personal Security sidebar item. The previous password-button change left its page unreachable. The dashboard now registers Personal Security for every administrator role without requiring platform or tenant management capabilities. All 25 administrator permission UI tests passed, including three regressions that select the sidebar item and follow Change password to its named route for App Admin, Hospital Admin, and Auditor. Documentation validation, strict MkDocs build, and the Impeccable detector passed. API, model, Mermaid, and Structurizr inputs did not change. No password was submitted. Post-deployment sidebar verification is pending.

## GCP deployment manual verification 2026-10-22

Inspected the Dockerfile, excluded build files, runtime configuration and readiness implementation, server startup, reminder scheduler, Redis and Filebase adapters, frontend routes, CI workflows, and existing deployment guidance. Added the Cloud Run operations manual and matching 12-page Word edition under ignored deliverables/gcp-deployment. Google Cloud documentation was checked for build context, injected PORT, Secret Manager roles, background billing, minimum instances, and revision rollback. No deployment settings or application behavior changed.

Documentation validation passed with 92 local links, 117 matching operations, 18 matching models, identical OpenAPI copies, and six workflow YAML files. The strict MkDocs build passed. OpenAPI lint passed with 106 existing warnings. Mermaid and Structurizr inputs did not change. The packaged DOCX renderer failed because LibreOffice was absent; Word exported the final document to a QA PDF and bundled Poppler rendered all 12 pages to PNG. Every page was visually reviewed; the final rerender changed only pages 1 and 5, which were reviewed again. Live service configuration, networking, IAM, billing, deployment, rollback, and clinical acceptance were not exercised for this authoring task.

## Doctor attention and monthly dose history, 2026-10-25

- Backend TypeScript build passed. Six attention/date/recording unit tests passed with `npm.cmd test --prefix backend -- --runInBand doctor-attention`.
- All 157 Flutter tests passed, including new month-default, day-selection, range-navigation, unavailable-history, review-sheet exit-animation, and failed-save retry tests. Focused Dart analysis of the changed doctor screens, models, widgets, and shared report card passed with no issues.
- Real HTTP acceptance against an isolated native local MongoDB replica set passed: roster summary projection, patient-specific targets, complete monthly history, explicit review and queue clearing, rejection of client-supplied reviewer IDs, unknown historical review state, cross-hospital read/write rejection, and new uploads pending without automatic critical classification. Acceptance used fictional local patients and restored their sample report state afterward.
- Docker Desktop could not start because its inference listener failed. The full Docker/Testcontainers backend suite was not run in this task. The native MongoDB preview is a separate disposable local database; no hosted/shared database or deployment was modified.
- Documentation contract passed with 117 matching API operations, 18 model markers, and byte-identical OpenAPI copies. Strict MkDocs build and OpenAPI lint passed; lint retained 106 warnings. All 28 Mermaid diagrams rendered. Structurizr inputs did not change, so its Docker validator was not rerun. `git diff --check` passed.
- The running Flutter web app was inspected with the local doctor account: attention categories, individual target context within patient records, monthly dose states, and calendar navigation were verified. The final overview shows only attention labels, and the calendar footer text is removed. Hospital acceptance and production rollout remain unverified.


## Runtime presentation properties, 2026-10-27

Implemented a public versioned property snapshot, administrator draft/save/publish/restore workflow, separate public image uploads, Flutter bundled defaults and scoped cache, startup/resume refresh, shared branding images, supported theme colors, and routine server notification templates. The catalogue contains 881 properties. Stable route/API/permission identifiers and clinical enforcement remain in code. No hosted database, deployment, provider account or real patient record was changed.

| Check | Result | Evidence |
| --- | --- | --- |
| Backend TypeScript build | Pass | `npm.cmd run build --prefix backend` |
| Complete backend suite | Pass | 45 suites, 676 tests with `npm.cmd test --prefix backend -- --runInBand`; isolated Docker MongoDB/Redis fixtures |
| Complete Flutter suite | Pass | 166 tests with `flutter test --no-pub` from frontend |
| Static analysis | Pass | `dart analyze --format machine frontend/lib frontend/test`; no diagnostics after lint cleanup |
| Release web build | Pass | `flutter build web --release --no-pub`; generated build/web and successful Wasm dry run |
| Property catalogue | Pass | `python scripts/properties/sync.py --check`; identical JSON defaults, generated Dart map, and valid static consumers |
| Documentation contract | Pass | 122 matching API operations, 20 matching models, identical OpenAPI copies, six workflow YAML files |
| Strict MkDocs build | Pass | `mkdocs build --strict` |
| OpenAPI lint | Pass with existing warnings | `npm.cmd run lint:openapi --prefix backend`; 106 warnings |
| Mermaid | Pass | All 28 diagrams extracted and rendered |
| Structurizr | Pass | `structurizr/cli:2025.11.09 validate` |
| Editor layout and permissions | Pass | Draft/search/save, read-only controls and desktop/mobile widget checks; mechanical UI detector returned no findings |
| Diff whitespace | Pass | `git diff --check` |

New integration coverage verifies unpublished drafts remain private, public reads do not create state, ETag revalidation, concurrent-edit conflict rejection, atomic publication, rollback to initial defaults, protected management endpoints, service-level role/read-only restrictions, image content addressing and public bytes, image limits, template placeholder integrity, and exact maintenance exemptions. Flutter coverage verifies offline cached startup, background-refresh persistence, absence of auth headers on public requests, invalid/stale snapshot rejection, bundled fallback and form-state preservation across property changes.

Production rollout, real-device offline/resume behavior, external image hosting and end-to-end acceptance on the deployed application remain unverified. Configuration is global; hospital-specific overrides, installed launcher/splash metadata and unreferenced-image cleanup are not implemented.


## Runtime property follow-up, 2026-10-28

Compared the runtime-property behavior with the original plan and corrected missed patient/report headings, conditional ETag refresh with browser CORS support, forced refresh during an existing pre-publication request, and acceptance of nonexistent uploaded-logo references. The catalogue now contains 884 properties. The linked application-properties runbook and implementation follow-up describe remaining scope explicitly.

- Full Dart analysis of frontend/lib and frontend/test passed with no diagnostics. Backend TypeScript build passed.
- All 168 Flutter tests passed, including new cached-304 and forced-refresh ordering regression tests.
- All 11 app-properties MongoDB/HTTP integration tests passed against an isolated Docker fixture. New coverage verifies missing uploaded-image rejection and browser access to conditional-request headers.
- Documentation contract passed with 122 matching operations, 20 matching models and identical OpenAPI copies. Strict MkDocs build passed; OpenAPI lint passed with 106 existing warnings. Mermaid and Structurizr inputs did not change in this follow-up.
- The optional CodeRabbit review was unavailable: the installer rejected Windows Git Bash, and WSL had no /bin/bash. No CodeRabbit review result is claimed.

These checks do not establish live deployment, hospital-specific overrides, device acceptance, remote typography or locale support.

## Client branding completion, 2026-10-28

Inspected Flutter startup, API bootstrap, theme, property cache, shared headers, login artwork, administrator navigation/editor/repository, backend SystemConfig, AppProperties publication, BrandAsset storage/controllers, and existing configuration documentation. The existing runtime-property service already supports application name, colors and logo publication. This change reuses that service, connects the published hospital logo to administrator navigation, and shares image resolution with the draft preview so both logos render against local HTTP or deployed APIs.

| Check | Result | Evidence |
| --- | --- | --- |
| Focused Flutter regression tests | Pass | 38 tests covering property cache/refresh, atomic validation, editor drafts, administrator permissions, branding updates without losing form edits, remote-image fallback and phone/tablet/desktop navigation; run with `--dart-define=API_BASE_URL=http://127.0.0.1:3000` |
| Preview visual checks | Pass | Three editor tests rerun with screenshot capture and Flutter SDK Roboto/MaterialIcons fonts; inspected 1440x1000 and 390x844 captures with both logos and no layout exceptions |
| Dart analysis | Pass | `dart analyze --format machine lib test` from `frontend`; focused analysis also passed after the screenshot font-loader addition |
| Flutter release web build | Pass | `flutter build web --release --no-pub --dart-define=API_BASE_URL=http://127.0.0.1:3000`; Wasm dry run also succeeded. This is a local validation build |
| Backend TypeScript build | Pass | `npm.cmd run build --prefix backend` |
| Property catalogue | Pass | `python scripts/properties/sync.py --check`; 884 defaults and static consumers match |
| Documentation contract | Pass | `python scripts/docs/validate_docs.py`; 122 matching API operations, 20 matching models and byte-identical OpenAPI copies |
| Strict MkDocs build | Pass | `mkdocs build --strict` |
| OpenAPI lint | Pass with existing warnings | `npm.cmd run lint:openapi --prefix backend`; valid contract, 106 warnings |
| UI detector | Pass | Impeccable mechanical detector returned no findings for the three changed Flutter implementation files |
| Whitespace integrity | Pass | `git diff --check` |
| MongoDB integration suite | Not rerun | Docker Desktop's Linux engine pipe was unavailable. Backend implementation, API contracts and persistence did not change |

No API, persistence, Mermaid or Structurizr inputs changed, and no new architectural decision supersedes ADR-0016. No production configuration, client image, database, account or deployment was changed. Deployment, installed-device refresh/offline behavior, client-specific artwork/contrast and tenant-specific branding limits are recorded in [open questions](open-questions.md#client-branding-acceptance-2026-10-28). Unrelated pre-existing working-tree changes were preserved.

## Backend CI dependency repair, 2026-10-28

GitHub Actions run `40561306997` failed at the production audit before build/tests. Reproduced `npm run audit:dependencies` exiting 1 under local Node 24.15.0/npm 11.12.1 with four high and two moderate production findings. Updated only compatible lockfile resolutions for body-parser, follow-redirects, multer, Zod, qs and ip-address, with body-parser's content-type/iconv-lite dependencies. The full-tree audit then exposed high findings in development-only undici; its 7.30.1 patch resolves that second blocker. No audit threshold, allowlist, manifest dependency range, application API, schema or workflow changed.

- Clean `npm ci --no-audit --fund=false` succeeded. Backend TypeScript build and OpenAPI lint passed; lint retained 106 warnings.
- The complete `npm run audit:dependencies` gate passed after the final patch: zero production vulnerabilities, zero high/critical full-tree findings, and seven low development findings. The pre-existing expiring exception is unchanged; audit-ci reported its paths unused by the current registry report.
- All 32 backend suites that do not require container fixtures passed, totaling 249 tests, including validation, file handling, route enforcement, runtime configuration and the eight audit-policy regression cases.
- `flutter analyze --no-pub` passed and the complete Flutter suite passed all 170 tests, including the branding changes. Property catalogue validation passed for all 884 defaults.
- Documentation validation, strict MkDocs build, OpenAPI copy parity and whitespace checks passed. No Mermaid or Structurizr inputs changed.

Local Docker remains unavailable, so the complete container-backed coverage run requires the hosted workflow. Hosted checks for the pushed commit must be distinguished from these local results. Application deployment, real-device branding acceptance and client artwork remain outside this CI repair; see [client branding acceptance](open-questions.md#client-branding-acceptance-2026-10-28).
