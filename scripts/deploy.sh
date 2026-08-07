#!/usr/bin/env bash
#
# Deploy an exact image to the live box, by digest, and record what happened.
#
# Run from the deployment root (/opt/crm-4-u) on the VM:
#
#     ./scripts/deploy.sh                 # deploy the image built for HEAD
#     ./scripts/deploy.sh <full-git-sha>  # deploy a specific commit's image
#
# What this exists to prevent: `IMAGE_TAG=latest` plus `docker compose up -d` is not a
# deployment, it is a lottery. The tag can move between the pull and the restart, web and
# worker can end up on different content, and nothing anywhere records which bytes are
# serving traffic. This script resolves the tag to a digest ONCE, deploys that digest to
# both services, verifies them, and appends an immutable record.
#
# It never rebuilds. The image comes from GHCR, published only after CI passed.

set -euo pipefail

REGISTRY="ghcr.io"
IMAGE_NAME="sonnynguyen170321-ctrl/crm-4-telestar-final"
ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml -f docker-compose.aws.yml}"
RECORD_FILE="${RECORD_FILE:-deployments.ndjson}"
DOCKER="${DOCKER:-sudo docker}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found. Run this from the deployment root."

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

echo "  previous : ${PREVIOUS_IMAGE:-<none>}"
echo "  new      : ${NEW_IMAGE}"

if [ "$NEW_IMAGE" = "$PREVIOUS_IMAGE" ]; then
  log "Already running this digest. Nothing to do."
  exit 0
fi

# ── 2. Back up before any migration ─────────────────────────────────────────
cat <<'REMINDER'

  The operating restrictions require a manual Cloud SQL backup before every migration.
  Run this from Cloud Shell, NOT the VM — the VM's service account lacks the sqladmin
  scope and fails with ACCESS_TOKEN_SCOPE_INSUFFICIENT:

      gcloud sql backups create --instance=telestar-db --project=telestar-crm-final

REMINDER
read -r -p "  Backup taken? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || fail "Aborted. Take the backup first."

DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

# ── 3. Migrate, using the NEW image ─────────────────────────────────────────
# CRM_IMAGE is exported for this command so the one-off container is the same build that
# is about to serve traffic — migrating with the old image then starting the new one is
# how a deploy ends up half-applied.
log "Pending migrations"
CRM_IMAGE="$NEW_IMAGE" $DC run --rm --no-deps web \
  node node_modules/prisma/build/index.js migrate status || true

log "Applying migrations"
CRM_IMAGE="$NEW_IMAGE" $DC run --rm --no-deps web \
  node node_modules/prisma/build/index.js migrate deploy

MIGRATION=$(ls -1 prisma/migrations | grep -E '^[0-9]{14}_' | tail -1)

# ── 4. Write the digest into the env file, keeping the one it replaces ──────
# PREVIOUS_CRM_IMAGE is what scripts/rollback.sh deploys. Retaining exactly one
# known-good digest is deliberate: a longer history invites picking an arbitrary old
# build, and the deployment record below is the real history.
log "Pinning ${ENV_FILE} to the new digest"
cp "$ENV_FILE" "${ENV_FILE}.bak"
grep -v -E '^(CRM_IMAGE|PREVIOUS_CRM_IMAGE)=' "${ENV_FILE}.bak" > "$ENV_FILE"
{
  echo "CRM_IMAGE=${NEW_IMAGE}"
  echo "PREVIOUS_CRM_IMAGE=${PREVIOUS_IMAGE}"
} >> "$ENV_FILE"

# ── 5. Swap the containers ──────────────────────────────────────────────────
# Both services are named explicitly: a bare `up -d` also starts the unused postgres
# service and needlessly recreates caddy and redis.
log "Starting web and worker on the new digest"
$DC up -d web worker
$DC ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

# ── 6. Prove it ─────────────────────────────────────────────────────────────
log "Post-deploy smoke test"
if ! DEPLOYED_COMMIT="$COMMIT" DOCKER="$DOCKER" ENV_FILE="$ENV_FILE" \
     COMPOSE_FILES="$COMPOSE_FILES" ./scripts/post-deploy-smoke.sh; then
  fail "Smoke test failed. The previous digest is in ${ENV_FILE} as PREVIOUS_CRM_IMAGE — roll back with ./scripts/rollback.sh"
fi

# ── 7. Record it ────────────────────────────────────────────────────────────
# Append-only, one JSON object per line, outside git (the VM is a checkout and a tracked
# file here would conflict on every `git pull`).
log "Recording the deployment in ${RECORD_FILE}"
node -e '
  const [commit, digest, image, previous, migration, operator] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    at: new Date().toISOString(),
    commit, digest, image,
    previousImage: previous || null,
    migration, operator,
  }) + "\n");
' "$COMMIT" "$DIGEST" "$NEW_IMAGE" "$PREVIOUS_IMAGE" "$MIGRATION" "$(whoami)@$(hostname)" \
  >> "$RECORD_FILE"

tail -1 "$RECORD_FILE"
log "Deployed ${COMMIT} (${DIGEST})"
