#!/usr/bin/env bash
# On-box deploy for the EC2 + docker-compose target. Runs ON the EC2 instance (invoked by
# CI via SSM Run Command). The instance profile grants: read the app secret, pull from ECR.
#
# Required env (exported by the caller / sourced from /opt/telestar/deploy.env):
#   AWS_REGION   e.g. ap-southeast-1
#   SECRET_ID    Secrets Manager id/ARN of the JSON env bundle (e.g. telestar/prod/env)
#   APP_IMAGE    full ECR image ref to run, e.g. 1234.dkr.ecr.ap-southeast-1.amazonaws.com/telestar-v2:<sha>
#   APP_DOMAIN   public hostname Caddy serves + gets a cert for (e.g. 13-250-1-2.sslip.io)
# Optional:
#   COMPOSE_DIR  dir holding docker-compose.yml + Caddyfile (default: this script's dir)
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${SECRET_ID:?SECRET_ID is required}"
: "${APP_IMAGE:?APP_IMAGE is required}"
: "${APP_DOMAIN:?APP_DOMAIN is required}"

COMPOSE_DIR="${COMPOSE_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$COMPOSE_DIR"

log() { printf '\n[deploy] %s\n' "$*"; }

# 1) Render .env.production from Secrets Manager (JSON object of key -> value). Never logged.
log "Fetching app env from Secrets Manager ($SECRET_ID)..."
aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$SECRET_ID" \
  --query SecretString --output text \
  | jq -r 'to_entries[] | "\(.key)=\(.value)"' > .env.production
chmod 600 .env.production
log "Wrote .env.production ($(wc -l < .env.production) vars)."

# 2) Compose interpolation vars (image + domain). Separate from .env.production (runtime env).
cat > .env <<EOF
APP_IMAGE=$APP_IMAGE
APP_DOMAIN=$APP_DOMAIN
EOF

# 3) Log in to ECR (registry = everything before the first "/").
REGISTRY="${APP_IMAGE%%/*}"
log "Logging in to ECR ($REGISTRY)..."
aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$REGISTRY"

# 4) Pull the pinned image for every service.
log "Pulling $APP_IMAGE ..."
docker compose pull

# 5) Migrate FIRST (one-shot, fails the deploy on error) — schema current before traffic.
log "Running prisma migrate deploy..."
docker compose run --rm migrate

# 6) Roll the long-running services.
log "Starting web, worker, imap, caddy..."
docker compose up -d --remove-orphans web worker imap caddy

# 7) Health gate: wait for the public HTTPS endpoint to report DB-ok.
log "Waiting for https://$APP_DOMAIN/api/health ..."
for i in $(seq 1 30); do
  if curl -fsS --max-time 5 "https://$APP_DOMAIN/api/health" | grep -q '"database":"ok"'; then
    log "Healthy. Deploy of $APP_IMAGE complete."
    docker image prune -f >/dev/null 2>&1 || true
    exit 0
  fi
  sleep 5
done

log "ERROR: health check did not pass in time. Recent web logs:"
docker compose logs --tail=50 web caddy || true
exit 1
