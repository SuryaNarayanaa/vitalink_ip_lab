# Deploy VitaLink to another Google Cloud account using a Docker image

This tutorial deploys the **backend API** to Cloud Run in a new Google Cloud project. The diagrams are instructional illustrations, not screenshots of a live console. Console labels may change. The Flutter web client is built separately, and MongoDB, Redis, Filebase, Twilio and the malware scanner must be provisioned independently. No cloud resources were created while writing this guide.

Use a staging project and sandbox data for the first rehearsal. This guide does not establish clinical readiness. For detailed operational controls, consult the [GCP deployment manual](gcp-deployment-manual.md) and [backend Docker runbook](backend-docker-runbook.md).

## 1. Understand the destination

```text
 REPOSITORY / RELEASE MACHINE             NEW GOOGLE CLOUD PROJECT
 +---------------------------+           +----------------------------+
 | backend/Dockerfile        |  push     | Artifact Registry          |
 | backend/ build context    | --------> | private backend image      |
 +---------------------------+           +-------------+--------------+
                                                       | deploy digest
                                                       v
 Browser --> Flutter web host --> HTTPS --> +----------+-------------+
                                            | Cloud Run API           |
                                            | port 3000               |
                                            +-----+------+------------+
                                                  |      | secret values
                               +------------------+      v
                               |                 Secret Manager
                               v
                MongoDB / Redis / Filebase / Twilio / scanner
                (separate services and network access)
```

Cloud Run runs the Node image; it does not import Docker Compose or create its Redis container. The checked-in backend Dockerfile uses `backend/` as the build context, exposes port 3000, and runs `node build/src/server.js`. The Flutter client and optional ML research artifacts are not part of that image. The existing storage adapter targets Filebase's S3 endpoint; a Cloud Storage bucket is not a direct replacement.

## 2. Fill in the release worksheet

| Item | Example or operator entry |
| --- | --- |
| Destination Google account and project ID | `<destination-project-id>`; confirm billing is enabled |
| Region | `europe-west1` is an example, choose an approved region |
| Artifact Registry Docker repository | `vitalink-images` |
| Cloud Run service | `vitalink-api` |
| Release commit and image digest | Record both; a tag alone can move |
| Runtime service account | `vitalink-runtime@<destination-project-id>.iam.gserviceaccount.com` |
| Frontend HTTPS origin | Exact destination web origin, including scheme |
| MongoDB, Redis, Filebase, scanner, Twilio | Record owners, network paths, secret names and sandbox accounts, not credential values |
| Backup and rollback owner | Record the restore point and responsible person |

Prerequisites: an approved source checkout or an image supplied by its owner; Google Cloud CLI; Docker with a running Linux engine for the image steps; permission to enable APIs, create repositories and services, act as the runtime identity, and grant its access to secrets. A project administrator may need to perform the IAM steps. Review the source account's image-sharing and licensing policy before copying an image.

## 3. Select the correct account and project

```text
 Google Cloud console
 +-----------------------------------------------------+
 | Account avatar: destination account                 |
 | Project selector: destination project                |
 | Billing: linked     APIs: enabled                    |
 +-----------------------------------------------------+
```

Sign into the destination account, create or select its project, and link billing. Enable **Cloud Run Admin API**, **Artifact Registry API**, and **Secret Manager API**. Enable Cloud Build API only if you choose a Cloud Build process. Cloud Shell or a local PowerShell session can run the commands below; Docker commands require an available Docker engine.

```powershell
gcloud auth login
gcloud auth list
$projectId = 'REPLACE_WITH_DESTINATION_PROJECT_ID'
$region = 'europe-west1'
$repository = 'vitalink-images'
$service = 'vitalink-api'
$releaseTag = 'release-2026-11-01' # replace with your approved release identifier
gcloud config set project $projectId
gcloud config get-value project
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com --project $projectId
```

