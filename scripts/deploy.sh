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
# shellcheck source=scripts/deploy-lib.sh
. "${SCRIPT_DIR}/deploy-lib.sh"
COMPOSE_FILES="${COMPOSE_FILES:-$("${SCRIPT_DIR}/production-compose.sh" "$ENV_FILE")}"
DEPLOY_TARGET=$(grep -E '^[[:space:]]*DEPLOY_TARGET=' "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/["'\''[:space:]]//g' || echo "gcp")

COMMIT="${1:-$(git rev-parse HEAD)}"
if ! printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
  fail "Expected a full 40-character commit SHA, got: $COMMIT"
fi

# ── 0. Preflight the audit trail ────────────────────────────────────────────
# DEPLOY-001: the record was written last, so a file this user cannot append to was only
# discovered after the containers had already swapped — leaving the running release with no
# entry in the audit trail. Ask now, while nothing has happened yet.
RECORD_WRITABLE_MSG=$(assert_record_writable "$RECORD_FILE") || fail "$RECORD_WRITABLE_MSG"
command -v python3 >/dev/null 2>&1 || command -v node >/dev/null 2>&1 \
  || fail "Neither python3 nor node is available to write ${RECORD_FILE}. The deploy would leave no audit trail."

# ── 1. Resolve the tag to a digest, once ────────────────────────────────────
# Everything downstream uses the digest. If the tag moves after this line, it changes
# nothing about what gets deployed.
log "Resolving ${IMAGE_NAME}:${COMMIT} to a digest"
# DEPLOY-003: report the cause the registry actually gave. A full disk and a missing image
# need opposite responses, and this line used to name CI for both.
if ! PULL_OUTPUT=$($DOCKER pull "${REGISTRY}/${IMAGE_NAME}:${COMMIT}" 2>&1); then
  printf '%s\n' "$PULL_OUTPUT" >&2
  fail "$(classify_pull_failure "$PULL_OUTPUT" "$COMMIT")"
fi
printf '%s\n' "$PULL_OUTPUT"

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

SQL_INSTANCE="${DEPLOY_SQL_INSTANCE:-telestar-db}"
SQL_PROJECT="${DEPLOY_SQL_PROJECT:-telestar-crm-final}"

if [ -z "$BACKUP_ID" ]; then
  cat <<'REMINDER'

  Operating restrictions require a pre-deploy backup.
  Create one from Cloud Shell:

      gcloud sql backups create --instance=telestar-db --project=telestar-crm-final

  Then paste the numeric backup run id it prints — not a password, not a date.

REMINDER
  read -r -p "  Enter Cloud SQL Backup ID: " BACKUP_ID
  BACKUP_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
fi

# DEPLOY-002: this prompt used to accept any non-empty string. `Telestar2026` — the published
# demo password — was accepted on three separate deploys, and nothing ever checked that a
# backup existed. Validate the shape, then ask the infrastructure.
BACKUP_ID_MSG=$(validate_backup_id "$BACKUP_ID") || fail "Aborted. ${BACKUP_ID_MSG}"
BACKUP_ID="$BACKUP_ID_MSG"

set +e
BACKUP_CHECK_MSG=$(verify_backup_exists "$BACKUP_ID" "$SQL_INSTANCE" "$SQL_PROJECT")
BACKUP_CHECK_STATUS=$?
set -e

case "$BACKUP_CHECK_STATUS" in
  0)
    BACKUP_VERIFIED=true
    echo "  backup   : ${BACKUP_ID} (verified)"
    ;;
  1)
    # Cloud SQL answered and said no. Deploying now risks an unrecoverable migration.
    fail "${BACKUP_CHECK_MSG} Create a real backup before deploying."
    ;;
  *)
    # Could not ask. That is not a pass, and the record must say so rather than implying one.
    BACKUP_VERIFIED=false
    printf '\n\033[33mWARNING: %s\033[0m\n' "$BACKUP_CHECK_MSG" >&2
    echo "  Verify it yourself from Cloud Shell before continuing:"
    echo "      gcloud sql backups describe ${BACKUP_ID} --instance=${SQL_INSTANCE} --project=${SQL_PROJECT}"
    read -r -p "  Type UNVERIFIED to deploy without proof of a backup: " BACKUP_ACK
    [ "$BACKUP_ACK" = "UNVERIFIED" ] || fail "Aborted. No verified pre-deploy backup."
    ;;
esac

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
RECORD_LINES_BEFORE=0
if [ -f "$RECORD_FILE" ]; then
  RECORD_LINES_BEFORE=$(wc -l < "$RECORD_FILE" | tr -d ' ')
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import sys, json, datetime; c, d, i, p, m, t, b_id, b_at, b_v, tot, op = sys.argv[1:]; print(json.dumps({"deployedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "commit": c, "digest": d, "image": i, "previousImage": p or None, "deployTarget": t, "backupId": b_id or None, "backupAt": b_at or None, "backupVerified": b_v == "true", "totalMigrations": int(tot) if tot.isdigit() else 0, "latestMigration": m, "operator": op}))' \
    "$COMMIT" "$DIGEST" "$NEW_IMAGE" "$PREVIOUS_IMAGE" "$MIGRATION_LATEST" "$DEPLOY_TARGET" "$BACKUP_ID" "$BACKUP_AT" "$BACKUP_VERIFIED" "$TOTAL_MIGRATIONS" "$(whoami)@$(hostname)" >> "$RECORD_FILE"
elif command -v node >/dev/null 2>&1; then
  node -e 'const [c, d, i, p, m, t, b_id, b_at, b_v, tot, op] = process.argv.slice(1); console.log(JSON.stringify({deployedAt: new Date().toISOString(), commit: c, digest: d, image: i, previousImage: p || null, deployTarget: t, backupId: b_id || null, backupAt: b_at || null, backupVerified: b_v === "true", totalMigrations: parseInt(tot, 10) || 0, latestMigration: m, operator: op}));' \
    "$COMMIT" "$DIGEST" "$NEW_IMAGE" "$PREVIOUS_IMAGE" "$MIGRATION_LATEST" "$DEPLOY_TARGET" "$BACKUP_ID" "$BACKUP_AT" "$BACKUP_VERIFIED" "$TOTAL_MIGRATIONS" "$(whoami)@$(hostname)" >> "$RECORD_FILE"
else
  fail "No JSON writer available, so ${RECORD_FILE} was not written. This release is running unrecorded — add the entry by hand before doing anything else."
fi

# The append is only real if the file grew. A redirect that printed "Permission denied" used
# to leave the deploy looking successful.
RECORD_APPEND_MSG=$(assert_record_appended "$RECORD_FILE" "$RECORD_LINES_BEFORE") \
  || fail "$RECORD_APPEND_MSG"

tail -1 "$RECORD_FILE"
log "Successfully deployed ${COMMIT} (${DIGEST})"
