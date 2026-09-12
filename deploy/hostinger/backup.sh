#!/usr/bin/env bash
#
# pg_dump of the CRM database from inside the compose network, verified, optionally sanitized,
# optionally shipped off-host. Prints the dump path on stdout (scripts/deploy.sh records it).
#
#   deploy/hostinger/backup.sh [--tag <label>] [--sanitize] [--offsite]
#
# Works for both database profiles: the dump is taken with the postgres client image against
# DATABASE_URL, so it does not matter whether the host is cloudsql-proxy (Phase 6a) or crm-db (6b).
# Hostinger's weekly VPS snapshot is not database-consistent; this is the real backup.
#
# --sanitize  also writes <dump>.sanitized.dump for local reproduction: emails, phones, OAuth
#             tokens and API keys replaced (deploy/hostinger/sanitize.sql). Never ship the
#             unsanitized dump to a laptop.
# --offsite   rclone copy to $BACKUP_REMOTE (e.g. gcs:telestar-crm-backups or b2:telestar-crm)
#             — the VPS is a single point of failure; a backup that lives on it is not one.

set -euo pipefail

ENV_FILE="${ENV_FILE:-.env.production}"
DOCKER="${DOCKER:-docker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILES="${COMPOSE_FILES:-$("${REPO_DIR}/scripts/production-compose.sh" "$ENV_FILE")}"
BACKUP_DIR="${CRM_BACKUP_DIR:-/opt/crm/backups}"
KEEP="${BACKUP_KEEP:-14}"

TAG="manual"; SANITIZE=false; OFFSITE=false
while [ $# -gt 0 ]; do
  case "$1" in
    --tag) TAG="$2"; shift 2 ;;
    --sanitize) SANITIZE=true; shift ;;
    --offsite) OFFSITE=true; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d '\r')
[ -n "$DATABASE_URL" ] || { echo "DATABASE_URL missing in $ENV_FILE" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP="${BACKUP_DIR}/${STAMP}-${TAG}.dump"

# Run the client inside the compose network so `cloudsql-proxy` / `crm-db` resolve. `--no-deps`
# keeps this from starting anything; the DB service itself must already be up.
$DOCKER compose --env-file "$ENV_FILE" $COMPOSE_FILES run --rm --no-deps \
  -v "${BACKUP_DIR}:/backups" --entrypoint sh web -c \
  "pg_dump --format=custom --no-owner --no-acl --compress=6 --dbname='${DATABASE_URL}' --file='/backups/$(basename "$DUMP")'" \
  >&2

# A dump that pg_restore cannot list is not a backup.
$DOCKER compose --env-file "$ENV_FILE" $COMPOSE_FILES run --rm --no-deps \
  -v "${BACKUP_DIR}:/backups" --entrypoint sh web -c \
  "pg_restore --list '/backups/$(basename "$DUMP")' | grep -q 'TABLE DATA' " \
  >&2 || { echo "dump verification failed: $DUMP" >&2; rm -f "$DUMP"; exit 1; }

SIZE=$(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP")
[ "$SIZE" -gt 1024 ] || { echo "dump suspiciously small (${SIZE} bytes): $DUMP" >&2; exit 1; }
echo "dump: $DUMP (${SIZE} bytes)" >&2

if $SANITIZE; then
  # Restore into a throwaway database, scrub, dump again. Never touches the live DB.
  SCRATCH="scratch_sanitize_${STAMP}"
  $DOCKER compose --env-file "$ENV_FILE" $COMPOSE_FILES run --rm --no-deps \
    -v "${BACKUP_DIR}:/backups" -v "${SCRIPT_DIR}/sanitize.sql:/sanitize.sql:ro" --entrypoint sh web -c "
      set -e
      ADMIN_URL=\$(echo '${DATABASE_URL}' | sed -E 's#/[^/?]+(\?|\$)#/postgres\1#')
      psql \"\$ADMIN_URL\" -v ON_ERROR_STOP=1 -c 'CREATE DATABASE ${SCRATCH}'
      SCRATCH_URL=\$(echo '${DATABASE_URL}' | sed -E 's#/[^/?]+(\?|\$)#/${SCRATCH}\1#')
      pg_restore --no-owner --no-acl --dbname=\"\$SCRATCH_URL\" '/backups/$(basename "$DUMP")'
      psql \"\$SCRATCH_URL\" -v ON_ERROR_STOP=1 -f /sanitize.sql
      pg_dump --format=custom --no-owner --no-acl --compress=6 --dbname=\"\$SCRATCH_URL\" --file='/backups/$(basename "$DUMP" .dump).sanitized.dump'
      psql \"\$ADMIN_URL\" -c 'DROP DATABASE ${SCRATCH}'
    " >&2
  echo "sanitized: ${DUMP%.dump}.sanitized.dump" >&2
fi

if $OFFSITE; then
  : "${BACKUP_REMOTE:?BACKUP_REMOTE is required for --offsite (rclone remote:path)}"
  command -v rclone >/dev/null || { echo "rclone not installed" >&2; exit 1; }
  rclone copy "$DUMP" "$BACKUP_REMOTE/" >&2
  echo "offsite: $BACKUP_REMOTE/$(basename "$DUMP")" >&2
fi

# Local retention. Off-host retention is rclone's job.
ls -1t "${BACKUP_DIR}"/*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

printf '%s\n' "$DUMP"
