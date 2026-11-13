# VitaLink GCP deployment manual

Version 1.0 | 22 October 2026 | Repository baseline 1f50c69

This manual is for the operator who deploys and maintains the VitaLink Express backend on Google Cloud Run and connects it to the Flutter web application. Follow the sections in order for a first deployment. For an existing service, begin with the release and rollback procedure after confirming its configuration.

The deployment has a Cloud Run API, a separately built Flutter frontend, and external data and integration services. The container does not provision MongoDB, Redis, object storage, Twilio, Firebase, or a malware scanner. A healthy container is only the first acceptance check; complete the application checks before handing the service to users.

## Deployment map

| Component | Location and responsibility |
| --- | --- |
| Backend API | Cloud Run container built from backend/Dockerfile |
| Web application | Existing Vercel project vitalinkwebapp; API origin compiled into Flutter |
| Database | MongoDB Atlas or another approved MongoDB deployment |
| Shared coordination | Redis reachable from Cloud Run for queues and shared security state |
| Clinical files | Filebase S3 endpoint used by the current storage adapter |
| External delivery | Twilio Verify and optional Firebase Cloud Messaging |
| Upload scanning | Separately operated HTTPS scanner |
| Secrets | Google Secret Manager, injected into the Cloud Run runtime |

The API address recorded in the existing runbook is https://vitalink-ip-lab-98286338620.europe-west1.run.app and the web address is https://vitalinkwebapp.vercel.app. Confirm both in the provider dashboards before using them. These are recorded targets, not a fresh live-health observation for this manual. The service region in that API address is europe-west1; confirm the project ID and service name in Cloud Run rather than deriving them from the hostname.

### How to use this manual

Prepare the project and dependencies, build the backend, configure the service and secrets, connect the frontend, and complete verification. Then retain the release record. All sample values in angle brackets must be replaced. Never enter a placeholder into a live secret.

## Prepare the Google Cloud project

1. Sign in to the Google Cloud console with the deployment operator account. Select the intended project using the project selector. Record its project ID and project number.
2. Confirm billing is enabled. Enable Cloud Run, Cloud Build, Artifact Registry, and Secret Manager APIs when prompted. Use separate projects or separately isolated resources for staging and production.
3. Confirm the operator can configure Cloud Run and act as its runtime service account. Google documents Cloud Run Admin and Service Account User for configuring service secrets. Build identity permissions depend on the selected repository integration; use its setup prompts and the build error details rather than granting broad project ownership.
4. Create or select a dedicated runtime service account in IAM and Admin. Keep it distinct from the Cloud Build identity. Grant Secret Manager Secret Accessor on each required secret to this runtime identity.
5. Confirm GitHub repository access to SuryaNarayanaa/vitalink_ip_lab and authorization to install or use the Cloud Run repository connection. Select only the intended repository.
6. Record the release commit, existing revision, current traffic assignment, and database backup or restore point before making changes.

### Operator worksheet

| Record | Value to complete |
| --- | --- |
| Project ID and number | Copy from the Google Cloud project |
| Cloud Run service and region | Confirm in the service list |
| Runtime service account | Record its email address |
| Build trigger and repository branch | Record trigger name and main or approved release branch |
| Release commit and previous revision | Record immutable identifiers |
| Database restore point and owner | Confirm outside this repository |
| Frontend origin and backend URL | Copy the exact HTTPS origins |

## Prepare external services

MongoDB must be reachable before the server starts listening because server startup awaits the database connection. Use the intended database user and database name in MONGO_URI. Confirm DNS, TLS, credentials, and Atlas network access from the Cloud Run network path. Cloud Run does not automatically provide a fixed outbound address; arrange approved private connectivity or controlled egress when the database allowlist requires a stable address. Do not treat a successful workstation connection as proof of container connectivity.

Redis must use a reachable external endpoint. The Compose value redis://redis:6379 resolves only inside that Compose network and must not be copied into Cloud Run. Use an approved managed or private Redis service and configure the required network path. Use rediss:// where that endpoint requires TLS. The backend supports process-local fallbacks for some Redis consumers, so missing Redis can reduce shared behavior even when a basic HTTP check succeeds.

The storage adapter uses https://s3.filebase.com. Supply the matching ACCESS_KEY_ID, SECRET_ACCESS_KEY, and S3_BUCKET_NAME. A Google Cloud Storage bucket is not a drop-in replacement for this adapter. Confirm a sandbox upload and authorized read before enabling clinical uploads.

