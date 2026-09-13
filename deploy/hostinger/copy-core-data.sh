#!/usr/bin/env bash
#
# Copy the accounts, mailboxes and email assets out of the old database into a freshly migrated
# one. This is not a migration of the CRM's data — it is the small set a new deployment needs in
# order to be usable on day one:
#
#   Tenant → User → EmailAccount, Template (+ Attachment, AbTestVariant), Sequence → SequenceStep
#
# Everything else — leads, contacts, campaigns, activity, message history — is deliberately left
# behind. A full dump/restore would need a long freeze window to avoid losing writes; this needs
# seconds, because these tables are small and nobody is editing them during the move.
#
#   deploy/hostinger/copy-core-data.sh --from <source-dsn>      # dump straight from the old DB
#   deploy/hostinger/copy-core-data.sh --file core-data.sql     # load a dump taken elsewhere
#   deploy/hostinger/copy-core-data.sh --from <dsn> --dump-only # produce the file, load nothing
#
# ORDER MATTERS, twice over:
#
#  1. Run this AFTER `prisma migrate deploy` (the tables must exist) and BEFORE `supabase/rls.sql`.
#     rls.sql applies FORCE ROW LEVEL SECURITY, which subjects even the table owner to the tenant
#     policies — a COPY afterwards would silently insert nothing.
#  2. The mailbox tokens in EmailAccount are encrypted with ENCRYPTION_KEY. The destination MUST
#     use the same key, byte for byte. With a different one the application starts, answers 200,
#     and every mailbox fails to send with no error anywhere. This script checks what it can and
#     warns; only a real send proves it.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
DOCKER="${DOCKER:-docker}"
PG_IMAGE="${PG_CLIENT_IMAGE:-postgres:16-bookworm}"
WORK_DIR="${CRM_BACKUP_DIR:-/opt/crm/backups}"

# Dependency order. psql loads in file order, and the FK checks are deferred during the load
# anyway, but keeping the order honest makes the file readable and the failure obvious.
TABLES=(Tenant User EmailAccount Template Attachment AbTestVariant Sequence SequenceStep)

SOURCE_DSN=""; DUMP_FILE=""; DUMP_ONLY=false
while [ $# -gt 0 ]; do
  case "$1" in
    --from) SOURCE_DSN="${2:?--from needs a DSN}"; shift 2 ;;
    --file) DUMP_FILE="${2:?--file needs a path}"; shift 2 ;;
    --dump-only) DUMP_ONLY=true; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SOURCE_DSN" ] || [ -n "$DUMP_FILE" ] || { echo "one of --from or --file is required" >&2; exit 2; }

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r'
}
TARGET_DSN="${DATABASE_URL:-$(read_env DATABASE_URL)}"
[ -n "$TARGET_DSN" ] || { echo "DATABASE_URL missing in $ENV_FILE" >&2; exit 1; }

PROJECT="${COMPOSE_PROJECT_NAME:-$(read_env COMPOSE_PROJECT_NAME)}"; PROJECT="${PROJECT:-crm}"
NETWORK="${CRM_NETWORK:-${PROJECT}_crm_internal}"
$DOCKER network inspect "$NETWORK" >/dev/null 2>&1 \
  || { echo "compose network ${NETWORK} not found — bring the stack up first" >&2; exit 1; }

mkdir -p "$WORK_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
: "${DUMP_FILE:=${WORK_DIR}/core-data-${STAMP}.sql}"
DUMP_BASE="$(basename "$DUMP_FILE")"
DUMP_DIR="$(cd "$(dirname "$DUMP_FILE")" && pwd)"

# The client runs from the postgres image: the application image ships none. Credentials go in
# through the environment, never on a command line where `ps` and `docker inspect` can read them.
pg() {
  local dsn="$1"; shift
  "$DOCKER" run --rm --network "$NETWORK" -e "PGURL=${dsn}" \
    -v "${DUMP_DIR}:/work" "$PG_IMAGE" "$@"
}

if [ -n "$SOURCE_DSN" ]; then
  echo "dumping ${#TABLES[@]} tables from the source database" >&2
  # No --column-inserts: the default COPY form is an order of magnitude faster to load and is
  # what session_replication_role can defer FK checks around.
  TABLE_FLAGS=(); for t in "${TABLES[@]}"; do TABLE_FLAGS+=(--table="public.\"$t\""); done
  pg "$SOURCE_DSN" sh -euc \
    "pg_dump --data-only --no-owner --no-acl $(printf '%q ' "${TABLE_FLAGS[@]}") --dbname=\"\$PGURL\" --file=/work/${DUMP_BASE}"
  echo "dump: ${DUMP_FILE} ($(stat -c %s "$DUMP_FILE" 2>/dev/null || stat -f %z "$DUMP_FILE") bytes)" >&2