Check the displayed account and project before continuing. A project name and its globally unique project ID are different. Organization policy may require additional permissions or deny public invocation.

## 4. Create the image repository

In **Artifact Registry > Repositories > Create repository**, select format **Docker**, the destination project and your selected region. Or create it once with:

```powershell
gcloud artifacts repositories create $repository --repository-format=docker --location=$region --project=$projectId --description='VitaLink backend images'
$registryHost = "$region-docker.pkg.dev"
$image = "$registryHost/$projectId/$repository/vitalink-backend`:$releaseTag"
gcloud auth configure-docker $registryHost
```

The destination operator needs Artifact Registry Writer on the repository. Approve the Docker credential-helper prompt. Confirm the repository location and project in the console before pushing.

## 5. Obtain and push the backend image

Choose **one** of these paths. Run from the repository root for path A. Record the actual Git commit, build platform, and any release approval before building. Cloud Run requires a Linux image with an `amd64`-compatible manifest. On an ARM workstation, use a correctly configured Docker Buildx builder.

```text
 A. Source checkout ---- docker build ----+
                                         +--> tag --> destination Artifact Registry
 B. Existing image ---- pull by digest ---+
```

### A. Build from the repository

```powershell
git rev-parse HEAD
docker build --platform linux/amd64 -f backend/Dockerfile -t $image backend
if ($LASTEXITCODE -ne 0) { throw 'Docker build failed' }
docker push $image
if ($LASTEXITCODE -ne 0) { throw 'Docker push failed' }
```

The final `backend` argument is required: it supplies the files copied by the Dockerfile. Do not place `.env` files or credentials in an image or build arguments. The checked-in `backend/.dockerignore` excludes environment files.

### B. Copy an approved existing image

Obtain its **full source image reference with SHA-256 digest** from the source owner. The operator needs pull access to the source registry and push access to the destination repository. Configure authentication for both registry hosts. This copies an image, not its database, Cloud Run configuration or secrets.

```powershell
$sourceImage = 'SOURCE_REGISTRY/PROJECT/REPOSITORY/IMAGE@sha256:REPLACE_WITH_DIGEST'
docker pull $sourceImage
if ($LASTEXITCODE -ne 0) { throw 'Source image pull failed' }
docker tag $sourceImage $image
docker push $image
if ($LASTEXITCODE -ne 0) { throw 'Destination image push failed' }
```

In Artifact Registry, open **Repositories > vitalink-images > vitalink-backend**, select the pushed version, and copy its digest. Verify the destination image and record its digest, release tag and source commit or source digest. For the deploy step, use the destination digest reference, `REGION-docker.pkg.dev/PROJECT/REPOSITORY/vitalink-backend@sha256:...`, not merely the mutable tag. Verify image provenance and architecture with the release owner, especially if the source image was not built from this checkout.

## 6. Prepare dependencies and secrets

```text
 Secret Manager                    Cloud Run revision
 +----------------------+         +-------------------------------+
 | MONGO_URI, version 1 | ------> | MONGO_URI = secret reference  |
 | JWT_SECRET, version 1| ------> | JWT_SECRET = secret reference|
 | ...                  |         | Service account: runtime      |
 +----------------------+         +-------------------------------+
             Grant this identity Secret Manager Secret Accessor
             on each referenced secret.