Provide an HTTPS scanner through MALWARE_SCAN_URL. The scanner must return a JSON response with clean set to true for a clean upload. Configure its token through MALWARE_SCAN_AUTH_TOKEN when required. Scanner failure or timeout rejects an upload before storage.

Configure Twilio Verify using its account SID, auth token, and Verify service SID. Enable Firebase push only when its project, service account, app configuration, and device registration are ready. Payment checkout additionally needs its provider settings and webhook secret. None of these provider services is created by the Docker build.

## Create and map secrets

Open Secret Manager and create secrets using the environment names below or your approved naming scheme. Add actual values in the console or through an approved secret-management process. Select explicit secret versions for a reproducible release. Keep database passwords, JWT keys, TOTP keys, and provider credentials out of source files, screenshots, and release notes.

| Runtime name | Required value or condition |
| --- | --- |
| MONGO_URI | Target MongoDB URI including database name |
| JWT_SECRET | Strong environment-specific signing secret |
| ADMIN_TOTP_ENCRYPTION_KEY | Stable environment-specific key for stored administrator TOTP material |
| ACCESS_KEY_ID | Filebase access key identifier |
| SECRET_ACCESS_KEY | Filebase secret key |
| TWILIO_ACCOUNT_SID | Twilio account identifier |
| TWILIO_AUTH_TOKEN | Twilio credential |
| TWILIO_VERIFY_SERVICE_SID | Verify service identifier |
| REDIS_URL | Approved reachable Redis URL; protect embedded credentials |
| FIREBASE_SERVICE_ACCOUNT | Complete service-account JSON when FCM_ENABLED is true |
| MALWARE_SCAN_AUTH_TOKEN | Scanner credential when required |
| API_DOCS_USERNAME and API_DOCS_PASSWORD | Required when protected API documentation is enabled |
| PAYMENT_PROVIDER_API_KEY and PAYMENT_WEBHOOK_SECRET | Required for configured checkout and settlement integration |

To map a secret, open Cloud Run, select the service, and choose the action to edit and deploy a revision. In the container variables and secrets area, choose Reference a secret. Set the environment variable name, select the secret, and choose the approved version. Confirm the selected runtime service account has Secret Accessor for that secret. Deploying a new environment-variable secret version requires a new revision; it does not change running instances automatically.

Preserve the existing TOTP encryption key during routine deployments. Replacing it without a recovery plan can make stored enrollment material unusable. Treat JWT key rotation as a deliberate session-impacting operation.

## Build the backend from GitHub

1. Open Cloud Run and create a service, or open the existing service and its repository build configuration. For continuous deployment, choose the repository-based deployment option using Cloud Build.
2. Connect the intended GitHub repository. Select the production branch pattern ^main$ when production should track main. Review whether saving a matching single-branch trigger starts a build immediately.
3. Select Dockerfile as the build type. Set Source location to backend/Dockerfile, or /backend/Dockerfile where the console displays a repository-root path. Its directory must be the Docker build context.
4. If the interface has a separate build-context field, set it to backend. The Dockerfile copies package.json and package-lock.json from that context. A repository-root build context will not match those COPY instructions.
5. Save the build settings. Review the resulting Cloud Build trigger, target service, Artifact Registry image, and branch before running it.
6. Run the approved build and follow its logs. Confirm npm ci, TypeScript compilation, production dependency installation, image creation, and deployment complete successfully. Match the build source SHA to the release record.

### Equivalent local build for diagnosis

Run this command from the repository root on a machine with Docker. It checks the same context boundary without deploying a service.

```powershell
docker build -f backend/Dockerfile -t vitalink-backend:check backend
```

The Dockerfile uses Node 24 Alpine, installs dependencies from the lockfile, compiles the backend, and runs node build/src/server.js as the node user. It excludes populated environment files through backend/.dockerignore. Keep the default container command and arguments unless the release intentionally changes the entry point. No Cloud Run build trigger configuration is checked into this repository; confirm its live settings in Google Cloud.

Complete the runtime variables, secret mappings, networking, and service settings in the next sections before submitting a new service. Click Create for a new service or Deploy changes for a new revision, then wait for the build and revision status before verification.

## Configure the Cloud Run service

Open the service configuration and expand Containers, Networking, Security or the equivalent sections shown by the console. Keep the existing service identity and network configuration unless a reviewed change requires otherwise.

