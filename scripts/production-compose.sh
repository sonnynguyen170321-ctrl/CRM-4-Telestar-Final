#!/usr/bin/env bash
#
# Resolve the canonical Docker Compose flags based on DEPLOY_TARGET.
#
# Usage:
#   # In bash scripts:
#   COMPOSE_FLAGS="$(./scripts/production-compose.sh [env-file])"
#   # Or evaluate directly:
#   docker compose $(./scripts/production-compose.sh) config
#
# Contract:
#   DEPLOY_TARGET=gcp         -> -f docker-compose.yml -f docker-compose.gcp.yml
#   DEPLOY_TARGET=self-hosted -> -f docker-compose.yml
#   anything else / missing   -> FAIL with actionable error

set -euo pipefail

ENV_FILE="${1:-${ENV_FILE:-.env.production}}"

# If DEPLOY_TARGET is not already exported in the ambient environment, read from env file
if [ -z "${DEPLOY_TARGET:-}" ] && [ -f "$ENV_FILE" ]; then
  DEPLOY_TARGET=$(grep -E '^[[:space:]]*DEPLOY_TARGET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "'\" " || true)
fi

DEPLOY_TARGET="${DEPLOY_TARGET:-}"

case "$DEPLOY_TARGET" in
  gcp)
    printf '%s' "-f docker-compose.yml -f docker-compose.gcp.yml"
    ;;
  self-hosted)
    printf '%s' "-f docker-compose.yml"
    ;;
  "")
    printf '\n\033[31mERROR: DEPLOY_TARGET is not set.\033[0m\n' >&2
    printf 'Set DEPLOY_TARGET=gcp (for Cloud SQL GCP production) or DEPLOY_TARGET=self-hosted in %s or environment.\n' "$ENV_FILE" >&2
    exit 1
    ;;
  *)
    printf '\n\033[31mERROR: Unknown DEPLOY_TARGET="%s".\033[0m\n' "$DEPLOY_TARGET" >&2
    printf 'Valid options are "gcp" or "self-hosted".\n' >&2
    exit 1
    ;;
esac
