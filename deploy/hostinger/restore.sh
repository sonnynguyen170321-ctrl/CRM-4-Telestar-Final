#!/usr/bin/env bash
#
# Restore a pg_dump custom-format file into the database DATABASE_URL points at.
#
#   deploy/hostinger/restore.sh <dump> [--yes]
#
# Refuses to run unless the target has no active application connections (stop web+worker first)
# and, without --yes, prints the target and waits for the operator to type the database name.
# Used for: Phase 4 rehearsal into staging, Phase 6b move into crm-db, and rollback after a
# destructive migration (docs/ROLLBACK_RUNBOOK.md).

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
DOCKER="${DOCKER:-docker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILES="${COMPOSE_FILES:-$("${REPO_DIR}/scripts/production-compose.sh" "$ENV_FILE")}"
BACKUP_DIR="${CRM_BACKUP_DIR:-/opt/crm/backups}"

DUMP="${1:?usage: restore.sh <dump> [--yes]}"; YES="${2:-}"
[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')
DB_NAME=$(printf '%s' "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')
DB_HOST=$(printf '%s' "$DATABASE_URL" | sed -E 's#.*@([^/:]+).*#\1#')

DC="$DOCKER compose --env-file $ENV_FILE $COMPOSE_FILES"

# The client runs from the postgres image on the CRM's compose network — the application image
# ships no database client (its runner stage installs only ca-certificates and openssl).
PROJECT="${COMPOSE_PROJECT_NAME:-$(grep -E '^COMPOSE_PROJECT_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' || echo crm)}"
NETWORK="${CRM_NETWORK:-${PROJECT}_crm_internal}"
$DOCKER network inspect "$NETWORK" >/dev/null 2>&1 \
  || { echo "compose network ${NETWORK} not found — bring the stack up first" >&2; exit 1; }
PG_IMAGE="${PG_CLIENT_IMAGE:-postgres:16-bookworm}"
PSQL="$DOCKER run --rm --network ${NETWORK} ${PG_IMAGE} sh -c"

ACTIVE=$($PSQL "psql '${DATABASE_URL}' -tAc \"select count(*) from pg_stat_activity where datname='${DB_NAME}' and application_name <> '' and pid <> pg_backend_pid()\"" 2>/dev/null | tr -d '[:space:]')
if [ "${ACTIVE:-0}" != "0" ]; then
  echo "refusing: ${ACTIVE} active connection(s) to ${DB_NAME}. Stop web and worker first: $DC stop web worker" >&2
  exit 1
fi

echo "target : ${DB_HOST}/${DB_NAME}" >&2
echo "dump   : ${DUMP} ($(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP") bytes)" >&2
if [ "$YES" != "--yes" ]; then
  read -r -p "This DROPS and recreates every object in ${DB_NAME}. Type the database name to continue: " CONFIRM
  [ "$CONFIRM" = "$DB_NAME" ] || { echo "aborted" >&2; exit 1; }
fi

# --clean --if-exists: drop objects that exist, so a rehearsal into a non-empty staging DB is
# repeatable. --no-owner/--no-acl: roles differ between Cloud SQL and the VPS; RLS is re-applied
# from supabase/rls.sql afterwards, not carried in the dump.
$DOCKER run --rm --network "${NETWORK}" -v "$(cd "$(dirname "$DUMP")" && pwd):/restore:ro" "${PG_IMAGE}" sh -c \
  "pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname='${DATABASE_URL}' '/restore/$(basename "$DUMP")'" >&2

echo "restored. Next: $DC run --rm --no-deps web node node_modules/prisma/build/index.js migrate status ; then apply supabase/rls.sql and npm run verify:rls" >&2
