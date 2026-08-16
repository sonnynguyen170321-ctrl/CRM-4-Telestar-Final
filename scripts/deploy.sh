#!/usr/bin/env bash
#
# Deploy an exact image to the live box, by digest, and record what happened.
#
# Run from the deployment root (/opt/crm-4-u) on the VM:
#
#     ./scripts/deploy.sh                 # deploy the image built for HEAD
#     ./scripts/deploy.sh <full-git-sha>  # deploy a specific commit's image
#
# What this exists to prevent: deploying mutable tags like `:latest` with `docker compose up -d`
# is not a deployment, it is a lottery. The tag can move between the pull and the restart, web and
# worker can end up on different content, and nothing anywhere records which bytes are
# serving traffic. This script resolves the tag to a digest ONCE, deploys that digest to
# both services, verifies them, and appends an immutable record.
#
# It never rebuilds. The image comes from GHCR, published only after CI passed.

set -euo pipefail

REGISTRY="ghcr.io"
IMAGE_NAME="sonnynguyen170321-ctrl/crm-4-telestar-final"
ENV_FILE="${ENV_FILE:-.env.production}"
RECORD_FILE="${RECORD_FILE:-deployments.ndjson}"
DOCKER="${DOCKER:-sudo docker}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found. Run this from the deployment root."

# ── Resolve canonical topology from single authority ───────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILES="${COMPOSE_FILES:-$("${SCRIPT_DIR}/production-compose.sh" "$ENV_FILE")}"
DEPLOY_TARGET=$(grep -E '^[[:space:]]*DEPLOY_TARGET=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"' | tr -d '[:space:]' || echo "gcp")

COMMIT="${1:-$(git rev-parse HEAD)}"
if ! printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  fail "Expected a full 40-character commit SHA, got: $COMMIT"
fi

# ── 1. Resolve the tag to a digest, once ────────────────────────────────────
# Everything downstream uses the digest. If the tag moves after this line, it changes
# nothing about what gets deployed.
log "Resolving ${IMAGE_NAME}:${COMMIT} to a digest"
$DOCKER pull "${REGISTRY}/${IMAGE_NAME}:${COMMIT}" \
  || fail "No image published for commit ${COMMIT}. CI publishes only after it passes — check the run."

DIGEST=$($DOCKER inspect --format '{{index .RepoDigests 0}}' "${REGISTRY}/${IMAGE_NAME}:${COMMIT}" \
  | sed 's/.*@//')
printf '%s' "$DIGEST" | grep -Eq '^sha256:[0-9a-f]{64}$' \
  || fail "Could not resolve a digest for ${COMMIT} (got: ${DIGEST})"

