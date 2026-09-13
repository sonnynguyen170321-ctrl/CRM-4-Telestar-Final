# Hostinger VPS runbook — TeleStar CRM colocated with Nextcloud

Companion to `docs/DEPLOY.md` (generic), `docs/GCP_DEPLOY.md` (where the CRM runs today),
`docs/MIGRATION_RUNBOOK.md`, `docs/ROLLBACK_RUNBOOK.md`, `docs/BACKUP_RESTORE_RUNBOOK.md`.
Facts about the box: `INVENTORY.md`. Firewall: `FIREWALL.md`. Env: `crm.env.example`.

Phases, gates and rollbacks follow the migration plan; this file is the command sheet.

## Layout on the VPS

```
/opt/crm/                 production   compose project `crm`         .env.production
/opt/crm/backups/         pg_dump files (backup.sh), 14 kept locally, rclone off-host
/opt/crm/secrets/         cloudsql-sa.json (chmod 600, root only) — until Phase 6b
/opt/crm-staging/         dark staging compose project `crm-staging` .env.production
/docker/traefik           Hostinger's — do not edit
/docker/nextcloud-o38n    Hostinger's — do not edit
```

## One-time host preparation (survives relocation)

```bash
# swap — a fresh Hostinger install has none. 4 GB because the box is CRM-dedicated and crm-db
# takes a 4 GB ceiling; a burst must evict cache rather than OOM-kill Postgres.
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-crm.conf
# docker log rotation
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "5" } }
JSON
systemctl restart docker            # Nextcloud/Traefik restart in ~10 s
# tools — postgresql-client is for operator psql on the host; backup.sh/restore.sh run the client
# from the postgres:16 image inside the compose network, because the app image ships none.
apt-get install -y rclone jq postgresql-client-16 nmap
# directories
mkdir -p /opt/crm/backups /opt/crm/secrets /opt/crm-staging && chmod 700 /opt/crm/secrets
# firewall — FIREWALL.md, SSH rule first
# registry — PAT with read:packages only, entered on the box, never in chat
docker login ghcr.io -u <github-user>
```

## Checkout

```bash
git clone --branch main https://github.com/sonnynguyen170321-ctrl/CRM-4-Telestar-Final.git /opt/crm
cp /opt/crm/deploy/hostinger/crm.env.example /opt/crm/.env.production && chmod 600 /opt/crm/.env.production
# fill it; then
cd /opt/crm && npm ci --omit=dev --ignore-scripts && npm run prod:check-env
```

`npm ci` on the host is only for the operator scripts (`prod:check-env`, `prod:cutover:*`,
`worker-healthcheck`); the app itself runs from the GHCR image.

## Deploy (every release)

```bash
cd /opt/crm && git pull --ff-only origin main
./scripts/deploy.sh <full-git-sha>       # pulls the digest, pg_dump via backup.sh, migrate deploy, up, smoke, records deployments.ndjson
npm run prod:cutover:postcheck
tail -1 deployments.ndjson
```

`deploy.sh` refuses `:latest`, refuses to run without a verified backup, and writes
`PREVIOUS_CRM_IMAGE` so rollback is one command.

## Rollback

```bash
./scripts/rollback.sh                                   # to PREVIOUS_CRM_IMAGE
./scripts/rollback.sh ghcr.io/…@sha256:<digest>         # to any recorded digest
# destructive migration involved: stop, restore the pre-deploy dump, then roll the image back
docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml stop web worker
deploy/hostinger/restore.sh /opt/crm/backups/<ts>-predeploy-<sha>.dump
./scripts/rollback.sh <digest>
```

## Dark staging

Same as production with: `COMPOSE_PROJECT_NAME=crm-staging`,
`CRM_DOMAIN=staging.srv1908578.hstgr.cloud`, `NEXTAUTH_URL=https://staging.srv1908578.hstgr.cloud`,
`COMPOSE_PROFILES=localdb`, **fresh** `AUTH_SECRET` / `ENCRYPTION_KEY` / `CRON_SECRET`,
`EMAIL_SEND_DRY_RUN=true`, `SEQUENCE_AUTOSEND_ENABLED=false`, a fresh `POSTGRES_PASSWORD`, and
**no cron entries installed**.

