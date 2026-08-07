# Rollback runbook

## Application rollback

Check current state first:

```bash
cd /opt/vitalink/deploy
sudo ./deploy.sh status
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Switch to the other slot:

```bash
sudo ./deploy.sh rollback
sudo ./deploy.sh status
curl -fsS http://localhost/health/ready
```

The script starts or rebuilds the inactive/previous slot if needed, waits for its healthcheck, switches the Nginx upstream, and stops the former active slot. If the rollback candidate is unhealthy, the current slot remains active.

## Automatic CD behavior

Backend CD checks `http://localhost/health/ready` after deployment. A non-200 result runs `deploy.sh rollback`. Its failure-notification step checks health again and attempts rollback only when the service is still unhealthy.

## Database compatibility checkpoint

Code rollback does not reverse database migrations. Before switching:

1. Identify migrations executed for the release.
2. Confirm the previous code can read the new document/index shape.
3. If not, stop. Use the incident process and a migration-specific reverse or restore plan.
4. Never improvise destructive MongoDB updates during an incident without an approved query, verified target database, backup/restore point, dry run, and second reviewer.

## Configuration rollback

Restoring a prior image does not restore `deploy/.env.production`, provider configuration, Flutter compile-time API origin, MongoDB data, Redis data, or object storage. Revert these separately only when the exact prior value and impact are known. Secret exposure requires rotation, not merely reusing the previous file.

## Verify rollback

- Public and local liveness/readiness succeed.
- Active slot and Nginx upstream agree.
- Affected role smoke paths work.
- No new cross-tenant, authentication, audit, file, queue, or payment errors appear.
- Notification backlog is stable or draining.
- The incident timeline records the rolled-back commit and any data/config changes that remain.
