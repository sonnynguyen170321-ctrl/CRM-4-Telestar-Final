# Executed inside the postgres client container by backup.sh --sanitize.
# Kept in its own file rather than inlined so the quoting stays readable and reviewable.
#
# Expects in the environment: ADMIN_URL and SCRATCH_URL (derived on the host with a real URL
# parser, not with sed — a regex over a DSN mis-handles percent-encoded passwords, a database
# name that also occurs in the password, and ?sslmode=), SCRATCH (the database name) and
# DUMPFILE (basename of the dump under /backups).
#
# Nothing here touches the live database beyond CREATE/DROP DATABASE on the server, and the
# scratch database is dropped on every exit path.

cleanup() {
  psql "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"${SCRATCH}\"" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"${SCRATCH}\""

# --no-owner/--no-acl: the scratch database has none of the CRM roles and the scrub connects as
# the owning user, so no RLS policy is in force and every UPDATE sees every row. Do not "improve"
# this by applying roles.sql/rls.sql here — under crm_app with no tenant GUC set the UPDATEs
# would silently match zero rows and the dump would ship unscrubbed.
pg_restore --no-owner --no-acl --exit-on-error --dbname="$SCRATCH_URL" "/backups/${DUMPFILE}"
psql "$SCRATCH_URL" -v ON_ERROR_STOP=1 -f /sanitize.sql
pg_dump --format=custom --no-owner --no-acl --compress=6 \
  --dbname="$SCRATCH_URL" --file="/backups/${DUMPFILE%.dump}.sanitized.dump"