fi

$DUMP_ONLY && { printf '%s\n' "$DUMP_FILE"; exit 0; }
[ -f "$DUMP_FILE" ] || { echo "no such file: $DUMP_FILE" >&2; exit 1; }

echo "--- destination before ---" >&2
for t in "${TABLES[@]}"; do
  n=$(pg "$TARGET_DSN" sh -euc "psql \"\$PGURL\" -tAc 'select count(*) from \"$t\"'" 2>/dev/null | tr -d '[:space:]')
  printf '  %-16s %s\n' "$t" "${n:-?}" >&2
done

# Refuse to load on top of existing rows: this is a fresh-deployment step, and a second run would
# collide on every primary key. Re-running deliberately means truncating first, by hand.
EXISTING=$(pg "$TARGET_DSN" sh -euc "psql \"\$PGURL\" -tAc 'select count(*) from \"User\"'" 2>/dev/null | tr -d '[:space:]')
if [ "${EXISTING:-0}" != "0" ]; then
  echo "refusing: the destination already has ${EXISTING} users. This step is for a fresh database." >&2
  exit 1
fi

# `session_replication_role = replica` defers foreign-key triggers for the duration of the load,
# so the table order in the dump cannot break it. It needs a superuser, which the crm role is on
# its own cluster. One transaction: either every table lands or none does.
echo "loading" >&2
pg "$TARGET_DSN" sh -euc "
  { echo 'BEGIN;';
    echo \"SET session_replication_role = 'replica';\";
    cat /work/${DUMP_BASE};
    echo \"SET session_replication_role = 'origin';\";
    echo 'COMMIT;'; } | psql \"\$PGURL\" -v ON_ERROR_STOP=1 --quiet
"

echo "--- destination after ---" >&2
FAILED=0
for t in "${TABLES[@]}"; do
  n=$(pg "$TARGET_DSN" sh -euc "psql \"\$PGURL\" -tAc 'select count(*) from \"$t\"'" 2>/dev/null | tr -d '[:space:]')
  printf '  %-16s %s\n' "$t" "${n:-?}" >&2
  if [ -n "$SOURCE_DSN" ]; then
    src=$(pg "$SOURCE_DSN" sh -euc "psql \"\$PGURL\" -tAc 'select count(*) from \"$t\"'" 2>/dev/null | tr -d '[:space:]')
    [ "${n:-x}" = "${src:-y}" ] || { echo "    MISMATCH: source has ${src}" >&2; FAILED=1; }
  fi
done
[ "$FAILED" = "0" ] || { echo "row counts do not match the source" >&2; exit 1; }

# A mailbox whose token cannot be decrypted looks exactly like a healthy one until a send is
# attempted, so say plainly what has and has not been proven.
MAILBOXES=$(pg "$TARGET_DSN" sh -euc "psql \"\$PGURL\" -tAc 'select count(*) from \"EmailAccount\" where \"encAccessToken\" is not null or \"encRefreshToken\" is not null or \"encPassword\" is not null'" 2>/dev/null | tr -d '[:space:]')
if [ "${MAILBOXES:-0}" != "0" ]; then
  cat >&2 <<NOTE

  ${MAILBOXES} mailbox record(s) carry encrypted credentials. They decrypt only with the same
  ENCRYPTION_KEY as the source deployment. Nothing here can verify that — a wrong key produces an
  application that starts, answers 200, and silently fails every send.

  Before declaring the migration done, send one real message through a Gmail mailbox and one
  through an Outlook mailbox and confirm both arrive.
NOTE
fi

cat >&2 <<NEXT

  Loaded. Remaining steps, in this order:
    1. psql -f supabase/roles.sql     (if crm_app / crm_migrator / crm_maintenance are missing)
    2. psql -f supabase/rls.sql       (must come AFTER this load: it applies FORCE ROW LEVEL
                                       SECURITY, under which a COPY inserts nothing)
    3. npm run verify:rls
NEXT

printf '%s\n' "$DUMP_FILE"
