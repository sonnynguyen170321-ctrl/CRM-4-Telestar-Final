#!/usr/bin/env bash
#
# Restore a pg_dump custom-format file into the database DATABASE_URL points at.
#
#   deploy/hostinger/restore.sh <dump|dump.age> [--yes] [--fresh]
#
# Used for: the Phase 4 rehearsal into staging, the Phase 6b move onto crm-db, and recovery from
# a bad release (docs/ROLLBACK_RUNBOOK.md).
#
# --fresh  DROP and CREATE the target database before restoring, instead of `pg_restore --clean`.
#          Required whenever the target's schema may be NEWER than the dump — see the warning
#          below. On an empty database it is also simply faster.
#
# WHAT `pg_restore --clean` DOES NOT DO. It drops only the objects the dump itself contains.
# Anything that exists in the target but not in the dump survives: restoring a pre-migration dump
# over a migrated database leaves the newer tables, indexes and constraints in place, still
# enforcing uniqueness the old application does not know about. There is no such thing as a
# schema rollback by restore alone. For a rollback across a migration use --fresh.
#
# WHAT NEVER COMES BACK IN A DUMP. `--no-owner --no-acl` deliberately strips ownership and grants,
# and roles are cluster-global, so they are not in a database dump at all:
#   * the crm_app / crm_migrator / crm_maintenance roles and their passwords
#   * every table and sequence GRANT, and ALTER DEFAULT PRIVILEGES
# `CREATE POLICY … TO crm_app` IS in the dump, which is why a restore into a cluster without
# those roles fails outright under --exit-on-error. This script therefore applies
# supabase/roles.sql before pg_restore when the roles are missing. RLS policies still have to be
# re-derived afterwards with supabase/rls.sql, because the dump's policies were written against
# whatever tables existed when it was taken.
#
# Correct order, which the script enforces and prints:
#   roles.sql (if missing) → pg_restore → prisma migrate status → rls.sql → verify:rls

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
DOCKER="${DOCKER:-docker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PG_IMAGE="${PG_CLIENT_IMAGE:-postgres:16-bookworm}"

DUMP="${1:?usage: restore.sh <dump|dump.age> [--yes] [--fresh]}"
shift
YES=false
FRESH=false
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    --fresh) FRESH=true ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done
[ -f "$DUMP" ] || { echo "no such file: $DUMP" >&2; exit 1; }

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r'
}
DATABASE_URL="${DATABASE_URL:-$(read_env DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL missing in $ENV_FILE" >&2; exit 1; }

command -v node >/dev/null || { echo "node is required (it parses the DSN)" >&2; exit 1; }
eval "$(node -e '
  const u = new URL(process.argv[1]);
  const at = (db) => { const c = new URL(u); c.pathname = "/" + db; return c.toString(); };
  const q = (s) => "'"'"'" + String(s).replace(/'"'"'/g, String.raw`'"'"'\'"'"''"'"'`) + "'"'"'";
  process.stdout.write(
    "DB_NAME=" + q(decodeURIComponent(u.pathname.slice(1))) + "\n" +
    "DB_HOST=" + q(u.hostname) + "\n" +
    "ADMIN_URL=" + q(at("postgres")) + "\n"
  );
' "$DATABASE_URL")"

# age-encrypted dumps are decrypted to a temp file that is removed on every exit path. The key
# lives off this host, so this only works where the operator has it.
CLEANUP_FILE=""
cleanup() { [ -n "$CLEANUP_FILE" ] && rm -f "$CLEANUP_FILE"; }
trap cleanup EXIT
case "$DUMP" in
  *.age)
    command -v age >/dev/null || { echo "age is not installed; cannot decrypt $DUMP" >&2; exit 1; }
    IDENTITY="${BACKUP_AGE_IDENTITY:-$(read_env BACKUP_AGE_IDENTITY)}"
    [ -n "$IDENTITY" ] && [ -f "$IDENTITY" ] \
      || { echo "BACKUP_AGE_IDENTITY must point at the age private key file to decrypt $DUMP" >&2; exit 1; }
    CLEANUP_FILE="$(mktemp "${TMPDIR:-/tmp}/crm-restore-XXXXXX.dump")"
    age -d -i "$IDENTITY" -o "$CLEANUP_FILE" "$DUMP"
    echo "decrypted to $CLEANUP_FILE" >&2
    DUMP="$CLEANUP_FILE"
    ;;
esac

# Verify the checksum when a manifest sits next to the dump. A dump that restores cleanly but is
# not the dump that was taken is a silent data-corruption event.
MANIFEST="${1%.age}.manifest.json"
if [ -f "$MANIFEST" ] && command -v sha256sum >/dev/null; then
  WANT=$(node -e 'process.stdout.write(String(require(process.argv[1]).sha256||""))' "$MANIFEST" 2>/dev/null || true)
  if [ -n "$WANT" ]; then
    GOT=$(sha256sum "$DUMP" | cut -d' ' -f1)
    [ "$WANT" = "$GOT" ] || { echo "checksum mismatch: manifest says ${WANT}, file is ${GOT}" >&2; exit 1; }
    echo "checksum verified against $(basename "$MANIFEST")" >&2
  fi
