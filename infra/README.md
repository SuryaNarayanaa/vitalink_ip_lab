# VitaLink infrastructure

Start here to choose a deployment path and find its operating instructions. The repository keeps the backend image and Compose definitions alongside the application code. Provider dashboards and release records identify the active environment.

## Deployment paths

| Path | How it runs | Runbook |
| --- | --- | --- |
| Backend and Redis with MongoDB Atlas | [`backend/compose.yaml`](../backend/compose.yaml) runs one API container and one Redis container. The API port binds to loopback, and MongoDB runs on Atlas. | [Backend Docker runbook](../docs/operations/backend-docker-runbook.md) |
| EC2 with Docker Compose | [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) defines Redis, Nginx, and blue and green API slots. [`deploy.sh`](../deploy/deploy.sh) waits for the candidate slot to become healthy before switching the Nginx upstream. | [Deployment runbook](../docs/operations/deployment-runbook.md#preconditions) and [rollback runbook](../docs/operations/rollback-runbook.md) |
| Cloud Run API and Vercel web | Cloud Run uses the [backend Dockerfile](../backend/Dockerfile) with `backend/` as its build context. The Vercel build compiles the API origin into the Flutter app. | [Cloud Run manual](../docs/operations/gcp-deployment-manual.md), [Docker image tutorial](../docs/operations/gcp-docker-image-tutorial.md), and [Vercel build settings](../docs/operations/deployment-runbook.md#vercel-web-deployments-from-github) |
| GitHub Pages | The [Pages workflow](../.github/workflows/deploy_web.yml) builds Flutter web and publishes the MkDocs site under `/docs/` within the Pages artifact. | [CI/CD documentation](../docs/architecture/ci-cd.md) |

## Configuration and release checks

Use [`backend/.env.example`](../backend/.env.example) as the variable inventory. The Atlas Compose stack loads `backend/.env.docker`. The EC2 stack loads `deploy/.env.production`. For Cloud Run, follow the [Secret Manager setup](../docs/operations/gcp-deployment-manual.md#create-and-map-secrets). Keep populated environment files and provider credentials out of Git.

The backend connects to MongoDB and uses Redis for shared coordination and notification jobs. Configure S3-compatible file storage, Twilio Verify, Firebase Cloud Messaging, and the upload scanner as required by the target environment. Set the Flutter build's `API_BASE_URL` to the intended API origin, and include the web client's origin in the backend's `CORS_ALLOWED_ORIGINS`. See the [environment guide](../docs/environments.md).

Check `/health/live` for the HTTP process and `/health/ready` for dependency and runtime configuration status. The [migration checkpoint](../docs/operations/deployment-runbook.md#migration-checkpoint) covers database scripts, which operators run separately. Before handing over a release, check the public endpoint and exercise the affected roles with authorized test accounts. Use the [post-deploy checklist](../docs/operations/deployment-runbook.md#post-deploy-verification) to record the results.

The [EC2 workflow](../.github/workflows/backend-cd.yml) runs backend checks before the SSH deployment job and requires the `EC2_HOST`, `EC2_USER`, and `EC2_SSH_KEY` secrets to deploy. Check Cloud Build and Vercel trigger settings in their respective dashboards. The [open questions register](../docs/reference/open-questions.md) tracks outstanding deployment verification.

## AWS migration plan

The [AWS migration plan](../docs/AWS_MIGRATION_IMPLEMENTATION_PLAN.md) proposes CloudFormation stacks for networking, IAM, storage, compute, messaging, monitoring, and backups. CloudFormation templates and the proposed SSM deployment path are pending implementation. Use the EC2 runbook above for the current Compose and SSH path.
