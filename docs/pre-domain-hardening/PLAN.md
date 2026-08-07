# Pre-Domain Hardening — PLAN

Complete every application, security, database, email, CI and deployment hardening item that
does **not** depend on the production domain. HTTPS and the domain remain blocked; everything
here can land before them.

Resume pointer: [`STATUS.md`](./STATUS.md). Tick the box here and update `STATUS.md` when a
task lands.

---

## Operating restrictions — in force for the whole phase

The system stays in controlled testing mode until HTTPS and credential rotation are done.

- No external users onboarded.
- No sensitive client or production data entered.
- Live sequence email sending stays **off** (`SEQUENCE_AUTOSEND_ENABLED=false`).
- Automated email stays in dry-run (`EMAIL_SEND_DRY_RUN=true`).
- Do not hand out `http://34.142.236.46` as a production URL.
- Do not reuse any password typed into the current HTTP environment.
- Manual Cloud SQL backup before **every** migration.
- Never run `prisma migrate reset` or a destructive seed against a remote database.

---

## Milestone A — Immediate safety

### [x] Task 1 — Protect the database seed  ✅ 9908642

Stop the demo seed from deleting data in production, staging, Cloud SQL or any remote DB.
Branch: `fix/protect-destructive-seed`.

Split into `prisma/seed-demo.ts`, `prisma/seed-test.ts`, `scripts/create-admin.ts`, keeping
production account creation separate from demo data. Guard **before** constructing the Prisma
client or issuing any delete. Refuse when: `NODE_ENV=production`; `DATABASE_URL` points at
Cloud SQL; the host is not local; or the database name lacks `dev`/`development`/`test`/`local`.
Require `ALLOW_DESTRUCTIVE_SEED=I_UNDERSTAND_THIS_DELETES_ALL_DATA`. Print environment, host and
database name before running. Replace `@telestar.vn` addresses with `*@example.test`. Remove the
shared published password — take one from the developer or generate at runtime. Ensure no
`migrate deploy`, `npm run build` or `npm start` path can trigger it.

*Tests:* local seed succeeds with the confirmation var; fails without it; fails on
`NODE_ENV=production`; fails on a Cloud-SQL-shaped host; fails on any remote host; fails on an
unapproved database name; `create-admin` adds one admin without deleting anything.

*Done when:* no normal production command can trigger destructive seeding, no reusable demo
password remains in the repo, and production bootstrap is non-destructive.

### [ ] Task 2 — Invalidate stale JWT sessions

Revoke access immediately on deactivation, demotion, tenant move or password reset.
Branch: `fix/session-revocation`.

Add `authVersion Int @default(1)` to `User`. Back up Cloud SQL before applying. Carry
`userId`, `tenantId`, `role`, `authVersion` in the token. Every protected request revalidates
against the database: user exists, is active, tenant matches, `authVersion` matches — and
authorizes on the **database** role, never the token's. Increment `authVersion` in the same
transaction as: password change, admin reset, deactivate, reactivate, role change, tenant
change, and a new "Sign out all sessions" admin action. Return `401` without disclosing which
condition failed; redirect stale browser sessions to `/login`.

*Tests:* active user works; deactivated loses access immediately; demoted director loses
director rights; password reset kills old sessions; reactivation does not restore an old
session; deleted user rejected; cross-tenant token rejected; old token fails after
`authVersion` bumps; API and page protection agree.

*Done when:* security-sensitive changes invalidate sessions immediately and protected APIs
authorize from current database state.

### [x] Task 3 — Make manual email sending idempotent  ✅

One CRM task must produce at most one delivered email, even across crashes.
Branch: `fix/idempotent-manual-email`. Keep real sending disabled while building this.

Route manual and sequence-triggered sends through one service. Deterministic key
`manual-task:<taskId>`, unique-constrained. Upsert `OutboundMessage` **before** calling the
provider, storing tenant/lead/task/account/recipient/subject/body/key/status/attemptCount/
providerMessageId/sentAt/lastError. Claim with an atomic conditional update; only one worker
may move `queued -> sending`. Skip when already `sent`, `permanently_failed` or claimed.
Persist `providerMessageId` + `sentAt` + `status=sent` after success, and only then complete
the task. On ambiguous provider success use a `reconciliation_required` state and a
reconciliation pass — never a blind resend. Count quota once; one audit event per delivery.
Dry-run follows the identical path without contacting the provider.

*Tests:* two workers race the same task; crash before provider call; provider rejects;
provider accepts and DB write succeeds; **provider accepts and DB write fails**; restart while
`sending`; cron runs twice; manual retry; counters not double-counted; audit not duplicated.

*Key acceptance:* fake provider records delivery, then simulate a DB failure after provider
success, then process the task again — the provider send must have been called exactly once.

*Done when:* repeated processing cannot duplicate delivery, ambiguity triggers reconciliation,
and manual and automated sends share one durable pipeline.

---

## Milestone B — Reliable delivery

### [ ] Task 4 — Mandatory CI on pull requests

Branch: `ci/mandatory-quality-gates`. Workflow on `pull_request` and `push` to `main`, using
the same Node major as the production image. Jobs: install, `prisma generate`, `tsc --noEmit`,
ESLint, Vitest, production build, Docker build, Playwright, migration validation. Postgres and
Redis service containers, dedicated test database. Add timeouts; cancel superseded runs; upload
Playwright screenshots/traces/reports on failure. Add secret scanning, dependency review, code
scanning. **Pin third-party actions to commit SHAs, not tags.** Keep validation separate from
publishing — publish an image only after required tests pass.

Branch protection on `main`: require PRs, ≥1 approval, CI checks, resolved conversations;
block force pushes, deletion and direct pushes.