```

Create a dedicated service account in **IAM & Admin > Service Accounts**. Create secrets in **Security > Secret Manager** with the values supplied through your approved secret process, then grant this identity `Secret Manager Secret Accessor` on each referenced secret. The deploying operator also needs permission to act as that service account. Select explicit secret versions when configuring the revision. Do not paste secret values into commands, screenshots, logs or this worksheet.

| Environment variable | Where to obtain it |
| --- | --- |
| `MONGO_URI` | Destination MongoDB connection URI, with approved network access |
| `JWT_SECRET`, `ADMIN_TOTP_ENCRYPTION_KEY` | Environment-specific secrets; preserve the TOTP key on routine upgrades |
| `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY` | Destination Filebase credentials |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Destination Twilio Verify account and service |
| `REDIS_URL` | Reachable Redis endpoint; use TLS when required |
| `MALWARE_SCAN_AUTH_TOKEN` | Scanner credential if the scanner requires one |
| `FIREBASE_SERVICE_ACCOUNT` | JSON credential only when `FCM_ENABLED=true` |
| `API_DOCS_USERNAME`, `API_DOCS_PASSWORD` | Required if protected API documentation is enabled |
| `PAYMENT_PROVIDER_API_KEY`, `PAYMENT_WEBHOOK_SECRET` | When configuring payment integration |

MongoDB must connect before the server listens. Cloud Run outbound IP is not inherently fixed: arrange private connectivity or controlled egress if the database or scanner uses IP allowlists. `redis://redis:6379` from the Compose network is not a Cloud Run address. Confirm DNS, TLS, credentials, firewall rules and Redis connectivity from the destination environment. A workstation connection alone does not establish this.

## 7. Create the Cloud Run service

```text
 Cloud Run > Services > Create service
 +----------------------------------------------------------+
 | Deploy one revision from an existing container image      |
 | Image: destination repository / backend @ sha256:...     |
 | Service: vitalink-api    Region: chosen region           |
 | Container port: 3000     Identity: vitalink-runtime      |
 | Variables and secrets: map values from the tables below   |
 | Networking: approved ingress and outbound access          |
 | [Create]                                                 |
 +----------------------------------------------------------+
```

1. Select the destination project. Open **Cloud Run > Services > Create service** and choose an existing container image. Select the destination image **digest**. Set service name and region.
2. Under container settings set port **3000**. Leave command and arguments empty to use the image defaults. Do not manually set `PORT`; Cloud Run injects it.
3. Select the runtime service account. Under **Variables & Secrets**, reference each required Secret Manager secret using its environment variable name and explicit version. Add the ordinary values below.
4. Select networking that can reach the prepared dependencies. A Flutter browser calling Cloud Run directly needs an internet-accessible route and public Cloud Run invocation, with the application's own authentication and authorization still enforced. If your organization uses a gateway, configure and test its authentication and route instead. Do not expose a private-intended service merely to make this example work.
5. If reminders or notification processing must run continuously, configure **instance-based billing** and at least one minimum instance, then test behavior. The API starts in-process scheduled work and workers. Multiple revisions or instances can overlap; this setup does not guarantee exactly-once execution. Set scaling, CPU, memory and timeout according to measured limits.
6. Configure HTTP startup and liveness probes where supported: `/health/ready` and `/health/live`, respectively, on port 3000. A readiness response is not proof of external delivery or full clinical functionality. Create the revision and inspect its logs and status.

| Ordinary variable | Example or action |
| --- | --- |
| `NODE_ENV` | `production` or `staging` |
| `API_VERSION` | `v1` |
| `CORS_ALLOWED_ORIGINS` | Exact destination browser origin, e.g. `https://your-web.example` |
| `S3_BUCKET_NAME` | Destination Filebase bucket |
| `FILE_ASSET_LEGACY_CUTOFF_AT` | Approved ISO 8601 migration cutoff; coordinate existing data migration |
| `MALWARE_SCAN_ENABLED`, `MALWARE_SCAN_URL` | `true` and reachable HTTPS scanner URL |
| `FCM_ENABLED` | `false` unless Firebase is configured and tested |
| `NOTIFICATION_DELIVERY_ENABLED` | Enable only after Redis and delivery configuration are ready |
| `API_DOCS_ENABLED` | `false` unless protected docs are needed |
| `DOSAGE_REMINDER_TIMEZONE` | Approved IANA timezone, for example `Asia/Kolkata` |

