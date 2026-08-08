#!/usr/bin/env bash
#
# Return to the previously deployed digest. No rebuild, no registry lookup, no guessing.
#
#     ./scripts/rollback.sh                                    # back to PREVIOUS_CRM_IMAGE
#     ./scripts/rollback.sh ghcr.io/...@sha256:<digest>        # back to a specific digest
#
# scripts/deploy.sh writes PREVIOUS_CRM_IMAGE into the env file on every deploy, so the
# last known-good image is always one command away. That is the point of retaining it: a
# rollback that requires finding a tag, checking out a commit and rebuilding is not a
# rollback, it is another deployment with its own risk.
#
# Migrations are NOT rolled back. Read the warning below before using this after a
# schema change.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILES="${COMPOSE_FILES:--f docker-compose.yml -f docker-compose.aws.yml}"
RECORD_FILE="${RECORD_FILE:-deployments.ndjson}"
DOCKER="${DOCKER:-sudo docker}"

log()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "$ENV_FILE not found. Run this from the deployment root."

CURRENT=$(grep -E '^CRM_IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)
TARGET="${1:-$(grep -E '^PREVIOUS_CRM_IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)}"

[ -n "$TARGET" ] || fail "No PREVIOUS_CRM_IMAGE recorded and no digest given. Pass one explicitly."
printf '%s' "$TARGET" | grep -Eq '@sha256:[0-9a-f]{64}$|:[0-9a-f]{40}$' \
  || fail "Refusing to roll back to a mutable reference: ${TARGET}"

echo "  current  : ${CURRENT:-<none>}"
echo "  rollback : ${TARGET}"

cat <<'WARNING'

  Migrations are NOT reversed. If the deployment being rolled back applied a migration
  that the older image cannot run against, this will not fix the outage — restore the
  Cloud SQL backup taken before the migration instead.

  Check first:  ls -1 prisma/migrations | tail -3
  and compare with the `migration` field of the last two entries in deployments.ndjson.

WARNING
read -r -p "  Proceed with rollback? [y/N] " reply
[ "$reply" = "y" ] || [ "$reply" = "Y" ] || fail "Aborted."

DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

log "Pulling ${TARGET}"
$DOCKER pull "$TARGET"

log "Pinning ${ENV_FILE}"
cp "$ENV_FILE" "${ENV_FILE}.bak"
grep -v -E '^(CRM_IMAGE|PREVIOUS_CRM_IMAGE)=' "${ENV_FILE}.bak" > "$ENV_FILE"
{
  echo "CRM_IMAGE=${TARGET}"
  # The image we just rolled off becomes the rollback target, so a bad rollback is itself
  # reversible.
  echo "PREVIOUS_CRM_IMAGE=${CURRENT}"
} >> "$ENV_FILE"

log "Restarting web and worker"
$DC up -d web worker
$DC ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

log "Post-deploy smoke test"
DOCKER="$DOCKER" ENV_FILE="$ENV_FILE" COMPOSE_FILES="$COMPOSE_FILES" ./scripts/post-deploy-smoke.sh

log "Recording the rollback in ${RECORD_FILE}"
node -e '
  const [image, previous, operator] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({
    at: new Date().toISOString(),
    kind: "rollback",
    image,
    previousImage: previous || null,
    operator,
  }) + "\n");
' "$TARGET" "$CURRENT" "$(whoami)@$(hostname)" >> "$RECORD_FILE"

tail -1 "$RECORD_FILE"
log "Rolled back to ${TARGET}"
