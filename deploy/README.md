# VitaLink EC2 Manual Deployment Guide

When CI/CD is not working, follow these steps to manually deploy and manage the service on EC2.

## SSH into EC2

```bash
ssh -i your-key.pem ubuntu@3.236.56.164
```

## Pull Latest Code and Redeploy (Zero Downtime)

```bash
cd /opt/vitalink
git pull origin main
cd deploy
./deploy.sh deploy
```

## Restart Without New Code (Quick Restart)

If the app is crashing and you just need to restart the current containers:

```bash
cd /opt/vitalink/deploy
docker compose restart app-blue   # or app-green, whichever is active
docker compose restart nginx
```

To check which slot is active:

```bash
./deploy.sh status
```

## Full Stop and Start (Nuclear Option)

If everything is broken:

```bash
cd /opt/vitalink/deploy

# Stop everything
docker compose down

# Start fresh with initial deployment
./deploy.sh initial
```

## Rollback to Previous Version

If the latest deploy broke something:

```bash
cd /opt/vitalink/deploy
./deploy.sh rollback
```

## View Logs

```bash
# App logs (use whichever slot is active)
docker logs -f vitalink-blue
docker logs -f vitalink-green

# Nginx logs
docker logs -f vitalink-nginx

# Last 100 lines only
docker logs --tail 100 vitalink-blue
```

## Rebuild From Scratch

If Docker images are corrupted or you need a clean build:

```bash
cd /opt/vitalink/deploy

docker compose down
docker system prune -af        # WARNING: removes all unused images
./deploy.sh initial
```

## Edit Environment Variables

```bash
nano /opt/vitalink/deploy/.env.production

# Then redeploy to pick up changes
./deploy.sh deploy
```

## Health Check

```bash
# Check if the API is responding
curl http://localhost/health/ready

# Check container health status
docker ps --format "table {{.Names}}\t{{.Status}}"
```

## Run Database Scripts in Production

```bash
# Seed admin user (run inside the active container)
docker exec vitalink-blue node build/src/scripts/createAdminUser.js

# Run migrations
docker exec vitalink-blue node build/src/scripts/migrateAssignedDoctorIds.js
docker exec vitalink-blue node build/src/scripts/backfillPatientHospitalIds.js --dry-run
# After reviewing the summary, apply the hospital IDs:
docker exec vitalink-blue node build/src/scripts/backfillPatientHospitalIds.js --execute
docker exec vitalink-blue node build/src/scripts/migrateInrCriticalFlags.js

# Required after every upgrade and on greenfield (first deploy of this code):
# Auth schema defaults + challenge retention indexes. Formerly ran on every
# boot; now intentional so multi-instance deploys do not race index repairs.
# Run once per environment (idempotent, safe to re-run) BEFORE relying on
# login/OTP/admin MFA — generation fields must exist for exact-match auth
# predicates, and this script also creates the partial unique index
# one_pending_admin_mfa_challenge_per_user (not created by schema auto-index).
docker exec vitalink-blue node build/src/scripts/migrateAuthSchemaDefaults.js
```

Replace `vitalink-blue` with `vitalink-green` if green is the active slot.
