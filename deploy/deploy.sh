#!/usr/bin/env bash
# =============================================================================
# VitaLink Blue-Green Zero-Downtime Deployment Script
# =============================================================================
# Usage:
#   ./deploy.sh              # Deploy latest code with zero downtime
#   ./deploy.sh rollback     # Rollback to the previous slot
#   ./deploy.sh status       # Show current active slot
# =============================================================================

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$DEPLOY_DIR/docker-compose.yml"
UPSTREAM_CONF="$DEPLOY_DIR/nginx/conf.d/upstream.conf"
STATE_FILE="$DEPLOY_DIR/.active-slot"
HEALTH_RETRIES=30
HEALTH_INTERVAL=2

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()  { echo -e "${GREEN}[DEPLOY]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
get_active_slot() {
    if [[ -f "$STATE_FILE" ]]; then
        cat "$STATE_FILE"
    else
        # Default: blue is active on first deploy
        echo "blue"
    fi
}

get_inactive_slot() {
    local active
    active=$(get_active_slot)
    if [[ "$active" == "blue" ]]; then
        echo "green"
    else
        echo "blue"
    fi
}

get_container_name() {
    echo "vitalink-$1"
}

validate_production_env() {
    local env_file="$DEPLOY_DIR/.env.production"
    local jwt_secret

    # Preserve the existing environment-file preflight.
    if [[ ! -f "$env_file" ]]; then
        err ".env.production not found in $DEPLOY_DIR"
        err "Copy .env.example and fill in production values:"
        err "  cp $DEPLOY_DIR/.env.production.example $env_file"
        exit 1
    fi

    jwt_secret=$(sed -n 's/^[[:space:]]*JWT_SECRET[[:space:]]*=[[:space:]]*//p' "$env_file" | tail -n 1)
    jwt_secret=${jwt_secret%$'\r'}

    # Accept conventional quoted dotenv values without treating the file as shell code.
    if [[ ${#jwt_secret} -ge 2 ]]; then
        if [[ "$jwt_secret" == \"*\" && "$jwt_secret" == *\" ]] ||
           [[ "$jwt_secret" == \'*\' && "$jwt_secret" == *\' ]]; then
            jwt_secret=${jwt_secret:1:${#jwt_secret}-2}
        fi
    fi

    if [[ -z "$jwt_secret" ]]; then
        err "JWT_SECRET is missing or empty in $env_file."
        err "Set JWT_SECRET to a strong random secret of at least 32 characters."
        exit 1
    fi

    if [[ "$jwt_secret" == "CHANGE_ME_TO_A_STRONG_RANDOM_SECRET" ]]; then
        err "JWT_SECRET in $env_file still uses the example placeholder."
        err "Replace it with a strong random secret of at least 32 characters."
        exit 1
    fi

    if (( ${#jwt_secret} < 32 )); then
        err "JWT_SECRET in $env_file is too short (${#jwt_secret} characters)."
        err "JWT_SECRET must be a strong random secret of at least 32 characters."
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Health check: wait for container to become healthy
# ---------------------------------------------------------------------------
wait_for_healthy() {
    local slot="$1"
    local container
    container=$(get_container_name "$slot")

    log "Waiting for $container to become healthy..."

    for i in $(seq 1 "$HEALTH_RETRIES"); do
        # Check Docker health status
        local health
        health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "not_found")

        if [[ "$health" == "healthy" ]]; then
            log "$container is healthy! (attempt $i/$HEALTH_RETRIES)"
            return 0
        fi

        echo -n "."
        sleep "$HEALTH_INTERVAL"
    done

    echo ""
    err "$container failed to become healthy after $((HEALTH_RETRIES * HEALTH_INTERVAL))s"
    err "Last health status: $health"
    docker logs --tail 30 "$container" 2>&1 || true
    return 1
}

# ---------------------------------------------------------------------------
# Switch Nginx upstream to target slot
# ---------------------------------------------------------------------------
switch_upstream() {
    local target_slot="$1"
    local target_container
    target_container=$(get_container_name "$target_slot")

    log "Switching Nginx upstream to $target_container..."

    cat > "$UPSTREAM_CONF" <<EOF
# Active upstream - managed by deploy.sh
# Switched to $target_slot at $(date -u +"%Y-%m-%dT%H:%M:%SZ")
upstream vitalink_backend {
    server ${target_container}:3000;
}
EOF

    # Reload Nginx without dropping connections
    docker exec vitalink-nginx nginx -t 2>&1 || {
        err "Nginx config test failed! Aborting switch."
        return 1
    }

    docker exec vitalink-nginx nginx -s reload
    log "Nginx reloaded. Traffic now routed to $target_slot."

    # Save active slot
    echo "$target_slot" > "$STATE_FILE"
}

# ---------------------------------------------------------------------------
# Build and start a specific slot
# ---------------------------------------------------------------------------
start_slot() {
    local slot="$1"
    local service="app-$slot"

    log "Building and starting $service..."
    docker compose -f "$COMPOSE_FILE" build "$service"
    docker compose -f "$COMPOSE_FILE" up -d --no-deps --force-recreate "$service"
}

# ---------------------------------------------------------------------------
# Stop a specific slot (gracefully)
# ---------------------------------------------------------------------------
stop_slot() {
    local slot="$1"
    local service="app-$slot"
    local container
    container=$(get_container_name "$slot")

    # Give existing connections time to drain
    log "Draining connections from $container (5s grace period)..."
    sleep 5

    log "Stopping $service..."
    docker compose -f "$COMPOSE_FILE" stop "$service" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# DEPLOY: Blue-Green zero-downtime deployment
# ---------------------------------------------------------------------------
deploy() {
    local active inactive

    validate_production_env

    active=$(get_active_slot)
    inactive=$(get_inactive_slot)

    log "============================================="
    log "  VitaLink Blue-Green Deployment"
    log "============================================="
    log "  Active slot:   ${BLUE}$active${NC}"
    log "  Deploying to:  ${GREEN}$inactive${NC}"
    log "============================================="

    # Ensure nginx is running
    if ! docker ps --format '{{.Names}}' | grep -q "vitalink-nginx"; then
        log "Starting Nginx..."
        docker compose -f "$COMPOSE_FILE" up -d nginx
        sleep 2
    fi

    # Step 1: Build and start the inactive slot with new code
    start_slot "$inactive"

    # Step 2: Wait for it to pass health checks
    if ! wait_for_healthy "$inactive"; then
        err "Deployment FAILED. New container is unhealthy."
        err "Stopping failed container..."
        stop_slot "$inactive"
        err "Active slot ($active) remains unchanged. No downtime occurred."
        exit 1
    fi

    # Step 3: Switch Nginx to the new (previously inactive) slot
    switch_upstream "$inactive"

    # Step 4: Stop the old (previously active) slot
    stop_slot "$active"

    log ""
    log "============================================="
    log "  Deployment SUCCESSFUL"
    log "  Active slot: ${GREEN}$inactive${NC}"
    log "  Previous slot ($active) stopped."
    log "============================================="
}

# ---------------------------------------------------------------------------
# ROLLBACK: Switch back to the previous slot
# ---------------------------------------------------------------------------
rollback() {
    local active inactive
    active=$(get_active_slot)
    inactive=$(get_inactive_slot)

    log "============================================="
    log "  VitaLink Rollback"
    log "============================================="
    log "  Current slot:    ${BLUE}$active${NC}"
    log "  Rolling back to: ${YELLOW}$inactive${NC}"
    log "============================================="

    # Start the old slot
    local container
    container=$(get_container_name "$inactive")

    # Check if the old container still exists and can be started
    if docker ps -a --format '{{.Names}}' | grep -q "$container"; then
        log "Starting previous container $container..."
        docker start "$container"
    else
        log "Previous container not found. Rebuilding $inactive..."
        start_slot "$inactive"
    fi

    # Wait for it to be healthy
    if ! wait_for_healthy "$inactive"; then
        err "Rollback FAILED. Previous container is unhealthy."
        err "Current slot ($active) remains active."
        exit 1
    fi

    # Switch traffic
    switch_upstream "$inactive"

    # Stop the current (broken) slot
    stop_slot "$active"

    log ""
    log "============================================="
    log "  Rollback SUCCESSFUL"
    log "  Active slot: ${GREEN}$inactive${NC}"
    log "============================================="
}

# ---------------------------------------------------------------------------
# STATUS: Show current state
# ---------------------------------------------------------------------------
status() {
    local active
    active=$(get_active_slot)

    echo ""
    log "Active slot: ${GREEN}$active${NC}"
    echo ""
    echo "Container status:"
    docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" \
        --filter "name=vitalink-" 2>/dev/null || echo "  No containers running"
    echo ""
}

# ---------------------------------------------------------------------------
# INITIAL: First-time deployment (starts both Nginx and active slot)
# ---------------------------------------------------------------------------
initial() {
    log "============================================="
    log "  VitaLink Initial Deployment"
    log "============================================="

    validate_production_env

    # Create required directories
    mkdir -p "$DEPLOY_DIR/nginx/certs"
    mkdir -p "$DEPLOY_DIR/nginx/html"

    # Build and start blue slot + nginx
    log "Building application..."
    docker compose -f "$COMPOSE_FILE" build app-blue

    log "Starting blue slot and Nginx..."
    docker compose -f "$COMPOSE_FILE" up -d app-blue nginx

    # Wait for health
    if wait_for_healthy "blue"; then
        echo "blue" > "$STATE_FILE"
        log ""
        log "============================================="
        log "  Initial deployment SUCCESSFUL"
        log "  Active slot: ${GREEN}blue${NC}"
        log "  Server running on port 80"
        log "============================================="
    else
        err "Initial deployment FAILED. Check logs:"
        err "  docker logs vitalink-blue"
        exit 1
    fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "${1:-deploy}" in
    deploy)
        deploy
        ;;
    rollback)
        rollback
        ;;
    status)
        status
        ;;
    initial)
        initial
        ;;
    *)
        echo "Usage: $0 {deploy|rollback|status|initial}"
        exit 1
        ;;
esac
