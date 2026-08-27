#!/usr/bin/env bash
#
# Return to the previously deployed digest. No rebuild, no registry lookup, no guessing.
#
#     ./scripts/rollback.sh                                    # back to PREVIOUS_CRM_IMAGE
#     ./scripts/rollback.sh ghcr.io/...@sha256:<digest>        # back to a specific digest
#
# scripts/deploy.sh writes PREVIOUS_CRM_IMAGE into the env file on every deploy, so the
# last known-good image is always one command away.
#
# Migrations are NOT rolled back. Read the warning below before using this after a
# schema change.

set -euo pipefail

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

CURRENT=$(grep -E '^CRM_IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)
TARGET="${1:-$(grep -E '^PREVIOUS_CRM_IMAGE=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || true)}"

[ -n "$TARGET" ] || fail "No PREVIOUS_CRM_IMAGE recorded and no digest given. Pass one explicitly."
printf '%s' "$TARGET" | grep -Eq '@sha256:[0-9a-f]{64}$|:[0-9a-f]{40}$' \
  || fail "Refusing to roll back to a mutable reference: ${TARGET}"

# A rollback happens during an incident, which is the worst possible moment to discover the
# audit trail is unwritable. Ask before touching anything. (DEPLOY-001)
RECORD_WRITABLE_MSG=$(assert_record_writable "$RECORD_FILE") || fail "$RECORD_WRITABLE_MSG"
command -v python3 >/dev/null 2>&1 || command -v node >/dev/null 2>&1 \
  || fail "Neither python3 nor node is available to write ${RECORD_FILE}. The rollback would leave no audit trail."

echo "  target   : ${DEPLOY_TARGET}"
echo "  compose  : ${COMPOSE_FILES}"
echo "  current  : ${CURRENT:-<none>}"
echo "  rollback : ${TARGET}"

cat <<'WARNING'

  Migrations are NOT reversed. If the deployment being rolled back applied a migration
  that the older image cannot run against, this will not fix the outage — restore the
  Cloud SQL backup taken before the migration instead.

  Check first:  ls -1 prisma/migrations | tail -3
  and compare with the `migration` field of the last two entries in deployments.ndjson.

WARNING

# The prompt is the last human checkpoint before production changes, and it stays the
# default. But it also made this script undrivable by anything without a terminal: over
# `ssh host './scripts/rollback.sh …'` stdin is not a TTY, `read` returns immediately with
# an empty reply, and the script aborts. That is why the DR-003 drill — which exists to
# prove a rollback works, and drives THIS script rather than reimplementing the swap so
# that what is exercised is what an operator would actually run — could never produce a
# pass. TEL-P1-026 named the missing drill; this is the second half of the same gap.
#
# ROLLBACK_ASSUME_YES is deliberately an environment variable and not a flag: a flag is
# easy to add to a half-remembered command line, whereas this has to be set on purpose,
# and it announces itself in the output so the transcript shows the checkpoint was
# bypassed and by whom.
if [ "${ROLLBACK_ASSUME_YES:-}" = "1" ]; then
  echo "  confirm  : skipped — ROLLBACK_ASSUME_YES=1 set by $(whoami)@$(hostname)"
elif [ ! -t 0 ]; then
  fail "stdin is not a terminal and ROLLBACK_ASSUME_YES is not set. Refusing to guess at the confirmation prompt: an unattended rollback must say so explicitly."
else
  read -r -p "  Proceed with rollback? [y/N] " reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ] || fail "Aborted."
fi

DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

log "Pulling ${TARGET}"
# DEPLOY-003: during an incident, "no space left on device" must not be reported as anything else.
if ! PULL_OUTPUT=$($DOCKER pull "$TARGET" 2>&1); then
  printf '%s\n' "$PULL_OUTPUT" >&2
  fail "$(classify_pull_failure "$PULL_OUTPUT" "$TARGET")"
fi
printf '%s\n' "$PULL_OUTPUT"

log "Pinning ${ENV_FILE}"
cp "$ENV_FILE" "${ENV_FILE}.bak"
grep -v -E '^(CRM_IMAGE|PREVIOUS_CRM_IMAGE)=' "${ENV_FILE}.bak" > "$ENV_FILE"
{
  echo "CRM_IMAGE=${TARGET}"
  echo "PREVIOUS_CRM_IMAGE=${CURRENT}"
} >> "$ENV_FILE"

log "Restarting web and worker"
$DC up -d --no-deps web worker
$DC ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'

log "Post-deploy smoke test"
DOCKER="$DOCKER" ENV_FILE="$ENV_FILE" COMPOSE_FILES="$COMPOSE_FILES" ./scripts/post-deploy-smoke.sh

log "Recording the rollback in ${RECORD_FILE}"
RECORD_LINES_BEFORE=0
if [ -f "$RECORD_FILE" ]; then
  RECORD_LINES_BEFORE=$(wc -l < "$RECORD_FILE" | tr -d ' ')
fi

if command -v python3 >/dev/null 2>&1; then
  python3 -c 'import sys, json, datetime; t, c, tgt, op = sys.argv[1:]; print(json.dumps({"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "kind": "rollback", "image": t, "previousImage": c or None, "deployTarget": tgt, "operator": op}))' \
    "$TARGET" "$CURRENT" "$DEPLOY_TARGET" "$(whoami)@$(hostname)" >> "$RECORD_FILE"
elif command -v node >/dev/null 2>&1; then
  node -e 'const [t, c, tgt, op] = process.argv.slice(1); console.log(JSON.stringify({at: new Date().toISOString(), kind: "rollback", image: t, previousImage: c || null, deployTarget: tgt, operator: op}));' \
    "$TARGET" "$CURRENT" "$DEPLOY_TARGET" "$(whoami)@$(hostname)" >> "$RECORD_FILE"
else
  fail "No JSON writer available, so ${RECORD_FILE} was not written. This rollback is live and unrecorded — add the entry by hand before doing anything else."
fi

RECORD_APPEND_MSG=$(assert_record_appended "$RECORD_FILE" "$RECORD_LINES_BEFORE") \
  || fail "$RECORD_APPEND_MSG"

tail -1 "$RECORD_FILE"
log "Rolled back to ${TARGET}"