Read `backend/.env.example` and `backend/src/config/index.ts` for other settings. Production/staging readiness checks include database, JWT, TOTP, Filebase, Twilio, cutoff and scanner configuration. Never use development mode to bypass a failed readiness check.

## 8. Build and connect the Flutter web client

Host `frontend/build/web` on an approved static hosting service. Flutter's API origin is compiled into the bundle. The frontend is not in the backend image. From `frontend/`, using the Flutter version pinned by the repository's CI:

```powershell
flutter pub get
flutter build web --release --dart-define=API_BASE_URL=https://REPLACE_WITH_CLOUD_RUN_HOST --dart-define=API_PATH_PREFIX=/api/v1
```

Publish the resulting `build/web` with the selected host's process. Add its exact HTTPS origin to `CORS_ALLOWED_ORIGINS`, deploy the revision, and rebuild the frontend if the API origin changes. Configure any custom domain, TLS, Firebase web configuration and routing required by that host. A copy of an old frontend bundle can still point to the original account.

## 9. Verify and record the release

```text
 Image digest matches --> Revision ready --> /health/live + /health/ready
                                                       |
                                  Browser CORS + sandbox workflows
                                                       |
                              Record evidence and approve handover
```

```powershell
$apiOrigin = 'https://REPLACE_WITH_CLOUD_RUN_HOST'
Invoke-RestMethod "$apiOrigin/health/live"
Invoke-RestMethod "$apiOrigin/health/ready"
Invoke-RestMethod "$apiOrigin/api/v1"
curl.exe -i -X OPTIONS "$apiOrigin/api/v1/auth/login" -H 'Origin: https://REPLACE_WITH_FRONTEND_HOST' -H 'Access-Control-Request-Method: POST'
```

Expect HTTP 200 on the first three requests. Inspect readiness for connected database, ready configuration and no missing variables. Expect a successful CORS preflight with the exact frontend origin and POST allowed. Then verify the frontend points to the destination API and run approved sandbox login, administrator MFA, authorization isolation, doctor and patient workflows, file scanning and storage, and any enabled notifications or payments. Check provider outcomes and audit records separately. Do not treat readiness or CORS alone as acceptance.

Record the project, region, image digest, source revision, Cloud Run revision, secret **version numbers**, service identity, frontend build, test results, backup and rollback contact. Never record secret values or patient data. Do not hand over if readiness, isolation or critical workflow checks fail.

## 10. Update, troubleshoot and roll back

For each update, build or copy a new image, record its digest, verify backup and schema compatibility, deploy a new revision and repeat the affected checks. Retain the prior revision and its configuration. Cloud Run **Revisions** and **Traffic** allow traffic to return to a prior working revision; a rollback does not undo database or storage writes, reverse migrations, or restore rotated secrets. Test recovery separately.

| Symptom | Check first |
| --- | --- |
| Image push denied | Active account, destination project, repository location, Docker helper and repository Writer grant |
| Image cannot be deployed | Digest, image architecture, Cloud Run service-agent access and organization policy |
| Container fails to start | Cloud Run logs, injected port, MongoDB connectivity and secret access |
| Readiness reports missing configuration | Missing variable names and secret mappings, then deploy a corrected revision |
| Browser blocked by CORS | Exact compiled API origin, frontend origin and preflight response |
| Reminders or notifications do not run | Instance billing/minimum instances, worker configuration, Redis and provider outcomes |
| Upload rejected | Scanner connectivity and response, Filebase credentials and sandbox permissions |

## Provider references

- [Deploy a container image to Cloud Run](https://cloud.google.com/run/docs/deploying)
- [Authenticate Docker to Artifact Registry](https://cloud.google.com/artifact-registry/docs/docker/authentication)
- [Push and pull Artifact Registry images](https://cloud.google.com/artifact-registry/docs/docker/pushing-and-pulling)
- [Configure Cloud Run secrets](https://cloud.google.com/run/docs/configuring/services/secrets)
