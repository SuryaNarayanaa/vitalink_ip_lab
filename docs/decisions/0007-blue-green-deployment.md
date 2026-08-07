# ADR-0007: Use blue-green API slots behind Nginx for the checked-in EC2 path

## Status

Accepted for the repository-defined EC2 deployment path. Live adoption is unverified.

## Context and Problem Statement

An API upgrade should be health-checked before receiving traffic and should preserve a rollback slot when a new container is unhealthy.

## Decision Drivers

- Minimize API downtime during image rebuild/restart.
- Health-gated traffic switch.
- Simple single-host operational model.
- Scripted rollback.

## Considered Options

- Replace one application container in place.
- Run blue and green application slots behind Nginx.
- Adopt an orchestrator-managed rolling/canary deployment.

## Decision Outcome

Chosen option: Docker Compose defines blue and green Express containers, Redis, and Nginx. `deploy.sh` builds the inactive slot, waits for readiness, rewrites/validates/reloads Nginx, stops the old slot, and records active state. Rollback reverses the slots.

### Consequences

- Good: unhealthy new containers do not receive traffic.
- Good: rollback is a documented command.
- Bad: one EC2 host and one Nginx container remain infrastructure failure domains.
- Bad: database/config migrations are outside the slot switch and can block safe rollback.
- Bad: TLS is only a commented template in checked-in Nginx configuration.
- Bad: frontend Render/Vercel/GitHub Pages references make the live topology ambiguous.

## Links

- `deploy/docker-compose.yml`
- `deploy/deploy.sh`
- [Deployment architecture](../architecture/deployment.md)