| Console setting | Value or operator action |
| --- | --- |
| Region | Existing service region, or an approved region for a new service |
| Container port | 3000 |
| Container command and arguments | Leave empty to use the Dockerfile command |
| PORT environment row | Remove any manually entered row; Cloud Run injects PORT |
| Runtime service account | Dedicated identity with access to the referenced secrets |
| Ingress | Internet ingress is needed for a browser calling this API directly, unless a gateway provides the public route |
| Invocation authentication | Direct Flutter calls require platform-level public invocation; application JWT and role checks still protect API operations |
| CPU and memory | Select a measured allocation and review startup and load behavior; no capacity baseline is established here |
| Request timeout | Choose for the supported HTTP and stream workflows and verify reconnect behavior |
| Startup probe | Recommended HTTP GET /health/ready on port 3000 with a sufficient startup budget |
| Liveness probe | Recommended HTTP GET /health/live on port 3000 |

Public invocation exposes the HTTP service to unauthenticated callers at the Cloud Run layer. This supports login, health checks, and the app's own authentication protocol. Do not select it for a service intended to be private behind an identity-aware gateway without adapting the client path.

The Docker HEALTHCHECK does not substitute for explicitly configured Cloud Run probes. Readiness is an application endpoint in this repository. A liveness probe should detect a broken process, not continually restart a healthy process because an external dependency is temporarily unavailable.

## Configure runtime variables and background work

Set the following ordinary variables in the container configuration. Map sensitive values through Secret Manager. Read backend/.env.example alongside backend/src/config/index.ts when adding integration-specific settings.

| Variable | Deployment value |
| --- | --- |
| NODE_ENV | production, or staging for an isolated acceptance environment |
| API_VERSION | v1 |
| CORS_ALLOWED_ORIGINS | Exact comma-separated browser origins such as https://vitalinkwebapp.vercel.app |
| TRUST_PROXY | Validate the trusted proxy path; the production source default is one hop |
| S3_BUCKET_NAME | Matching Filebase bucket name |
| FILE_ASSET_LEGACY_CUTOFF_AT | Approved migration timestamp in ISO 8601 format |
| MALWARE_SCAN_ENABLED | true in production and staging |
| MALWARE_SCAN_URL | Reachable HTTPS scanner endpoint |
| FCM_ENABLED | true only when Firebase push is configured; otherwise false |
| NOTIFICATION_DELIVERY_ENABLED | Enable only with working Redis and intended delivery configuration |
| API_DOCS_ENABLED | false unless protected API docs are explicitly required |
| LOG_LEVEL | info unless a time-limited diagnostic setting is approved |
| DOSAGE_REMINDER_TIMEZONE | Asia/Kolkata for the intended India clinical day |

The readiness implementation requires MongoDB, JWT, TOTP, storage, Twilio, the legacy file cutoff, and scanner configuration in production and staging. Firebase credentials are conditional on FCM being enabled; documentation credentials are conditional on API docs being enabled. Missing entries appear by name in the readiness response. Do not change NODE_ENV to development to make production readiness pass.

### Keep background work running

The API process starts in-process reminder schedules, notification recovery, and the notification worker. For this combined process, use instance-based billing with at least one minimum instance when continuous background execution is required. This is an operational recommendation, not a verified setting of the existing service. Minimum instances alone with request-only CPU is insufficient for dependable background processing.

Set maximum instances and concurrency from measured database, Redis, provider, and memory limits. Even a one-instance target can overlap old and new revisions during deployment. Shared Redis, MongoDB indexes, and reminder idempotency must remain valid. This configuration does not create a separate worker service, external scheduler, or an exactly-once execution guarantee. Review idle CPU and scheduled delivery behavior before relying on reminders.

## Connect the Flutter web application

The existing frontend is hosted by Vercel. This manual keeps that frontend and points it to the Cloud Run API. It does not migrate web hosting to GCP.

1. Open the Vercel project vitalinkwebapp. Confirm the linked repository and production branch main.
2. Confirm Root Directory is frontend, Framework Preset is Other, and Output Directory is build/web.
3. Use the Flutter version pinned by the current frontend CI. At this manual's source baseline, that version is 3.44.8.
4. Use an install command that obtains that Flutter version and runs flutter pub get. Set the build command to include the actual Cloud Run origin as API_BASE_URL and /api/v1 as API_PATH_PREFIX.
5. Deploy the frontend, confirm its source SHA, and verify it reaches the intended backend in the browser network panel. A dashboard environment-variable edit alone cannot retarget an already compiled Flutter bundle.

