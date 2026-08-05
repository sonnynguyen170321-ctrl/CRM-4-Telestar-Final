# Deploy Runbook — Telestar SDR CRM

Production deployment to an **always-on host** (e.g. AWS EC2) with **managed Postgres**
(RDS) and **managed Redis** (ElastiCache / Upstash). The app is DB- and host-agnostic —
no Neon or Vercel coupling.

> Runtime law: API routes record intent · workers execute it · the database is truth.
> The web app and the BullMQ worker are **two processes** on the host (or two hosts).

> ### What is actually deployed today (2026-08-04)
>
> This runbook is written generically against AWS. The live system is **GCP**, so read the
> nouns accordingly when working the §8 checklist:
>
> | This runbook says | The live deployment is |
> |---|---|
> | AWS EC2 | GCE `telestar-crm-vm` (`e2-standard-2`), project `telestar-crm-final`, `asia-southeast1-a` |
> | RDS | Cloud SQL `telestar-db`, Postgres 16, `db-g1-small` |
> | ElastiCache / Upstash | a `redis:7` **container on the same VM** — not a managed service |
> | DNS + TLS at a load balancer | Caddy on the VM, currently **plain HTTP on a bare IP** (`http://34.142.236.46`) |
>
> Two consequences worth stating plainly:
>
> - **Queue state does not survive loss of the VM.** Redis is compose-local. That satisfies
>   "always-on worker with a reachable queue" but not durability. Accepted for a demo;
>   revisit before real client data. BullMQ is rebuildable from the DB, so this is recoverable,
>   not fatal.
> - **There is no TLS yet**, so the HSTS and secure-cookie assumptions below are inert and
>   credentials cross the network in cleartext. Tracked as UX-001 in
>   `docs/post-migration/UX-FEEDBACK.md`; §8's "log in over HTTPS" and "security headers"
>   items cannot be verified until a domain is attached.
>
> Full record: `docs/runtime-hardening/STATUS.md`.

---

## 1. Architecture at a glance

| Process | Command | Needs |
|---------|---------|-------|
| **Web** (Next.js) | `npm run start` (after `npm run build`) | `DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY` |
| **Worker** (BullMQ) | `npm run worker:start` | `DATABASE_URL` (use `DIRECT_URL`/TCP for atomic work), `REDIS_URL` |
| **Scheduler** (host cron / PM2) | `curl` the `/api/cron/*` routes | `CRON_SECRET` |

Redis is **required for the worker**; the web app uses it as an optional cache and
degrades gracefully if it is unreachable.

---

## 2. Prerequisites

- A managed **PostgreSQL 16** instance (RDS). Create a database `telestar_crm`.
- A managed **Redis** instance reachable from the host.
- An always-on **Node 24+** host with a process manager (PM2 recommended).
- DNS + TLS terminating at a load balancer / reverse proxy in front of the web process
  (the security headers in `next.config.ts` — including HSTS — assume HTTPS at the edge).

---

## 3. Generate production secrets

Generate **fresh** values — never reuse dev/seed values:

```bash
# AUTH_SECRET (NextAuth session signing)
openssl rand -base64 32

# ENCRYPTION_KEY (AES-256 for stored email credentials/tokens) — must be 64 hex chars
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# CRON_SECRET (bearer token the scheduler sends to /api/cron/*)
openssl rand -hex 32
```

Set these plus the connection strings in the host environment (or a secrets manager).
See [`.env.example`](../.env.example) for the full list. Required to boot:
`DATABASE_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY` — boot **fails fast** if any is missing
(`lib/env.ts` + `instrumentation.ts`). Also set `NEXTAUTH_URL` to the public HTTPS URL,
and point any OAuth redirect URIs (Google/Microsoft) at the production domain.

---

## 4. Database migration + first admin

```bash
npm ci
npx prisma migrate deploy          # applies migrations to RDS (uses DIRECT_URL)
```

**Do NOT run `npm run db:seed` in production** — it wipes data and creates demo users that
share the password `telestar2026`. Create the first Director instead:

