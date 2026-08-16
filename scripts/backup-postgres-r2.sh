#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-${ROOT_DIR}/.env.production}"

if [[ "${ENV_FILE}" != /* ]]; then
  ENV_FILE="${ROOT_DIR}/${ENV_FILE}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[backup] env file not found: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

: "${POSTGRES_USER:=crm}"
: "${POSTGRES_DB:=telestar_crm}"
: "${POSTGRES_DUMP_IMAGE:=postgres:16-bookworm}"
: "${BACKUP_LOCAL_DIR:=/var/backups/crm-4-u}"

mkdir -p "${BACKUP_LOCAL_DIR}"

if ! command -v docker >/dev/null 2>&1 && ! command -v sudo >/dev/null 2>&1; then
  echo "[backup] docker is required" >&2
  exit 1
fi

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${BACKUP_LOCAL_DIR}/${POSTGRES_DB}-${STAMP}.sql.gz"

cd "${ROOT_DIR}"

BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-${DIRECT_URL:-${DATABASE_URL:-}}}"
CLEAN_DUMP_URL="$(node -e '
  try {
    const u = new URL(process.argv[1]);
    u.searchParams.delete("schema");
    console.log(u.toString());
  } catch (e) {
    console.log(process.argv[1]);
  }
' "${BACKUP_DATABASE_URL}")"

if [[ -n "${CLEAN_DUMP_URL}" && "${CLEAN_DUMP_URL}" != *"@postgres:"* ]]; then
  echo "[backup] dumping ${POSTGRES_DB} from Cloud SQL via ${POSTGRES_DUMP_IMAGE}"
  $DOCKER run --rm "${POSTGRES_DUMP_IMAGE}" \
    pg_dump "${CLEAN_DUMP_URL}" --no-owner --no-acl \
    | gzip -9 > "${BACKUP_FILE}"
else
  echo "[backup] dumping ${POSTGRES_DB} from postgres container"
  $DOCKER compose --env-file "${ENV_FILE}" exec -T postgres \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-acl \
    | gzip -9 > "${BACKUP_FILE}"
fi

echo "[backup] created local archive: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Prune local backups older than 7 days
find "${BACKUP_LOCAL_DIR}" -type f -name "${POSTGRES_DB}-*.sql.gz" -mtime +7 -delete 2>/dev/null || true

# Optional upload to Cloudflare R2 if configured
if [[ -n "${R2_BUCKET:-}" ]] && command -v rclone >/dev/null 2>&1; then
  R2_REMOTE="${R2_REMOTE:-r2}"
  R2_PREFIX="${R2_PREFIX:-crm-4-u/postgres}"
  REMOTE_PATH="${R2_REMOTE}:${R2_BUCKET}/${R2_PREFIX}/${POSTGRES_DB}-${STAMP}.sql.gz"
  echo "[backup] uploading off-site to ${REMOTE_PATH}"
  rclone copyto "${BACKUP_FILE}" "${REMOTE_PATH}"
  echo "[backup] off-site upload complete."
fi

echo "[backup] database backup successfully completed."