Example Flutter build command after Flutter is available:

```bash
flutter build web --release \
  --dart-define=API_BASE_URL=https://<cloud-run-host> \
  --dart-define=API_PATH_PREFIX=/api/v1
```

Add the exact Vercel production origin to CORS_ALLOWED_ORIGINS in Cloud Run and deploy a revision with that value. Include any approved custom or preview origins individually. Do not assume production-origin acceptance covers all preview domains. The checked-in Vercel /api rewrite targets Render, so use the explicit Cloud Run build define for this path. The GitHub Pages workflow also builds separately and currently omits that define; do not assume its app uses the Cloud Run backend.

### Check browser preflight

Run this PowerShell command after replacing the host. Expect a successful preflight with Access-Control-Allow-Origin equal to the intended frontend origin and POST allowed.

```powershell
curl.exe -i -X OPTIONS "https://<cloud-run-host>/api/v1/auth/login" `
  -H "Origin: https://vitalinkwebapp.vercel.app" `
  -H "Access-Control-Request-Method: POST"
```

## Verify and hand over the deployment

First check the Cloud Build result, deployed image, revision Ready condition, runtime identity, secret versions, and traffic assignment. Then run the public probes from PowerShell. Replace the host once in the variable below.

```powershell
$apiOrigin = 'https://<cloud-run-host>'
Invoke-RestMethod "$apiOrigin/health/live"
Invoke-RestMethod "$apiOrigin/health/ready"
Invoke-RestMethod "$apiOrigin/api/v1"
```

Expect HTTP 200 from each endpoint. Readiness should report database.connected as true, configuration.ready as true, and an empty missing_environment_variables list. Firebase may be disabled when not requested. An enabled notification worker must report started. These flags describe initialization and configuration; they do not prove provider delivery, scanner reachability, successful Redis coordination, or correct clinical outcomes.

### Application acceptance

1. Open the deployed frontend in a fresh browser session. Confirm its API requests use the Cloud Run origin.
2. Sign in with an approved administrator test account. Complete authenticator verification or enrollment when required. Do not disable administrator MFA to bypass acceptance failures.
3. If the account has a temporary or expired password, complete the password-change flow and sign in again. Administrators can use Personal Security then Change password; the direct web route is /#/change-password. The account owner enters and submits credentials.
4. Confirm each administrator role sees its permitted destinations and a tenant administrator cannot read another hospital's data. Use approved sandbox records.
5. Verify one doctor and one patient flow relevant to the release, including permitted patient assignment, INR reporting, and prescribed dosage visibility where applicable.
6. Exercise storage and scanning with sandbox files. If notifications or billing are enabled, verify their sandbox provider outcomes separately.
7. Record expected and actual results, revision, commit, test accounts by identifier only, and any unresolved issue. Remove test sessions or sign them out through the application.

Stop release handover if readiness fails, access isolation fails, audit records are missing, or a clinical write has an ambiguous outcome. Follow the incident and rollback procedures rather than repeating an uncertain mutation.

## Release updates and rollback

For an update, review the change, run its required tests, capture the current revision and traffic assignment, and confirm database backup and compatibility. Push only approved changes to the configured branch. In Cloud Build, confirm the trigger used the expected commit; in Cloud Run, confirm the new image, runtime configuration, and revision state. Complete health, CORS, and affected-role acceptance again.

Source builds and application checks are separate. A completed Cloud Build or Vercel status does not establish that every repository CI check passed. The repository's backend-cd.yml describes an EC2 path, not this Cloud Run trigger. Review active automation before a release so a push does not unexpectedly deploy to another environment.

### Roll back service traffic

1. Open Cloud Run and select the affected service. Open Revision history or Revisions.
2. Identify the last known good revision using the release record. Verify that its secret versions and external dependencies still exist and that it remains compatible with the current database.
3. Open Manage traffic. Choose Send all traffic to one revision and select that known good revision. Save the traffic assignment.
4. Confirm the selected revision receives 100 percent of traffic. Repeat health checks and a non-destructive application smoke test. Cloud Run does not rerun deployment health checks for you when routing traffic back.
5. Prevent an automatic redeployment of the faulty source through the configured trigger while preparing the repair. Record any trigger pause and restore it after the fix is approved.