The Hostinger subdomain is deliberate: it already resolves to this host, so Traefik can complete
HTTP-01 without touching `crm.telestar.cloud`, and the production name's certificate budget is left
untouched for the cutover.

Gate, all four: `/api/health` 200 through Traefik with a valid certificate; `worker-healthcheck`
green; `npm run verify:rls` green; and after a 24-hour soak, zero rows added to the outbound
message table and zero provider calls in the worker log. Staging is disposable —
`docker compose -p crm-staging down -v`, fix, repeat.

## The cutover — one window, database on the VPS from the first byte

GCP is being retired by this move. It is not a staging ground and not a fallback to keep running:
its only role here is that the production database currently lives there, so it is the source of
the dump, and it stays powered on only as long as an abort during the window would need it.
`COMPOSE_PROFILES=localdb` from the start — the `cloudsql` profile and the Auth Proxy sidecar stay
in the compose file but are never used in production, and no Cloud SQL service-account key is
placed on this host.

### Before the window

**Rehearse on real data.** The PITR numbers in `pgbackrest/README.md` were measured with synthetic
rows: they prove pgBackRest works, not how long *this* database takes. Take a production dump,
restore it into `/opt/crm-staging` with `--fresh`, run `prisma migrate deploy` and
`backfill:campaign-prospects --dry-run` then for real, and **time every step**. The sum is
`T_measured`; the announced window is `2 × T_measured`. A backfill whose duration nobody measured
is the classic overrun.

Check whether production already has the pending migration rather than assuming:

```bash
psql "$CLOUD_SQL_DSN" -tAc   "select migration_name, finished_at from _prisma_migrations where migration_name like '%campaign_prospect_memberships%'"
```

**T-24 h:** drop the `crm.telestar.cloud` TTL to 60 s and confirm it took
(`dig +noall +answer crm.telestar.cloud` shows 60). A 3600 s TTL turns a five-minute rollback into
an hour. Load the R2 credentials and prove `rclone lsf r2:<bucket>` works — an off-host backup
target that is still unconfigured is not a backup.

**Verify `/opt/crm/pgbackrest/pgbackrest.conf` is a file**, not a directory. Docker creates a
missing bind-mount path as a directory, and `crm-db` then starts with a broken `archive_command`
and archives nothing, silently.

### T-0 — stop the producers on GCP, in this order

The order is the double-send guard. The suppression check deduplicates *recipients*, not *jobs*.

```bash
# on the GCE VM
crontab -l | grep -v '/api/cron/' | crontab -                  # 1. crons off
sudo docker compose … stop worker                              # 2. worker off
sudo docker compose … exec redis redis-cli --scan --pattern 'bull:*:active'   # 3. every queue drained
sudo docker compose … stop web                                 # 4. web off — writes end here
```

Killing the **worker**, not just web, is also what stops OAuth refresh-token rotation. Microsoft
and several IMAP providers issue a new refresh token on every use: if a worker refreshes a mailbox
after the final dump is taken, the token restored onto the VPS is already dead and that customer's
mailbox silently stops sending.

**Gate:** every queue reports 0 active, and `curl` to the old host is refused.
**Abort:** restart web, worker and crons. Nothing has moved.

### T+2 — final dump, taken on the GCE VM

Run it there rather than pulling from the VPS, so the Cloud SQL credentials never reach Hostinger.
Transfer over a temporary SSH key that is revoked afterwards. Compare `sha256sum` on both sides and
confirm `pg_restore --list` shows `TABLE DATA`.
**Abort:** restart the GCP stack.

### T+N — restore, migrate, verify

```bash
cd /opt/crm
DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC up -d crm-db redis && sleep 20
deploy/hostinger/restore.sh /opt/crm/backups/<ts>-final-cloudsql.dump --yes --fresh
./scripts/deploy.sh <sha>
$DC run --rm --no-deps -v "$PWD/supabase:/rls:ro" --entrypoint sh web -c   'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /rls/rls.sql'
npm run verify:rls
npm run backfill:campaign-prospects -- --dry-run && npm run backfill:campaign-prospects
npm run prod:check-migrations && npm run prod:cutover:verify
```

`restore.sh --fresh` drops and recreates the database and applies `supabase/roles.sql` first —
roles are cluster-global and are not in a dump, and the dump's own `CREATE POLICY … TO crm_app`
statements abort `pg_restore` without them.

