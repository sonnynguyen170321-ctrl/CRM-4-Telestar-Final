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

## The cutover — fresh deployment, then the accounts and email assets

The CRM's operational data — leads, contacts, campaigns, activity, message history — is **not**
migrated. The VPS gets a clean deployment from `main` with an empty database that the migrations
build, and then only the small set a working deployment needs on day one is copied across:

```
Tenant → User → EmailAccount
         └───→ Template → Attachment, AbTestVariant
         └───→ Sequence → SequenceStep
```

Eight tables, all small, none of them edited while the move happens. That is why there is no long
freeze window here and no measured dump-and-restore: the whole copy takes seconds.

GCP is retired by this move. Its only role is being where those eight tables currently live.

### 1 — Stand up the stack, empty

```bash
cd /opt/crm && git pull --ff-only origin main
cp deploy/hostinger/crm.env.example .env.production && chmod 600 .env.production
# Fill it. ENCRYPTION_KEY, AUTH_SECRET and CRON_SECRET must be copied from the old deployment
# BYTE FOR BYTE — see step 3 for why ENCRYPTION_KEY in particular is not negotiable.
mkdir -p /opt/crm/pgbackrest
cp deploy/hostinger/pgbackrest/pgbackrest.conf.example /opt/crm/pgbackrest/pgbackrest.conf
npm ci --omit=dev --ignore-scripts && npm run prod:check-env

DC="docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.hostinger.yml"
$DC up -d crm-db redis && sleep 20
$DC run --rm --no-deps web node node_modules/prisma/build/index.js migrate deploy
```

**Gate:** `prod:check-env` exits 0; `/opt/crm/pgbackrest/pgbackrest.conf` is a **file** — Docker
creates a missing bind-mount path as a directory, and `crm-db` then starts with a broken
`archive_command` and archives nothing, silently; `migrate status` reports every migration applied.

### 2 — Copy the accounts and email assets

Run **before** `rls.sql`. That script applies `FORCE ROW LEVEL SECURITY`, under which even the
table owner is subject to the tenant policies and a `COPY` inserts nothing.

```bash
# Either dump on the old host and bring the file over,
deploy/hostinger/copy-core-data.sh --from "$OLD_DSN" --dump-only   # on a host that can reach it
scp core-data-*.sql root@187.127.110.204:/opt/crm/backups/
deploy/hostinger/copy-core-data.sh --file /opt/crm/backups/core-data-*.sql

# or, if this host can reach the old database directly, in one step:
deploy/hostinger/copy-core-data.sh --from "$OLD_DSN"
```

The script refuses to load onto a database that already has users, defers foreign-key checks for
the duration so table order cannot break it, loads in a single transaction, and compares row
counts against the source when it can reach it.

**Gate:** per-table counts match the source.

### 3 — Roles, RLS, and the thing that fails silently

```bash
$DC run --rm --no-deps -v "$PWD/supabase:/sql:ro" --entrypoint sh web -c   'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /sql/roles.sql'
$DC run --rm --no-deps -v "$PWD/supabase:/sql:ro" --entrypoint sh web -c   'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /sql/rls.sql'
npm run verify:rls
./scripts/deploy.sh <sha>
```

`roles.sql` first: roles are cluster-global and are not carried in a dump, and `rls.sql` creates
policies that name `crm_app`.

**The mailbox tokens in `EmailAccount` are encrypted with `ENCRYPTION_KEY`.** If the value on this
host differs from the old deployment's by a single character, the application starts, answers 200,
migrations pass, `verify:rls` passes — and every customer mailbox fails to send, with no error
anywhere. The suppression gate makes that look like a quiet day rather than an outage. Nothing
automated catches it.

**Gate:** `verify:rls` green; `post-deploy-smoke.sh` green; log in as a real user; **send one real
message through a Gmail mailbox and one through an Outlook mailbox, and confirm both arrive.**

### 4 — DNS, then the certificate

```bash
# 24 h earlier: drop the TTL and confirm it took
dig +noall +answer crm.telestar.cloud        # TTL must read 60
```

Point `crm.telestar.cloud` at `187.127.110.204`. **Traefik cannot obtain a certificate for that
name until the record already points here** — Let's Encrypt validates over HTTP-01 against the live
A record, so the first production certificate is issued after the flip, and failed validations
count against a rate limit. Watch it rather than assume it:

```bash
docker logs -f traefik-traefik-1 2>&1 | grep -i acme
curl -sfI https://crm.telestar.cloud/api/health
curl -s  https://crm.telestar.cloud/api/health     # the reported commit must be the deployed sha
```

### 5 — Start the producers, crons last

Flip `EMAIL_SEND_DRY_RUN=false` and `SEQUENCE_AUTOSEND_ENABLED` to their production values,
`$DC up -d --no-deps web worker`, and only then install the cron entries from `docs/DEPLOY.md` §7.

Stop the old deployment's crons and worker before installing these. The suppression check
deduplicates *recipients*, not *jobs*: two schedulers against two databases will each send.

**Gate:** `npm run prod:cutover:postcheck`, worker heartbeat, one canary send end to end.

### 6 — Turning GCP off

- **+1 h** — old web and worker stopped, the instances still running.
- **+72 h**, no incidents — stop the VM. Export the old database once into R2 as an archive: the
  operational data was not migrated, so that export is the only remaining copy of it.
- **+14 days** — delete the instance, then the VM, then the service-account keys.

**Do not skip the archive.** Leads, contacts, campaigns and message history live only in the old
database, and deleting it without an export destroys them.

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