fi

PROJECT="${COMPOSE_PROJECT_NAME:-$(read_env COMPOSE_PROJECT_NAME)}"
PROJECT="${PROJECT:-crm}"
NETWORK="${CRM_NETWORK:-${PROJECT}_crm_internal}"
# `$DOCKER` may legitimately be two words ("sudo docker"). Split it once into an array so every
# invocation below can quote its elements. Writing `"$DOCKER" run ...` collapsed "sudo docker" into a single
# argv entry and failed with "sudo docker: command not found" even where sudo existed, while leaving
# it unquoted would break on a path containing a space.
# shellcheck disable=SC2206
DOCKER_ARGV=($DOCKER)
"${DOCKER_ARGV[@]}" network inspect "$NETWORK" >/dev/null 2>&1 \
  || { echo "compose network ${NETWORK} not found — bring the stack up first" >&2; exit 1; }

DUMP_DIR="$(cd "$(dirname "$DUMP")" && pwd)"
PG=("${DOCKER_ARGV[@]}" run --rm --network "$NETWORK"
    -e "PGURL=${DATABASE_URL}" -e "ADMIN_URL=${ADMIN_URL}" -e "DB_NAME=${DB_NAME}"
    -e "DUMPFILE=$(basename "$DUMP")"
    -v "${DUMP_DIR}:/restore:ro" "$PG_IMAGE")

# Every backend on this database except our own, whatever it calls itself. Filtering on
# `application_name <> ''` missed any client that does not set one — a bare psql, a pooler, a
# driver with the default empty value — and those are exactly the connections that would be
# reading while the schema is dropped underneath them.
ACTIVE=$("${PG[@]}" sh -euc 'psql "$PGURL" -tAc "select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid() and backend_type = '"'"'client backend'"'"'"' 2>/dev/null | tr -d '[:space:]')
if [ "${ACTIVE:-0}" != "0" ]; then
  echo "refusing: ${ACTIVE} other client connection(s) to ${DB_NAME}." >&2
  echo "Stop the application first: docker compose -p ${PROJECT} stop web worker" >&2
  exit 1
fi

echo "target : ${DB_HOST}/${DB_NAME}" >&2
echo "dump   : ${DUMP} ($(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP") bytes)" >&2
echo "mode   : $($FRESH && echo 'DROP + CREATE database (schema rollback safe)' || echo 'pg_restore --clean (forward only; newer objects survive)')" >&2
if ! $YES; then
  read -r -p "This destroys the contents of ${DB_NAME}. Type the database name to continue: " CONFIRM
  [ "$CONFIRM" = "$DB_NAME" ] || { echo "aborted" >&2; exit 1; }
fi

# The roles the dump's own CREATE POLICY statements reference. Without them pg_restore aborts
# part-way under --exit-on-error, leaving a half-restored database — the failure mode that makes
# a fresh crm-db container (Phase 6b) look like a corrupt dump.
MISSING=$("${PG[@]}" sh -euc 'psql "$PGURL" -tAc "select string_agg(r, '"'"', '"'"') from unnest(array['"'"'crm_app'"'"','"'"'crm_migrator'"'"','"'"'crm_maintenance'"'"']) r where not exists (select 1 from pg_roles where rolname = r)"' 2>/dev/null | tr -d '[:space:]')
if [ -n "$MISSING" ]; then
  echo "roles missing: ${MISSING} — applying supabase/roles.sql first" >&2
  "${DOCKER_ARGV[@]}" run --rm --network "$NETWORK" -e "PGURL=${DATABASE_URL}" \
    -v "${REPO_DIR}/supabase:/sql:ro" "$PG_IMAGE" \
    sh -euc 'psql "$PGURL" -v ON_ERROR_STOP=1 -f /sql/roles.sql' >&2
fi

if $FRESH; then
  "${PG[@]}" sh -euc '
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE)"
    psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\""
    pg_restore --no-owner --no-acl --exit-on-error --dbname="$PGURL" "/restore/$DUMPFILE"
  ' >&2
else
  "${PG[@]}" sh -euc 'pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$PGURL" "/restore/$DUMPFILE"' >&2
fi

cat >&2 <<NEXT

restored. Remaining steps, in this order — the restore alone does not leave a working database:
  1. docker compose -p ${PROJECT} run --rm --no-deps web node node_modules/prisma/build/index.js migrate status
  2. re-derive RLS:  docker run --rm --network ${NETWORK} -e PGURL='<dsn>' -v ${REPO_DIR}/supabase:/sql:ro ${PG_IMAGE} sh -c 'psql "\$PGURL" -v ON_ERROR_STOP=1 -f /sql/rls.sql'
  3. npm run verify:rls
NEXT