**Gate:** `migrate status` clean, `verify:rls` green, per-tenant row counts match the Cloud SQL
inventory from `prod:cutover:plan`.
**Abort:** restart the GCP stack and its crons; discard the VPS database. Cloud SQL has taken no
writes since T-0, so nothing is lost.

### T+N — DNS, then the certificate

Point `crm.telestar.cloud` at `187.127.110.204`. **Traefik cannot obtain a certificate for that
name until the record already points here** — Let's Encrypt validates over HTTP-01 against the
live A record. The first production certificate is therefore issued *inside* the window, and
failed validations count against a rate limit. Watch it rather than assume it:

```bash
docker logs -f traefik-traefik-1 2>&1 | grep -i acme
curl -sfI https://crm.telestar.cloud/api/health
curl -s https://crm.telestar.cloud/api/health   # the reported commit must be the deployed sha
```

### T+N — start the producers, inverse order

Flip `EMAIL_SEND_DRY_RUN=false` and `SEQUENCE_AUTOSEND_ENABLED` back to their production values,
`$DC up -d --no-deps web worker`, and **only then** install the cron entries.

Before the crons go in, reconcile the last-processed timestamps. The first scheduled run otherwise
fires against job state that is hours stale and can re-send a window of outreach already sent from
GCP — again, suppression deduplicates recipients, not sends.

Send one canary through a Gmail mailbox and one through an Outlook mailbox and confirm both
arrive. This is the check that catches a wrong `ENCRYPTION_KEY`: the stored OAuth tokens are
encrypted with it, so a mismatch produces a healthy-looking application in which every mailbox
quietly fails.

**The last moment an abort is free** is the cron install. After that, rolling back means dumping
the VPS database and restoring it into Cloud SQL to recover the writes that landed here.

### Turning GCP off

- **+1 h** — GCE web and worker stay stopped; the VM and Cloud SQL stay running.
- **+72 h**, no incidents and backups verified — stop the VM, take a final `gcloud sql export sql`
  into R2, revoke the temporary cutover SSH key from this host's `authorized_keys`.
- **+14 days** — delete the Cloud SQL instance only after restoring that R2 archive into staging
  succeeds. Then the VM, then the service-account keys.

## Daily operations

```bash
# base backups for point-in-time recovery — WAL ships continuously between these
0  2 * * 0   docker compose -p crm exec -T crm-db pgbackrest --stanza=crm --type=full backup
0  2 * * 1-6 docker compose -p crm exec -T crm-db pgbackrest --stanza=crm --type=incr backup
# the portable logical dump, encrypted, off-host
30 2 * * * cd /opt/crm && deploy/hostinger/backup.sh --tag nightly --offsite >> /var/log/crm-backup.log 2>&1
# the backup nobody checks is the one that was broken for a month
0  8 * * * cd /opt/crm && deploy/hostinger/backup-freshness-check.sh >> /var/log/crm-backup.log 2>&1
# worker heartbeat every 5 min
*/5 * * * * cd /opt/crm && npx tsx scripts/worker-healthcheck.ts >> /var/log/crm-worker-health.log 2>&1 || echo "worker unhealthy $(date)" | logger -t crm
# logs
docker compose -p crm logs -f --tail 200 web
docker compose -p crm logs -f --tail 200 worker
# queues
docker compose -p crm exec redis redis-cli --scan --pattern 'bull:*:failed'
# database
docker compose -p crm exec crm-db psql -U crm telestar_crm          # after 6b
docker compose -p crm run --rm --no-deps --entrypoint sh web -c 'psql "$DATABASE_URL"'   # before 6b
# local repro from a sanitized dump
deploy/hostinger/backup.sh --tag repro --sanitize   # then scp the .sanitized.dump, restore into local docker-compose.yml postgres
```

Monthly: restore the latest nightly into staging **and** rehearse a pgBackRest restore to a
timestamp, then log both in `docs/v2/codex/SESSION_LOG.md`. A backup that has never been restored
is a hypothesis.

## Point-in-time recovery

`pgbackrest/README.md` — why it exists, the `crm-db` image and `archive_command`, the repository
config, the bring-up commands, and the three-part gate that must pass before the database is
allowed to leave Cloud SQL.