Cloud Run traffic rollback does not restore database records, indexes, object files, or secrets. Plan those separately. Do not run the EC2 deploy.sh rollback command against Cloud Run. If a frontend build changed the API origin or client contract, restore a compatible Vercel deployment as a separate action.

## Troubleshoot deployment failures

| Symptom | Check and corrective action |
| --- | --- |
| Build cannot copy package.json | Docker context must be backend; verify the Dockerfile source location and build log |
| Container never listens | Set Container port to 3000, remove manual PORT, keep the default command, and inspect startup or database errors |
| Secret access denied | Verify the runtime service account, secret-level Secret Accessor role, selected version, and whether that version is enabled |
| MongoDB timeout or authentication failure | Confirm URI, database user, DNS, TLS, network access list, and Cloud Run egress path |
| Readiness returns 503 | Read the named configuration gaps, database state, Firebase failure, and enabled worker state; repair the relevant dependency |
| Scanner configuration failure | Use HTTPS and set scanning true; test the clean-response contract from the service network |
| Browser reports CORS failure | Match the complete frontend origin, deploy the backend variable change, and inspect OPTIONS independently of login |
| App still calls Render | Rebuild Flutter with the Cloud Run API_BASE_URL; check browser requests and the compiled deployment, not just dashboard variables |
| Reminder or push work stops while idle | Verify instance-based billing, minimum instances, Redis, worker state, and provider outcomes |
| Redis host cannot resolve | Replace Compose-only redis hostname with the approved reachable Redis endpoint and network route |
| Login requires enrollment or password change | Follow the built-in account flow; verify system policy and deployed revision rather than weakening authentication |
| Personal Security is missing | Confirm the deployed frontend includes commit 1f50c69 or a descendant, then reload and inspect the sidebar |
| Upload or payment fails despite healthy API | Test that integration separately; readiness checks do not exercise complete provider transactions |

Use Cloud Run Logs for startup and request failures, Cloud Build History for image/build errors, and Vercel deployment logs for Flutter compilation. Keep request correlation and revision identifiers in incident evidence. Redact tokens, credentials, step-up headers, and patient information before sharing logs.

## Routine operations and release record

Monitor request failures, latency, container restarts, memory, startup time, worker outcomes, MongoDB connections, Redis availability, and provider failures. Configure alerts and budget notifications for the actual project. Instance-based billing and minimum instances can incur charges while no requests are arriving. Use current Google Cloud pricing and project usage rather than assuming a free deployment.

Run migrations only when the release requires them. Review the exact script, supported dry-run mode, backup, target database, and validation query first. Cloud Run deployment does not automatically execute the repository's maintenance scripts. Do not use patient file-purge scripts as schema migrations. Keep FILE_ASSET_LEGACY_CUTOFF_AT coordinated with the existing migration plan.

### Release record to complete

- Release time and operator
- Project, region, service, and runtime identity
- Commit SHA, image digest, new revision, and previous good revision
- Build trigger and build result
- Secret version identifiers only, without secret values
- Database restore point and migration evidence
- Health, CORS, authentication, tenant isolation, and integration results
- Frontend deployment and compiled API origin
- Rollback owner and unresolved issues

### Implementation references

Repository paths at baseline 1f50c69: backend/Dockerfile; backend/.dockerignore; backend/.env.example; backend/src/config/index.ts; backend/src/config/s3-client.ts; backend/src/config/redis.ts; backend/src/server.ts; backend/src/app.ts; backend/src/jobs/dosage.scheduler.ts; frontend/lib/app/routers.dart; frontend/lib/features/admin/admin_dashboard_page.dart; .github/workflows/backend-cd.yml; .github/workflows/deploy_web.yml; docs/environments.md; docs/operations/deployment-runbook.md. The Word edition and this page describe the same procedure.

### Google Cloud references

Platform instructions checked on 22 October 2026. Console labels may change.

- [Continuous deployment and Docker build context](https://docs.cloud.google.com/run/docs/continuous-deployment)
- [Container runtime contract and injected port](https://docs.cloud.google.com/run/docs/container-contract)
- [Secret configuration and runtime permissions](https://docs.cloud.google.com/run/docs/configuring/services/secrets)
- [Billing settings for background execution](https://docs.cloud.google.com/run/docs/configuring/billing-settings)
- [Minimum service instances](https://docs.cloud.google.com/run/docs/configuring/min-instances)
- [Traffic migration and rollback](https://docs.cloud.google.com/run/docs/rollouts-rollbacks-traffic-migration)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
