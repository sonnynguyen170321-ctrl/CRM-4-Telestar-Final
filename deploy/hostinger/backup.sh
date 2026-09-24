#!/usr/bin/env bash
#
# Logical backup of the CRM database: pg_dump, verified, encrypted, copied off-host.
# Prints the resulting path on stdout (scripts/deploy.sh records it in deployments.ndjson).
#
#   deploy/hostinger/backup.sh [--tag <label>] [--sanitize] [--offsite] [--no-encrypt]
#
# This is the coarse layer. Point-in-time recovery comes from pgBackRest's continuous WAL
# archiving (see pgbackrest/README.md): a nightly dump alone means losing up to a day of every
# tenant's replies and sequence state, which is not an acceptable RPO for a system that sends
# outreach on clients' behalf. Keep both — WAL for "restore to 14:32", a dump for "rebuild the
# database somewhere else".
#
# Credentials never appear on a command line. The connection string reaches the container through
# the environment and is dereferenced inside it: putting it in argv would expose the password in
# `ps auxww`, /proc/<pid>/cmdline and `docker inspect` for the life of the container — nightly,
# under cron.
#
# --sanitize    also write <dump>.sanitized.dump with every PII and credential column scrubbed.
#               That file is the only one that may be copied to a laptop.
# --offsite     rclone copy to $BACKUP_REMOTE, verified by listing the object afterwards.
# --no-encrypt  skip age encryption. Local rehearsals only; --offsite refuses it.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
DOCKER="${DOCKER:-docker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${CRM_BACKUP_DIR:-/opt/crm/backups}"
KEEP="${BACKUP_KEEP:-14}"
PG_IMAGE="${PG_CLIENT_IMAGE:-postgres:16-bookworm}"

TAG="manual"
SANITIZE=false
OFFSITE=false
ENCRYPT=true
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="${2:?--tag needs a value}"; shift 2 ;;
    --sanitize) SANITIZE=true; shift ;;
    --offsite) OFFSITE=true; shift ;;
    --no-encrypt) ENCRYPT=false; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done
case "$TAG" in
  *[!A-Za-z0-9._-]*) echo "--tag may only contain A-Za-z0-9._-" >&2; exit 2 ;;
esac

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r'
}

DATABASE_URL="${DATABASE_URL:-$(read_env DATABASE_URL)}"
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL missing in $ENV_FILE" >&2; exit 1; }

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

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BASE="${STAMP}-${TAG}.dump"
DUMP="${BACKUP_DIR}/${BASE}"

# An array, not a string: a BACKUP_DIR containing a space would otherwise word-split into two
# arguments and mount the wrong path. The client runs from the postgres image because the
# application image ships no database client — its runner stage installs only ca-certificates and
# openssl. Pinned to 16: pg_dump refuses a server newer than itself.
PG=("${DOCKER_ARGV[@]}" run --rm --network "$NETWORK" -e "PGURL=${DATABASE_URL}" -e "DUMPFILE=${BASE}"
    -v "${BACKUP_DIR}:/backups" "$PG_IMAGE")

"${PG[@]}" sh -euc 'pg_dump --format=custom --no-owner --no-acl --compress=6 --dbname="$PGURL" --file="/backups/$DUMPFILE"' >&2

# A dump pg_restore cannot list is not a backup.
"${PG[@]}" sh -euc 'pg_restore --list "/backups/$DUMPFILE" | grep -q "TABLE DATA"' >&2 \
  || { echo "dump verification failed: $DUMP" >&2; rm -f "$DUMP"; exit 1; }