NEW_IMAGE="${REGISTRY}/${IMAGE_NAME}@${DIGEST}"
PREVIOUS_IMAGE=$(grep -E '^CRM_IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)

echo "  target   : ${DEPLOY_TARGET}"
echo "  compose  : ${COMPOSE_FILES}"
echo "  previous : ${PREVIOUS_IMAGE:-<none>}"
echo "  new      : ${NEW_IMAGE}"

if [ "$NEW_IMAGE" = "$PREVIOUS_IMAGE" ]; then
  log "Already running this digest. Nothing to do."
  exit 0
fi

# ── 2. Back up before any migration ─────────────────────────────────────────
BACKUP_ID="${DEPLOY_BACKUP_ID:-$(grep -E '^DEPLOY_BACKUP_ID=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)}"
BACKUP_AT="${DEPLOY_BACKUP_AT:-$(grep -E '^DEPLOY_BACKUP_AT=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)}"

if [ -z "$BACKUP_ID" ]; then
  cat <<'REMINDER'

  Operating restrictions require a pre-deploy backup.
  Create one from Cloud Shell:

      gcloud sql backups create --instance=telestar-db --project=telestar-crm-final

REMINDER
  read -r -p "  Enter Cloud SQL Backup ID: " BACKUP_ID
  [ -n "$BACKUP_ID" ] || fail "Aborted. Backup ID is required."
  BACKUP_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi

DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

# ── 3. Migrate, using the NEW image ─────────────────────────────────────────
# CRM_IMAGE is exported for this command so the one-off container is the same build that
# is about to serve traffic.
TOTAL_MIGRATIONS=$(ls -1 prisma/migrations | grep -E '^[0-9]{14}_' | wc -l | tr -d ' ')
MIGRATION_LATEST=$(ls -1 prisma/migrations | grep -E '^[0-9]{14}_' | tail -1)

log "Pending migrations"
CRM_IMAGE="$NEW_IMAGE" $DC run --rm --no-deps web \
  node node_modules/prisma/build/index.js migrate status || true

log "Applying migrations"
CRM_IMAGE="$NEW_IMAGE" $DC run --rm --no-deps web \
  node node_modules/prisma/build/index.js migrate deploy

# ── 4. Write the digest into the env file, keeping the one it replaces ──────
log "Pinning ${ENV_FILE} to the new digest"
cp "$ENV_FILE" "${ENV_FILE}.bak"
grep -v -E '^(CRM_IMAGE|PREVIOUS_CRM_IMAGE)=' "${ENV_FILE}.bak" > "$ENV_FILE"
{
  echo "CRM_IMAGE=${NEW_IMAGE}"
  echo "PREVIOUS_CRM_IMAGE=${PREVIOUS_IMAGE}"
} >> "$ENV_FILE"

# ── 5. Swap the containers ──────────────────────────────────────────────────
# Recreate web and worker with new image digest
log "Starting web and worker on the new digest"
$DC up -d --no-deps web worker
$DC ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

# ── 6. Prove it ─────────────────────────────────────────────────────────────
log "Post-deploy smoke test"
if ! DEPLOYED_COMMIT="$COMMIT" DOCKER="$DOCKER" ENV_FILE="$ENV_FILE" \
     COMPOSE_FILES="$COMPOSE_FILES" ./scripts/post-deploy-smoke.sh; then
  fail "Smoke test failed. The previous digest is in ${ENV_FILE} as PREVIOUS_CRM_IMAGE — roll back with ./scripts/rollback.sh"
fi

# ── 7. Record it ────────────────────────────────────────────────────────────
# Append-only structured record in deployments.ndjson
log "Recording the deployment in ${RECORD_FILE}"
if command -v python3 >/dev/null 2>&1; then
  python3 -c '
import sys, json, datetime
commit, digest, image, previous, migration, target, backupId, backupAt, totalMigrations, operator = sys.argv[1:]
entry = {
    "deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "commit": commit,
    "digest": digest,
    "image": image,
    "previousImage": previous if previous else None,
    "deployTarget": target,
    "backupId": backupId if backupId else None,
    "backupAt": backupAt if backupAt else None,
    "totalMigrations": int(totalMigrations) if totalMigrations.isdigit() else 0,
    "latestMigration": migration,
    "operator": operator
}
print(json.dumps(entry))
' "$COMMIT" "$DIGEST" "$NEW_IMAGE" "$PREVIOUS_IMAGE" "$MIGRATION_LATEST" "$DEPLOY_TARGET" "$BACKUP_ID" "$BACKUP_AT" "$TOTAL_MIGRATIONS" "$(whoami)@$(hostname)" \
    >> "$RECORD_FILE"
elif command -v node >/dev/null 2>&1; then
  node -e '
    const [commit, digest, image, previous, migration, target, backupId, backupAt, totalMigrations, operator] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({
      deployedAt: new Date().toISOString(),
      commit, digest, image, previousImage: previous || null, deployTarget: target,
      backupId: backupId || null, backupAt: backupAt || null,
      totalMigrations: parseInt(totalMigrations, 10) || 0, latestMigration: migration, operator
    }) + "\n");
  ' "$COMMIT" "$DIGEST" "$NEW_IMAGE" "$PREVIOUS_IMAGE" "$MIGRATION_LATEST" "$DEPLOY_TARGET" "$BACKUP_ID" "$BACKUP_AT" "$TOTAL_MIGRATIONS" "$(whoami)@$(hostname)" \
    >> "$RECORD_FILE"
fi

tail -1 "$RECORD_FILE"
log "Successfully deployed ${COMMIT} (${DIGEST})"
