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
# swap — the box has none; a burst must evict cache, not OOM-kill Postgres
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
sysctl -w vm.swappiness=10 && echo 'vm.swappiness=10' > /etc/sysctl.d/90-crm.conf
# docker log rotation
cat > /etc/docker/daemon.json <<'JSON'
{ "log-driver": "json-file", "log-opts": { "max-size": "50m", "max-file": "5" } }
JSON
systemctl restart docker            # Nextcloud/Traefik restart in ~10 s
# tools
apt-get install -y rclone jq
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

## Dark staging (Phase 3)

Same as production with: `COMPOSE_PROJECT_NAME=crm-staging`, `CRM_DOMAIN=crm-staging.telestar.cloud`,
`NEXTAUTH_URL=https://crm-staging.telestar.cloud`, `COMPOSE_PROFILES=localdb`, fresh
`AUTH_SECRET/ENCRYPTION_KEY/CRON_SECRET`, `EMAIL_SEND_DRY_RUN=true`, `SEQUENCE_AUTOSEND_ENABLED=false`,
**no cron entries**. Point a DNS A record for the staging host at the VPS so Traefik can complete
HTTP-01. Gate: `/api/health` 200 through Traefik, `worker-healthcheck` green, zero sends after 24 h.

## Cutover 6a — compute to the VPS, DB stays on Cloud SQL

Prerequisites: VPS relocated to Singapore; staging gates passed; `crm.telestar.cloud` TTL at 60 s
for ≥ 24 h; `/opt/crm/.env.production` holds the **current production secrets** (scp'd from the
GCP VM) with `COMPOSE_PROFILES=cloudsql`, `DATABASE_URL` host `cloudsql-proxy`; `cloudsql-sa.json` in
place; `docker compose … up -d cloudsql-proxy` and `psql` through it succeeds.

```bash
# GCP VM — stop producers first (double-send guard; suppression does not dedupe)
sudo docker compose -f docker-compose.yml -f docker-compose.gcp.yml --env-file .env.production stop worker
crontab -l | grep -v '/api/cron/' | crontab -        # remove cron entries
# wait for idle: every queue 0 active
sudo docker compose … exec redis redis-cli --scan --pattern 'bull:*:active' | xargs -I{} sh -c 'echo {} $(redis-cli LLEN {})'

# VPS
cd /opt/crm && ./scripts/deploy.sh <sha>            # web + worker up on the digest
# crons — same lines as docs/DEPLOY.md §7, secret from .env.production
crontab -e
# DNS: crm.telestar.cloud A → VPS IP
npm run prod:cutover:verify && npm run prod:cutover:postcheck
```

Flip `EMAIL_SEND_DRY_RUN=false` / `SEQUENCE_AUTOSEND_ENABLED` to the old production values **only
after** verify passes, then `docker compose … up -d --no-deps web worker`. Watch for 1 h: error rate,
queue depth, worker heartbeat, DB connections, `free -m`. GCP VM stays warm 72 h.

Rollback: DNS back to GCP; `docker compose … stop worker` on the VPS; restart the GCP worker and
crons. The database was shared throughout, so there is nothing to reconcile.

## Cutover 6b — Postgres to the VPS (≥ 7 days after 6a)

Window = 2 × the dump+restore time measured in Phase 4.

```bash
cd /opt/crm
docker compose … stop web worker && crontab -l | grep -v '/api/cron/' | crontab -
deploy/hostinger/backup.sh --tag final-cloudsql            # through cloudsql-proxy
# switch env: COMPOSE_PROFILES=localdb, DATABASE_URL/DIRECT_URL/BACKUP_DATABASE_URL host crm-db, POSTGRES_PASSWORD
docker compose … up -d crm-db && sleep 15
deploy/hostinger/restore.sh /opt/crm/backups/<ts>-final-cloudsql.dump --yes
docker compose … run --rm --no-deps web node node_modules/prisma/build/index.js migrate status   # must be clean
docker compose … run --rm --no-deps -v $PWD/supabase:/rls:ro --entrypoint sh web -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /rls/rls.sql'
npm run verify:rls
docker compose … up -d web worker && crontab -e && npm run prod:cutover:postcheck
docker compose … stop cloudsql-proxy
```

Rollback inside the window: revert the env to `cloudsql`/`cloudsql-proxy`, `up -d web worker` —
Cloud SQL was untouched since the worker stopped.

## Daily operations

```bash
# backups: nightly at 02:30 UTC, off-host
30 2 * * * cd /opt/crm && deploy/hostinger/backup.sh --tag nightly --offsite >> /var/log/crm-backup.log 2>&1
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

Monthly: restore the latest nightly into staging and log the result in `docs/v2/codex/SESSION_LOG.md`.
