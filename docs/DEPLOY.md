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
`orphan-tasks`, `stale-sending`, `outbound-reconcile`, `stuck-running`, `missing-delayed`,
`reassignment-drift` and `audit-prune`. Narrow it with `?types=audit-prune,orphan-tasks` — unknown names return
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
- [x] Both crons firing. **Confirmed absent, installed and verified 2026-08-05.** `crontab -l`
      on the VM was empty — the schedule had never been set up, which is why the newest
      `JobRun` was `import.commit @ 2026-08-04T13:08Z`. Four entries now run via
      `bin/cron-call.sh`. Verified in `/var/log/syslog`: `sequence-engine` firing on the
      5-minute tick, `email-health` and `inbox-sync` on the hour, all exiting clean.
- [x] Security headers present. *Verified via `curl -I`: `Strict-Transport-Security`,
      `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
      `Permissions-Policy`. **HSTS is inert until TLS lands** — a browser only honours it
      over HTTPS.*
- [x] Email sending decision made. *Verified: `GET /api/cron/sequence-engine` returns
      `{"disabled":true,"sent":0}` — `SEQUENCE_AUTOSEND_ENABLED` is off.*

### Open before real client data

- **`CRON_SECRET` — rotated and verified 2026-08-05. Closed.** The earlier value was exposed
  in full: it had been pasted into a crontab line, and `crontab -l` then printed it. It has
  been replaced with a fresh `openssl rand -hex 32` value, and the crontab now calls
  `bin/cron-call.sh`, which reads the secret from `.env.production` at run time so it never
  appears in a crontab line or in `crontab -l` output again.

  Verified end to end: `./bin/cron-call.sh email-health` returns clean, and `/var/log/syslog`
  shows the schedule firing — `sequence-engine` on the 5-minute tick, `email-health` and
  `inbox-sync` on the hour.

  > Do not set this to `telestar2026` or any variant. That string is the seeded demo-account
  > password and appears in `CLAUDE.md`, this file, and `e2e/*.spec.ts` as `E2E_PASSWORD` —
  > i.e. it is published. Nobody types this secret by hand; the wrapper reads it from the
  > file, so there is no convenience gained by making it memorable.

- **TLS (UX-001) — still open.** Credentials cross the network in cleartext today. `CRM_DOMAIN`
  and `CADDY_SITE_ADDRESS` in `.env.production` are the only two values that need to change,
  plus `NEXTAUTH_URL`; Caddy provisions the certificate itself. No code change.

Also worth doing whenever convenient: **enable Cloud SQL automated backups.** As of
2026-08-05 `gcloud sql backups list` returned a single row — the manual snapshot taken
before that day's migration. There is no schedule.

---

## 8b. Redeploying the live GCE box

> ### ⚠️ The box's checkout is stale — read before using `scripts/deploy.sh`
>
> Discovered while deploying `9ca7e6b` on 2026-08-08. `/opt/crm-4-u` on `telestar-crm-vm` is
> a checkout from **before** Task 5, so the tooling described in this section is not what is
> actually there:
>
> | | On the box | In this repo |
> | --- | --- | --- |
> | `docker-compose.yml` image | `…:${IMAGE_TAG:-latest}` | `${CRM_IMAGE:?…}` |
> | `scripts/deploy.sh` / `rollback.sh` | not in use | present since `b64797b` |
>
> Consequences, until someone updates that checkout:
>
> - **`scripts/rollback.sh` is not available.** Roll back by editing `IMAGE_TAG` in
>   `.env.production` to the previous full-SHA tag and re-running the compose command in
>   *"The exact command that works on this box"* below — a bare `up -d` fails on this checkout.
> - **`deployments.ndjson` is not being written**, so there is no machine-readable history.
>   Records go here instead.
> - The box's compose file resolves `IMAGE_TAG`, and **ignores `CRM_IMAGE` entirely** — so
>   running `deploy.sh` there today would set a variable nothing reads and leave `:latest`
>   serving.
>
> Updating the checkout is not a no-op: the repo's compose file *refuses to start* without
> `CRM_IMAGE`, so `IMAGE_TAG` must be replaced with a `CRM_IMAGE` digest in the same change.
> Do it deliberately, not mid-incident.

### The exact command that works on this box

Written down because it is not obvious and getting it wrong fails in a way that leaves the box
half-changed. The box's compose declares `env_file: ${APP_ENV_FILE:-.env.docker}` across two
files, and `.env.docker` **does not exist there** — so the plain `docker compose up -d` in the
sections below does not work on this checkout:

```
env file /opt/crm-4-u/.env.docker not found
```

All three pieces are required — both compose files, `APP_ENV_FILE`, and `--env-file`:

```bash
cd /opt/crm-4-u
sudo APP_ENV_FILE=.env.production docker compose   -f docker-compose.yml -f docker-compose.aws.yml   --env-file .env.production   up -d --no-deps web worker
```

`--no-deps` matters: the base compose still defines a local `postgres` service this box does not
use (the database is Cloud SQL), and without it compose may start one.

**Check the resolution before applying it.** `config --images` changes nothing and prints what
compose actually resolved, which is the only way to know the invocation is right before it
touches anything running:

```bash
sudo APP_ENV_FILE=.env.production docker compose   -f docker-compose.yml -f docker-compose.aws.yml   --env-file .env.production config --images
```

> **The failure mode to know about.** If you edit `IMAGE_TAG` and *then* the compose command
> fails, `.env.production` names the new image while the old containers keep running. The site
> is fine, but the next person to run compose — or a reboot — silently applies an unverified
> deploy. Either finish or revert the tag; do not stop in between. This happened during the
> `68acd49c` deploy below and is why the dry run above is now part of the procedure.

The `POSTGRES_PASSWORD is not set` warnings are expected and harmless — they come from the
unused local `postgres` service definition.

### Deployment record — 2026-08-09, `68acd49c`

Playwright deep audit: four fixed defects. Performed manually via the command above.

| | |
| --- | --- |
| Commit | `68acd49c71b4e2df50908903f7ec7ed82239f234` (PR #45) |
| Digest | `sha256:264e94a14ee9aaeae808995f1de2a936e0086141380c55c3f4082b4e0445af8e` |
| Previous commit | `9ca7e6bfc1eaf935d6c17df99c7560f7a5f73437` |
| Migrations applied | **none** — schema untouched, code-only deploy |
| Cloud SQL backup | not taken; no migration ran, and rollback is a tag change with no schema delta |
| Rollback | `IMAGE_TAG=9ca7e6bfc1eaf935d6c17df99c7560f7a5f73437`, then the same `up -d --no-deps web worker` |

What shipped: `/api/automation/accounts/[id]/cap` authorizing from the raw JWT instead of the
database; sign-out not ending the session; the public client-report share link being entirely
non-functional in production; and a campaign creatable against another tenant's client.

Verified after the swap: `/api/health` reported the deployed commit `68acd49c71b4…`; `web` and
`worker` on the **same** digest `sha256:264e94a1…`; `/login` 200 and `/admin` 307; all seven
worker queues registered; no errors in the web log. Outbound email confirmed off at the source
of truth — `EMAIL_SEND_DRY_RUN=true` and `SEQUENCE_AUTOSEND_ENABLED=false` read from **both**
running containers' environments.

> One check did not produce evidence and is recorded as such rather than as a pass: probing
> `/api/cron/sequence-engine` with a bearer token assembled from `.env.production` returned
> `{"error":"Unauthorized"}`, most likely because the value is quoted or padded and the naive
> `cut -d=` extraction produced the wrong token. It says nothing either way about the safety
> switch — the container environment above is the direct evidence, and it is unambiguous.

**Behavioural change in this release:** signing out now bumps `User.authVersion`, which is per
user rather than per session, so signing out ends that user's sessions on every device. Existing
sessions were *not* invalidated by the deploy itself.

### Deployment record — 2026-08-08, `9ca7e6b`

Performed manually (the scripted path was unavailable, see above) and verified end to end.

| | |
| --- | --- |
| Commit | `9ca7e6bfc1eaf935d6c17df99c7560f7a5f73437` |
| Digest | `sha256:7759b952c790ad7407d4cf797b676f07dabbd14f0b2d73f52c88d00b865fd743` |
| Previous commit | `ee0824639ed84288ff611da2065cd4bb4c60ccde` (digest `sha256:3aee2baa24a46ba2d9549728a388bab8cd5a374b2e5fd884757b77783af42d28`) |
| Migrations applied | `20260806100000_add_user_auth_version`, `20260807000000_outbound_idempotency_claim` (22 → 24) |
| Cloud SQL backup taken first | id `1786206208157`, 2026-08-08T16:23:28Z, `SUCCESSFUL` |
| Rollback | `IMAGE_TAG=ee0824639ed84288ff611da2065cd4bb4c60ccde` then `up -d` — both migrations are additive, so `ee08246` runs against the new schema |

Verified after the swap: `/api/health` reported `ok:true`, `schema:"ready"` and the deployed
commit; the worker logged `[bullmq] Redis connected` with all seven queues registered (the
first real-world confirmation of ioredis 6 / RESP3); sign-in succeeded on next-auth
beta.32.

**The Director password was rotated in the same window.** `create-admin` failed first with
`tsx: not found` — the production image did not contain tsx; see the fix in the commit that
moved it to `dependencies`. Worked around with `npx --yes tsx`. Session revocation was then
confirmed the only way that counts: an already-open Director session was refused on its next
request, and both the old password and an accidentally-set intermediate value were rejected
at sign-in.

**Still outstanding on that box:** every other demo account retains the published
`telestar2026`, and the site is plain HTTP, so credentials cross in cleartext.

---

**Verified end to end on 2026-08-05 deploying `ee08246`.** An earlier draft of this section
was written from the deployment record and got two things materially wrong; both are
corrected below.

### The two corrections

**The image is pulled from GHCR, not built on the box.** `.github/workflows/docker-image.yml`
publishes `:latest`, `:sha-<7>` and the full-SHA tag — but only after CI has concluded
successfully, so a red build ships nothing. `web` and `worker` both run
`${CRM_IMAGE:?…}`, which has no default and must be a digest or a full-SHA tag. So the
deploy is `pull`, never `build` — `docker-compose.build.yml` is an optional overlay that is
*not* what runs. The deployment record's "built on the VM from source" was stale.

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
cd /opt/crm-4-u
git pull origin main && git log --oneline -1 && git status --short
./scripts/deploy.sh
```

That is the whole deploy. `scripts/deploy.sh` prompts for the Cloud SQL backup, resolves
the image for `HEAD` **to a digest**, migrates with that image, pins `.env.production` to
it, restarts `web` and `worker`, runs the post-deploy smoke test, and appends a record to
`deployments.ndjson`. Pass a full 40-character SHA to deploy a specific commit.

> **`IMAGE_TAG=latest` is gone and `docker compose up -d` no longer works on its own.**
> `docker-compose.yml` uses `${CRM_IMAGE:?…}` with no default, so compose refuses to start
> without an exact reference. That is deliberate: `:latest` meant two `up -d` runs a week
> apart could start different code with nothing recording the change, and `web` and
> `worker` could silently end up on different builds.

The manual equivalent, if you need to do it by hand:

```bash
# 0 — shorthand, since every command repeats it
cd /opt/crm-4-u
DC="sudo docker compose --env-file .env.production -f docker-compose.yml -f docker-compose.aws.yml"

# 1 — back up. NOTE: run this from Cloud Shell, not the VM. The VM's service account
#     lacks the sqladmin scope and fails with ACCESS_TOKEN_SCOPE_INSUFFICIENT.
gcloud sql backups create --instance=telestar-db --project=telestar-crm-final
gcloud sql backups list  --instance=telestar-db --project=telestar-crm-final --limit=3

# 2 — resolve the commit's image to a digest. If the tag does not resolve, CI did not
#     publish it, which means CI did not pass. Do not reach for :latest.
SHA=$(git rev-parse HEAD)
sudo docker pull ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final:$SHA
DIGEST=$(sudo docker inspect --format '{{index .RepoDigests 0}}' \
  ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final:$SHA | sed 's/.*@//')
echo "$DIGEST"

# 3 — pin it, keeping the digest it replaces so rollback needs no lookup.
#     CRM_IMAGE=ghcr.io/sonnynguyen170321-ctrl/crm-4-telestar-final@$DIGEST
#     PREVIOUS_CRM_IMAGE=<whatever CRM_IMAGE was>

# 4 — what is pending? read-only.
$DC run --rm --no-deps web node node_modules/prisma/build/index.js migrate status

# 5 — apply. NEVER `migrate dev` or `migrate reset` here — the demo seed deletes every
#     tenant and user. (Since 9908642 the seed guard also refuses a remote database.)
$DC run --rm --no-deps web node node_modules/prisma/build/index.js migrate deploy

# 6 — swap the containers. Name the services: a bare `up -d` also starts the unused
#     postgres service and needlessly recreates caddy and redis.
$DC up -d web worker
$DC ps --format 'table {{.Name}}\t{{.Image}}\t{{.Status}}'
```

### Verify

```bash
DEPLOYED_COMMIT=$(git rev-parse HEAD) BASE_URL=http://34.142.236.46 \
  ./scripts/post-deploy-smoke.sh
```

Six checks: `/api/health` ok, **the commit web reports matches the one deployed**, `/admin`
redirects rather than 404s, `/login` renders, **`web` and `worker` are the same image
digest**, and the worker registered its queues. `/api/health` now returns `commit`,
`version` and `builtAt`, baked into the image at build time — so it describes what is
actually running, not what a tag currently points at.

Then the post-deploy gate, **from a workstation, not the VM**:

```bash
BASE_URL=http://34.142.236.46 E2E_PASSWORD='<run-scoped>' \
  node node_modules/@playwright/test/cli.js test e2e/crm-journeys.spec.ts e2e/deep-smoke.spec.ts
```

> **`E2E_PASSWORD=telestar2026` is refused** — `e2e/support/fixture.ts:67` rejects the published
> demo password, so every persona fails auth setup and the run reports failures that look like a
> broken deployment. Seed a run-scoped fixture first:
> `ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='<run-scoped>' node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts`
> (additive and idempotent — no `deleteMany`, namespaced to `pw-audit` / `@audit.test`).

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
cd /opt/crm-4-u && ./scripts/rollback.sh
```

Deploys `PREVIOUS_CRM_IMAGE`, which `scripts/deploy.sh` wrote on the last deploy — so a
rollback needs no registry lookup, no checkout and no rebuild. Pass a digest explicitly to
go somewhere else; the script refuses any reference that is not a digest or a full-SHA tag.
It also sets `PREVIOUS_CRM_IMAGE` to the image it just rolled off, so a bad rollback is
itself reversible, and it appends a `"kind":"rollback"` record.

**Migrations are not reversed.** Compare the `migration` field of the last two entries in
`deployments.ndjson` before rolling back across a schema change; if the older image cannot
run against the newer schema, restore the Cloud SQL backup instead. The `20260806000000`
migration only creates indexes and `20260807000000` only adds nullable/defaulted columns,
so both are safe to roll back across today.

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

  > **2026-08-14:** `scripts/verify-rls.mjs` now covers the AI, learning and sequence models as
  > well — `Meeting`, `Opportunity`, `CampaignPlaybook`, `PlaybookProposal`, `OutcomeSignal`,
  > `SequenceEnrollment` and `SequenceStepCopy` — and runs as a **required CI check**. 14 checks,
  > against a throwaway database, connected as a non-superuser. `SequenceStepCopy` matters most:
  > it holds approved prospect-facing wording, so a leak there discloses another tenant's outreach
  > copy rather than a name and a company.
  >
  > ⚠️ **RLS-enabled deployments must reapply `supabase/rls.sql` after every Prisma migration
  > that adds a table.** Prisma migrations deliberately contain no `ENABLE`/`FORCE ROW LEVEL
  > SECURITY` and no `CREATE POLICY` — a migration-authored policy would vanish the moment
  > someone regenerated that migration from the datamodel, and the same statements would then
  > break every non-RLS deployment. `rls.sql` derives its table list from the catalog (every
  > table carrying a `tenantId` column), so reapplying it is what brings new tables under
  > `tenant_isolation`. It is idempotent — rerunning is always safe.
  >
  > ```bash
  > node node_modules/prisma/build/index.js migrate deploy
  > psql "$DIRECT_URL" -f supabase/rls.sql      # required on RLS-enabled deployments
  > ```
  >
  > Until it is reapplied, a newly migrated table has **no** database-level policy and is
  > protected only by the application layer. `node scripts/verify-rls.mjs` proves enforcement
  > against a throwaway database and a non-superuser role.