*Verify:* a TypeScript error, a failing unit test, a failing Playwright test and a failing
Docker build each block merge; a failed commit publishes no image; direct push to `main` is
rejected.

### [ ] Task 5 — Immutable release images

Branch: `deploy/immutable-images`. Tag every image with the full Git SHA (optionally a
`v1.0.0` release tag that is never overwritten). Capture the digest at publish. Deploy by
`:<full-git-sha>` or `@sha256:<digest>`, with web and worker pinned to the **same** digest.
Label images with commit, repo URL, build timestamp, release version. Record every deployment:
commit, digest, migration version, timestamp, operator, previous digest. Keep at least one
known-good prior digest. Add a post-deploy smoke test. Make the production Compose file stop
defaulting to `latest` and require an explicit image reference.

*Verify:* web and worker report the same commit; running digest matches the record; redeploying
a digest is byte-identical; a previous digest restores in staging; a failed deploy rolls back
without rebuilding.

> Current state: `docker-compose.yml` uses `${IMAGE_TAG:-latest}` and `.env.production` sets
> `IMAGE_TAG=latest`. CI already publishes `:sha-<7>` alongside `:latest`, so the tag exists —
> this task makes it the default and removes the mutable fallback.

---

## Milestone C — Defense in depth

### [ ] Task 6 — Prepare and validate PostgreSQL RLS

Branch: `security/tenant-rls`. **Do not force-enable RLS in production before inventory, tests
and staging validation.**

Inventory every model with `tenantId`, and every use of `new PrismaClient()`, `$queryRaw`,
`$executeRaw`, `BYPASS_RLS`, `app.bypass_rls`, `app.current_tenant_id`. Confirm a policy on
every tenant-owned table and that the application role cannot bypass it. Separate database
roles for application queries, migrations, approved maintenance and approved cross-tenant jobs.

Test with two tenants and two users across users, leads, campaigns, tasks, opportunities,
meetings, mailboxes, outbound messages, audit logs, sequence enrollments and job records:
direct lookup by another tenant's id, cross-tenant update and delete, cross-tenant FKs,
background jobs with explicit tenant context, and missing context failing **closed**. Run the
suite with `DB_RLS_ENFORCED=true`; enable in staging first.

*Product decision to record:* user email globally unique, or unique per tenant? Enforce with the
matching constraint.

### [ ] Task 7 — Login throttling

Branch: `security/login-throttling`. Normalize emails before counting. Track failures by IP, by
normalized email, and by the pair. Shared state in Redis. Progressive delay, then a temporary
lock. Identical error whether or not the account exists. Reset on success. Audit repeated
failures without logging credentials. Alert on credential-stuffing patterns. **One IP must not
be able to lock every account, and one attacker must not be able to deny service globally.**

*Tests:* normal login; delay after several failures; blocking after more; identical responses
for known and unknown emails; success clears state; Microsoft OAuth unaffected; limits shared
across instances.

### [ ] Task 8 — Content Security Policy

Start in `Content-Security-Policy-Report-Only`. Inventory required origins for scripts, styles,
images, fonts, API, OAuth, frames. Define `default-src`, `script-src`, `style-src`, `img-src`,
`font-src`, `connect-src`, `frame-ancestors`, `base-uri`, `form-action`, `object-src`. Set
`object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'` unless a need is shown. Avoid
`unsafe-eval`; remove `unsafe-inline` where practical using nonces or hashes. Collect reports,
exercise every route, fix real violations, then switch to enforcement **with the domain deploy**.

### [ ] Task 9 — Private security reporting

Update `SECURITY.md`: supported versions, GitHub private vulnerability reporting (enable it
now), a monitored security mailbox once the domain exists, and an instruction not to file
exploitable findings publicly. Ask for affected feature, reproduction, impact, evidence and
suggested mitigation. Define an acknowledgement window, an incident owner, and escalation for
credential exposure, cross-tenant access, unauthorized email, database loss and RCE.

---

## Milestone D — Infrastructure readiness

### [ ] Task 10 — Prepare managed Redis migration

Branch: `infra/managed-redis`. Inventory every queue and worker with name, producer, consumer,
retry policy, timeout, concurrency, business impact if lost, and recovery source. Confirm
durable database records back every business-critical job. Add queue metrics (waiting, active,
delayed, failed, oldest job age, worker heartbeat) and expose them. Make `REDIS_URL` accept
`redis://` and `rediss://` with auth and TLS options; drop any assumption Redis is on the local
Compose network. Fail clearly and loudly when Redis is unreachable; add bounded reconnect.
Test recovery after worker restart, web restart, transient disconnect, job timeout and
duplicate enqueue. Build a provider checklist (version, TLS, persistence, private networking,
memory, eviction, failover, backups, monitoring, cost) and require an eviction policy that will
not silently drop BullMQ keys.

---

## Pull request requirements

Every PR carries: problem statement · security/operational impact · implementation summary ·
files changed · migration details · env-var changes · automated tests · manual verification ·
deployment steps · rollback steps · known limitations.

Do not merge unless TypeScript, ESLint, Vitest, Playwright (where applicable), the production
build and the Docker build all pass, migrations have been reviewed, and no secret is committed.

---

## Pre-domain completion gate

- [x] Production data cannot be destroyed by the demo seed
- [ ] Deactivated or demoted users immediately lose access
- [x] Email processing cannot blindly send duplicates
- [ ] PRs cannot merge without mandatory checks
- [ ] Deployments use exact image versions
- [ ] Cross-tenant isolation tests pass
- [ ] Login attempts are throttled
- [ ] CSP is ready for enforcement
- [ ] Vulnerabilities can be reported privately
- [ ] BullMQ is ready for persistent remote Redis
- [ ] Live email sending still disabled
- [ ] HTTPS and automated backups tracked as explicitly blocked
