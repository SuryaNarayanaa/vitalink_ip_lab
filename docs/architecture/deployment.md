# Deployment architecture

## Standalone backend with MongoDB Atlas

`backend/compose.yaml` defines one backend container built from `backend/Dockerfile` and one `redis:7-alpine` container. The backend reads the ignored `backend/.env.docker` at runtime, binds host localhost port 3000 (or `BACKEND_HOST_PORT`) to container port 3000, and connects to MongoDB Atlas through `MONGO_URI`. Compose overrides `REDIS_URL` with `redis://redis:6379` and starts the backend only after Redis is healthy. Redis has no published host port and persists append-only state in the `redis-data` named volume. The frontend and provider services remain outside this stack. Notification delivery defaults on in the starter configuration; FCM defaults off until credentials are provided.

The shared backend image uses Node 24 Alpine, production npm dependencies, a non-root user, direct Node startup, and a readiness healthcheck. Standalone Compose adds an init process and a 30-second graceful-stop window. Upgrading the single backend instance has downtime and no blue-green rollback slot. Follow the [backend Docker runbook](../operations/backend-docker-runbook.md) and [ADR-0012](../decisions/0012-containerized-redis-for-standalone-backend.md). An Atlas ping succeeded from the local host; actual container connectivity and rollout remain unverified.

```mermaid
flowchart LR
    Client["Separately running frontend / host client"] --> API["Backend container<br/>localhost :3000 mapping"]
    API --> Atlas["Hosted MongoDB Atlas"]
    API --> Redis["Redis container :6379<br/>no host port"]
    Redis --> Volume["redis-data named volume<br/>append-only persistence"]
```

## Checked-in EC2/Docker design

```mermaid
flowchart LR
    Users["Flutter web/mobile clients"] --> Edge["Nginx container :80/:443 mapping"]
    Edge --> Active{"upstream.conf active slot"}
    Active --> Blue["Express API blue :3000"]
    Active -. switch .-> Green["Express API green :3000"]
    Blue --> Mongo["Configured MongoDB"]
    Green --> Mongo
    Blue --> Redis["Redis 7 persistent volume"]
    Green --> Redis
    Blue --> External["Twilio, Filebase, Firebase, payment, scanner, Loki"]
    Green --> External
```

Docker Compose defines `redis`, `app-blue`, `app-green`, and `nginx` on one bridge network. The deploy script builds the inactive application slot, waits for `/health/ready`, rewrites `upstream.conf`, validates and reloads Nginx, then stops the former active slot. Rollback performs the inverse switch after health validation.

## Health model

| Probe | Meaning | Used by |
| --- | --- | --- |
| `/` | HTTP process/API index only | Manual API inspection |
| `/health/live` | Express process is live | Manual/environment guidance |
| `/health/ready` | MongoDB, Firebase state, worker state, and required configuration are ready | Backend Dockerfile healthcheck, both Compose paths, deployment verification, runbooks |
| `/nginx-health` | Nginx process responds | Edge/load-balancer candidate |

## Transport status

The active Nginx server block listens on port 80. The HTTP-to-HTTPS redirect and TLS server block are commented templates. Docker publishes 443 and mounts a certificate directory, but those facts do not enable TLS by themselves. Production TLS termination must therefore be confirmed at Nginx or an upstream load balancer before treating the EC2 design as secure.

## Other tracked delivery paths

- `backend-cd.yml` deploys the backend to an EC2 host through SSH.
- `deploy_web.yml` publishes Flutter web to GitHub Pages.
- `frontend/vercel.json` supports Vercel static hosting and proxies `/api/*` to the Render hostname.
- The existing `vitalinkwebapp` Vercel project is connected to GitHub and tracks `main` for Production. Its dashboard builds `frontend` with Flutter 3.44.8 into `build/web`, explicitly compiling the user-selected Cloud Run API origin. See the [Vercel runbook](../operations/deployment-runbook.md#vercel-web-deployments-from-github) and [ADR-0014](../decisions/0014-vercel-github-web-deployments.md). This records web delivery configuration, not authenticated application acceptance.
- Flutter mobile source and APK CI default to or explicitly build against the same Render hostname.

No checked-in record establishes which combination is currently production. See [Inconsistencies](../reference/inconsistencies.md).

## External configuration boundary

MongoDB, object storage, Twilio, Firebase credentials, payment provider, scanner, Loki, secrets, CORS origins, and client API origin are supplied outside source. Deployment diagrams show these as dependencies, not as verified provider accounts or regions.