SIZE=$(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP")
[ "$SIZE" -gt 1024 ] || { echo "dump suspiciously small (${SIZE} bytes): $DUMP" >&2; exit 1; }
echo "dump: $DUMP (${SIZE} bytes)" >&2

if $SANITIZE; then
  # Restore into a throwaway database, scrub, dump again. The live database is never touched.
  # The scratch name is generated here rather than derived from the DSN by regex — rewriting a
  # URL with sed breaks on query strings and on a database name that also occurs in the password.
  SCRATCH="scratch_sanitize_${STAMP}"
  # The two derived DSNs are built with a real URL parser on the host, not with sed inside the
  # container: a regex over a DSN mis-handles a percent-encoded password, a database name that
  # also occurs in the password, and `?sslmode=`. Node is already required here (prod-check-env).
  command -v node >/dev/null || { echo "node is required for --sanitize (it parses the DSN)" >&2; exit 1; }
  read -r ADMIN_URL SCRATCH_URL <<EOF
$(node -e '
  const u = new URL(process.argv[1]);
  const scratch = process.argv[2];
  const at = (db) => { const c = new URL(u); c.pathname = "/" + db; return c.toString(); };
  if (!/^[A-Za-z0-9_]+$/.test(scratch)) { console.error("bad scratch name"); process.exit(1); }
  process.stdout.write(at("postgres") + " " + at(scratch));
' "$DATABASE_URL" "$SCRATCH")
EOF
  [ -n "$ADMIN_URL" ] && [ -n "$SCRATCH_URL" ] || { echo "could not derive scratch DSNs from DATABASE_URL" >&2; exit 1; }
  "${DOCKER_ARGV[@]}" run --rm --network "$NETWORK" \
    -e "ADMIN_URL=${ADMIN_URL}" -e "SCRATCH_URL=${SCRATCH_URL}" \
    -e "SCRATCH=${SCRATCH}" -e "DUMPFILE=${BASE}" \
    -v "${BACKUP_DIR}:/backups" -v "${SCRIPT_DIR}/sanitize.sql:/sanitize.sql:ro" \
    "$PG_IMAGE" sh -euc "$(cat "${SCRIPT_DIR}/sanitize-runner.sh")" >&2
  echo "sanitized: ${DUMP%.dump}.sanitized.dump" >&2
fi

# Checksum the plaintext, before encryption, so the manifest describes what a restore produces.
SHA=$(sha256sum "$DUMP" | cut -d' ' -f1)
ENCRYPTED_FLAG=false
$ENCRYPT && ENCRYPTED_FLAG=true
printf '{"file":"%s","bytes":%s,"sha256":"%s","takenAt":"%s","tag":"%s","encrypted":%s}\n' \
  "$BASE" "$SIZE" "$SHA" "$(date -u +%FT%TZ)" "$TAG" "$ENCRYPTED_FLAG" > "${DUMP}.manifest.json"

UPLOAD="$DUMP"
if $ENCRYPT; then
  # The dump carries every tenant's prospect data and the ciphertext of customer mailbox tokens.
  # It must not sit in third-party object storage in the clear. age with a recipient public key:
  # this host can encrypt but cannot decrypt, so compromising the VPS does not hand over its own
  # backup history. Keep the private key off this machine.
  command -v age >/dev/null || { echo "age is not installed (apt-get install -y age)" >&2; exit 1; }
  RECIPIENT="${BACKUP_AGE_RECIPIENT:-$(read_env BACKUP_AGE_RECIPIENT)}"
  [ -n "$RECIPIENT" ] \
    || { echo "BACKUP_AGE_RECIPIENT is required (age public key); --no-encrypt is for local rehearsals only" >&2; exit 1; }
  age -r "$RECIPIENT" -o "${DUMP}.age" "$DUMP"
  rm -f "$DUMP"
  UPLOAD="${DUMP}.age"
  echo "encrypted: $UPLOAD" >&2
fi

if $OFFSITE; then
  $ENCRYPT || { echo "--offsite refuses --no-encrypt: an unencrypted dump must not leave this host" >&2; exit 1; }
  BACKUP_REMOTE="${BACKUP_REMOTE:-$(read_env BACKUP_REMOTE)}"
  [ -n "$BACKUP_REMOTE" ] || { echo "BACKUP_REMOTE is required for --offsite (rclone remote:path)" >&2; exit 1; }
  command -v rclone >/dev/null || { echo "rclone not installed" >&2; exit 1; }
  # A copy that exists only on the VPS is not a backup — this host has no platform snapshot. A
  # failed or unverifiable copy fails the script rather than printing a path nobody reads.
  rclone copy "$UPLOAD" "${BACKUP_REMOTE}/" >&2 || { echo "offsite copy FAILED — the backup exists only on this host" >&2; exit 1; }
  rclone copy "${DUMP}.manifest.json" "${BACKUP_REMOTE}/" >&2 || { echo "manifest copy FAILED" >&2; exit 1; }
  rclone lsf "${BACKUP_REMOTE}/$(basename "$UPLOAD")" >/dev/null 2>&1 \
    || { echo "offsite copy reported success but the object is not listable" >&2; exit 1; }
  echo "offsite: ${BACKUP_REMOTE}/$(basename "$UPLOAD")" >&2
fi

# Local retention. Off-host retention belongs to the remote's lifecycle policy.
#
# In its own script because this step used to fail the backup that had just succeeded: under
# `set -euo pipefail`, once every dump had been encrypted nothing matched `*.dump`, `ls` exited
# 2, and the deploy was refused. See deploy/hostinger/prune-backups.sh.
"${SCRIPT_DIR}/prune-backups.sh" "$BACKUP_DIR" "$KEEP"

printf '%s\n' "$UPLOAD"
