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
      DB answers, but `20260806000000_admin_control_center_indexes` is **not** on the box yet —
      it ships with the Admin Control Center merge and needs a redeploy.*
- [ ] `create-admin` Director can log in over HTTPS. **Blocked on 6a** — sign-in works and is
      fast (below), but over plain HTTP.
- [x] Login page shows **no** demo-account panel. *Verified: no "Demo Accounts" markup served.*
- [x] `GET /api/health` returns OK. *Verified: `{"ok":true,"ts":…}`.*
- [x] Worker process up; healthcheck completes. *Verified via `/api/admin/worker-health`:
      `redis: ok`, `database: ok`, all five queues reachable, `import.commit` /
      `import.chunk` runs recorded `completed`.*
- [ ] Both crons firing. **Not verified — needs host log access.** Circumstantial evidence
      says no: the newest `JobRun` on the box is `import.commit @ 2026-08-04T13:08Z`, over a
      day old. That is not conclusive on its own (`sequence-engine` returns without enqueueing
      while autosend is off, and `inbox-sync` enqueues nothing with no connected mailboxes),
      but nothing in the deployment record says a crontab was ever installed. Check
      `docker compose logs` / the host scheduler before ticking this.
- [x] Security headers present. *Verified via `curl -I`: `Strict-Transport-Security`,
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
      `Permissions-Policy`. **HSTS is inert until TLS lands** — a browser only honours it
      over HTTPS.*
- [x] Email sending decision made. *Verified: `GET /api/cron/sequence-engine` returns
      `{"disabled":true,"sent":0}` — `SEQUENCE_AUTOSEND_ENABLED` is off.*

---

## 8b. Redeploying the live GCE box (2026-08-05)

The VM is running the build from **2026-08-04** — no Admin Control Center, and the
`20260806000000_admin_control_center_indexes` migration is not applied. Everything below
is now on `origin/main` at `e6fac30`.

> Written from the deployment record, not from a session on the box — I have not had shell
> access. Step 1 is discovery for that reason; adjust paths to what you find.

**1 — Get on the box and find the stack.**

```bash
gcloud compute ssh telestar-crm-vm --project telestar-crm-final --zone asia-southeast1-a
sudo docker compose ls                 # where is the compose project rooted?
cd <that directory>                    # the repo checkout with docker-compose.yml
git remote -v && git log --oneline -1  # confirm it tracks CRM-4-Telestar-Final @ 649c2b0
```

**2 — Back up the database before migrating.** The new migration only adds indexes, but
this is the first schema change against live data since the deploy.

```bash
gcloud sql backups create --instance=telestar-db --project telestar-crm-final
```

**3 — Pull and rebuild.** The image is built on the VM from source, so a pull is not enough.

```bash
git pull origin main                   # 59b833a..e6fac30
sudo docker compose build web worker
```

**4 — Apply the migration.** One new migration; it creates indexes only.

```bash
sudo docker compose run --rm web node node_modules/prisma/build/index.js migrate deploy
```

Expect exactly `20260806000000_admin_control_center_indexes` to apply. **If it reports
anything else pending, stop** — the box and the repo have diverged further than expected.
Never run `migrate dev` or `migrate reset` here: `package.json` wires `prisma.seed`, and
`npm run db:seed` has 17 unfiltered `deleteMany()` calls including `tenant` and `user`.

**5 — Restart and verify.**

```bash
sudo docker compose up -d web worker
sudo docker compose ps                 # web, worker, caddy, redis all Up
sudo docker compose logs --tail=50 worker
```

```bash
curl -s http://34.142.236.46/api/health                  # {"ok":true,...}
curl -s http://34.142.236.46/api/cron/sequence-engine \
  -H "Authorization: Bearer $CRON_SECRET"                # {"disabled":true,"sent":0}
```

Then sign in as Director and confirm `/admin` renders the console — that is the whole
point of this deploy. `/admin` returning 404 means the new build did not take.

**6 — Install the crontab, which appears never to have been set up.** The newest `JobRun`
on the box is from 2026-08-04. §7 above has the entries; the maintenance one is new and is
what prunes the audit log.

```bash
sudo crontab -e     # paste the four entries from §7, with the real CRON_SECRET
sudo crontab -l     # verify
```

Watch for the first firing: `sudo docker compose logs -f web | grep cron`.

**7 — Post-deploy gate.** From your machine, not the VM:

```bash
BASE_URL=http://34.142.236.46 E2E_PASSWORD=telestar2026 \
  node node_modules/@playwright/test/cli.js test e2e/crm-journeys.spec.ts e2e/deep-smoke.spec.ts
```

20/20 is the pass mark — that is what it scores locally against this commit. `LOGIN_TIMEOUT`
already widens to 45s when `BASE_URL` is set; do not tighten it.

**Rollback:** `git checkout 649c2b0 && sudo docker compose build web worker && sudo docker
compose up -d`. The migration adds only indexes, so the old build runs against the new
schema without being rolled back.

---

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