```bash
npm run create-admin -- --email you@yourdomain.com --password 'a-strong-password' --name 'Your Name'
# or via ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME env vars
```

This creates the `default-tenant` row if missing and a `director` user (idempotent: re-running
resets that user's password and ensures the account is active). Additional users are then
created from inside the app (Settings → user management).

---

## 5. Build + run the web process

```bash
npm run build                      # prisma generate && next build
npm run start                      # serves on PORT (default 3000)
```

Under PM2:

```bash
pm2 start npm --name crm-web -- run start
```

The login page's demo-account panel is compiled out when `NODE_ENV=production` — verify it
is **absent** on the live login page.

---

## 6. Run the worker process

The worker runs sequence sends, inbox sync, and maintenance jobs off the BullMQ queue. It
must have `REDIS_URL` and a database URL (prefer a TCP `DIRECT_URL` so multi-step atomic
jobs work — the HTTP/pooled path has no interactive transactions).

```bash
pm2 start npm --name crm-worker -- run worker:start
npm run worker:healthcheck         # enqueues a health job to confirm the pipeline
```

---

## 7. Schedule the crons

Point the host scheduler (PM2 cron module or OS `crontab`) at the cron routes with the
`CRON_SECRET` bearer. Suggested cadence:

```cron
# sequence engine — advances due sequence steps / enqueues sends (every 5 min)
*/5 * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://crm.yourdomain.com/api/cron/sequence-engine
# inbox sync — pulls replies/bounces for connected mailboxes (every 10 min)
*/10 * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://crm.yourdomain.com/api/cron/inbox-sync
# email health — scores inboxes, writes snapshots, raises deliverability alerts (hourly)
0 * * * *    curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://crm.yourdomain.com/api/cron/email-health
# maintenance — repairs drift and prunes the audit log (daily, off-peak)
30 3 * * *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://crm.yourdomain.com/api/cron/maintenance
```

The email-health pass reads only data the inbox sync has already stored, so it is safe to run
at any offset — but it is pointless more often than hourly, since its windows are 24h and 7d.

The maintenance sweep enqueues one `maintenance.repair` job per tenant, covering
`orphan-tasks`, `stale-sending`, `stuck-running`, `missing-delayed`, `reassignment-drift`
and `audit-prune`. Narrow it with `?types=audit-prune,orphan-tasks` — unknown names return
400 rather than being silently dropped, so a typo in the crontab is visible.

**`audit-prune` is the only repair that deletes rows.** `lib/audit.ts` writes an AuditLog
row for every create/update/delete on every model, and nothing trimmed it before this job —
the audit-log API's mandatory 30-day read window was the only thing keeping `/admin/audit`
fast. Retention is two-tier and set by `AUDIT_RETENTION_DAYS` (default 90, the extension's
automatic rows) and `ADMIN_AUDIT_RETENTION_DAYS` (default 365, the actor-stamped `admin.*`
trail); the admin window is clamped to at least the extension window. Deletes run in
batches of 1000, capped at 20 batches per tier per run — on a large first pass the job
stops early and logs that it will resume, which is expected, not a failure.

---

## 8. Go-live checklist

Probed against the live deployment (`http://34.142.236.46`) on **2026-08-05**:

- [ ] `prisma migrate deploy` applied cleanly. *20 migrations applied at deploy time and the
      DB answers. **Done 2026-08-05** — `20260806000000_admin_control_center_indexes` applied
      during the `ee08246` deploy; `migrate status` now reports all 22 applied.*
- [ ] `create-admin` Director can log in over HTTPS. **Blocked on 6a** — sign-in works and is
      fast (below), but over plain HTTP.
- [x] Login page shows **no** demo-account panel. *Verified: no "Demo Accounts" markup served.*
- [x] `GET /api/health` returns OK. *Verified: `{"ok":true,"ts":…}`.*
- [x] Worker process up; healthcheck completes. *Verified via `/api/admin/worker-health`:
      `redis: ok`, `database: ok`, all five queues reachable, `import.commit` /
      `import.chunk` runs recorded `completed`.*
- [x] Both crons firing. **Confirmed absent, then installed 2026-08-05.** `crontab -l` on the
      VM was empty — the schedule had never been set up, which is why the newest `JobRun` was
      `import.commit @ 2026-08-04T13:08Z`. Four entries now installed via
      `bin/cron-call.sh` (see §8b step 6). Watch for the first `*/5` firing before calling
      this fully settled.
- [x] Security headers present. *Verified via `curl -I`: `Strict-Transport-Security`,
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
      `Permissions-Policy`. **HSTS is inert until TLS lands** — a browser only honours it
      over HTTPS.*
- [x] Email sending decision made. *Verified: `GET /api/cron/sequence-engine` returns
      `{"disabled":true,"sent":0}` — `SEQUENCE_AUTOSEND_ENABLED` is off.*

---

## 8b. Redeploying the live GCE box

**Verified end to end on 2026-08-05 deploying `ee08246`.** An earlier draft of this section
was written from the deployment record and got two things materially wrong; both are
corrected below.

### The two corrections

**The image is pulled from GHCR, not built on the box.** `.github/workflows/docker-image.yml`
builds on every push to `main` and pushes both `:latest` and `:sha-<7>`. `web` and `worker`
run `ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final:${IMAGE_TAG:-latest}`. So the deploy
is `pull`, never `build` — `docker-compose.build.yml` is an optional overlay that is *not*
what runs. The deployment record's "built on the VM from source" was stale.

**Every compose command needs `--env-file .env.production`.** There is no `.env` in
`/opt/crm-4-u`, and `docker-compose.aws.yml` sets `DATABASE_URL`, `AUTH_SECRET`,
`ENCRYPTION_KEY`, `NEXTAUTH_URL` and `CRON_SECRET` purely by `${VAR}` interpolation. Without
the flag those resolve to empty strings, and a bare `docker compose up -d` will recreate the
containers with a blank database URL and a blank encryption key. **This is the single easiest
way to take the site down from this directory.** The running containers are correct only
because whoever last started them supplied the environment.

A residual `POSTGRES_PASSWORD is not set` warning is expected and harmless — it belongs to
the local `postgres` service in the base file, which the aws overlay drops. `config
--services` returns `redis web caddy worker`, no postgres.

### The deploy

Paths and names below are as verified: project `crm-4-u`, rooted at `/opt/crm-4-u`, owned by
the login user (no `sudo` needed for `git`).

```bash
# 0 — shorthand, since every command repeats it
cd /opt/crm-4-u
DC="sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.aws.yml"

# 1 — back up. NOTE: run this from Cloud Shell, not the VM. The VM's service account
#     lacks the sqladmin scope and fails with ACCESS_TOKEN_SCOPE_INSUFFICIENT.
gcloud sql backups create --instance=telestar-db --project=telestar-crm-final
gcloud sql backups list  --instance=telestar-db --project=telestar-crm-final --limit=3

# 2 — pull the code
git pull origin main && git log --oneline -1 && git status --short

# 3 — pull the image for exactly this commit. This doubles as the CI check: if the tag
#     resolves, the workflow built and pushed it. Do not fall back to :latest blindly.
SHA=$(git rev-parse --short=7 HEAD)
sudo docker pull ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final:sha-$SHA
sudo docker pull ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final:latest
sudo docker images --digests ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final | head -5
#     The :latest and :sha-* digests must match, otherwise someone pushed after you —
#     set IMAGE_TAG=sha-$SHA in .env.production and deploy that instead.

# 4 — what is pending? read-only.
$DC run --rm --no-deps web node node_modules/prisma/build/index.js migrate status

# 5 — apply. NEVER `migrate dev` or `migrate reset` here: package.json wires prisma.seed,
#     and the seed has 17 unfiltered deleteMany() calls including tenant and user.
$DC run --rm --no-deps web node node_modules/prisma/build/index.js migrate deploy

# 6 — swap the containers. Name the services: a bare `up -d` also starts the unused
#     postgres service and needlessly recreates caddy and redis.
$DC up -d web worker
$DC ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
```

### Verify

```bash
curl -s http://34.142.236.46/api/health                 # {"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' http://34.142.236.46/admin   # 307, not 404
```

Then the post-deploy gate, **from a workstation, not the VM**:

```bash
BASE_URL=http://34.142.236.46 E2E_PASSWORD=telestar2026 \
  node node_modules/@playwright/test/cli.js test e2e/crm-journeys.spec.ts e2e/deep-smoke.spec.ts
```

20/20 is the pass mark. **Do not restart `web` while this runs** — it takes ~6 minutes against
the remote, and a mid-run `up -d` shows up as a 502 on whichever test is in flight rather than
as anything meaningful.

### The crons

`crontab -l` on the VM was **empty** as of this deploy — the schedule had never been
installed, so nothing was pruning the audit log or advancing sequences. `bin/cron-call.sh`
reads the secret from `.env.production` at run time so it is never stored in the crontab
(and never printed by `crontab -l`):

```bash
mkdir -p bin && cat > bin/cron-call.sh <<'SCRIPT'
#!/usr/bin/env bash
set -euo pipefail
cd /opt/crm-4-u
SECRET=$(grep '^CRON_SECRET=' .env.production | cut -d= -f2- | tr -d '"')
curl -fsS -H "Authorization: Bearer $SECRET" "http://localhost/api/cron/$1" >/dev/null
SCRIPT
chmod 700 bin/cron-call.sh

cat <<'EOF' | crontab -
*/5 * * * *  /opt/crm-4-u/bin/cron-call.sh sequence-engine
*/10 * * * * /opt/crm-4-u/bin/cron-call.sh inbox-sync
0 * * * *    /opt/crm-4-u/bin/cron-call.sh email-health
30 3 * * *   /opt/crm-4-u/bin/cron-call.sh maintenance
EOF
```

Targets `http://localhost` from inside the VM, so it neither leaves the box nor depends on
the public IP or on TLS being present later.

> **Do not put the secret directly in a crontab line.** `crontab -l` then prints it in full,
> which is exactly how the `CRON_SECRET` in use before 2026-08-05 was exposed and had to be
> rotated.

### Rollback

```bash
sudo docker pull ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final:sha-<previous>
# set IMAGE_TAG=sha-<previous> in .env.production, then:
$DC up -d web worker
```

The `20260806000000` migration only creates indexes, so the previous build runs against the
new schema unchanged — no down-migration needed.

**Sign-in latency (UX-002) — measured, no action needed.** Three consecutive credential
round-trips against the live box: **0.55s / 0.55s / 0.51s**, and `/login` in 0.21s. The 37s
recorded in `docs/post-migration/UX-FEEDBACK.md` does not reproduce; it was almost certainly
cold-start on Cloud SQL / the container. Do not resize the `db-g1-small` tier on the strength
of that old number.

---

## 9. Open decisions / notes

- **Automated sequence sends run on BullMQ.** When a sequence creates an automated email
  step, `lib/sequences/engine.ts` enqueues a **delayed** `sequence.execute-task` job (due at
  the step's send time) that the worker runs — render → `OutboundMessage` → `email.send`.
  The delayed job is mirrored in the `JobRun` table, so it survives a worker restart and the
  maintenance worker's `missing-delayed` repair can rebuild it. No Inngest account or keys are
  required (the dependency was removed). Workers + `REDIS_URL` are therefore mandatory for
  unattended sends; keep `SEQUENCE_AUTOSEND_ENABLED=false` until you're ready to go live.
- **CSP** is intentionally not yet set in `next.config.ts` (a strict nonce-based policy needs
  per-request nonce wiring and would otherwise break inline styles). Add it at the edge/proxy
  or in a follow-up once nonces are wired.
- **Row-Level Security**: app-layer tenant scoping is the isolation layer. To additionally
  enforce Postgres RLS, apply `supabase/rls.sql` and set `DB_RLS_ENFORCED=true`.
