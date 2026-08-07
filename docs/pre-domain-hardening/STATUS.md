# Pre-Domain Hardening — STATUS

> Resume pointer. Read this first, then execute the next unchecked task in
> [`PLAN.md`](./PLAN.md). Tick the box there and update this file when a task lands.

**Current phase:** Milestone B — Reliable delivery
**Next task:** Task 4 — mandatory CI on pull requests
**Blockers:** none. HTTPS/domain blocks nothing in this plan.

> Task 2 (session revocation) is implemented on `fix/session-revocation` but **parked to
> last** by decision on 2026-08-06 — its 26 tests and the sign-out-all UI are outstanding.
> Pick it up after Tasks 4–10.

> **Local DB drift.** `authVersion` was applied to the local database from the Task 2
> branch, but that migration file only exists on that branch. `prisma migrate status` on
> `main` will look out of sync until Task 2 merges. Harmless extra column.

---

## 🔴 Found during Task 1 — the live Director password is published

`telestar2026` is the seeded password for **every** demo user, including `dean@telestar.vn`
(Director). It appears in `CLAUDE.md`, `app/login/page.tsx`, `docs/GCP_DEPLOY.md`,
`docs/CLOUD_RUN_DEPLOY.md` and the e2e specs as `E2E_PASSWORD` — 15 files in a repo whose
GHCR package pulls without authentication.

The live deployment at `http://34.142.236.46` was seeded with those exact credentials and
accepts them today. So the CRM's Director account, on a public IP, over plain HTTP, has a
password anyone can read from the repository.

Mitigating: it is a demo dataset, autosend is off, and the operating restrictions say no real
client data. Not mitigating: a Director can read every tenant's data, transfer work, and now
delete audit rows.

Task 1 stops the *repo* shipping a default going forward — `DEMO_SEED_PASSWORD` has no
default and a random one is generated when unset. It does **not** change what is already on
the live box, because the guard now correctly refuses to reseed a remote database.

**Fix on the box** — change the Director password in place, which needs no reseed:

```bash
npm run create-admin -- --email dean@telestar.vn --password '<new strong password>' --name 'Dean'
```

`create-admin` promotes and updates an existing user without deleting anything. Do the same
for any other account that will be used, or deactivate the unused demo users from `/admin`.

Sequencing note: Task 2 adds `authVersion`, at which point a password change also invalidates
every existing session. Doing that first makes this fix strictly stronger, which is one
argument for taking Task 2 next as planned.

---

## Where things stood when this plan was pinned (2026-08-05)

Live deployment `ee08246` on `http://34.142.236.46` — GCE + Cloud SQL + a `redis:7` container
on the same VM. Admin Control Center shipped. Gates at the time: `tsc` 0 · Vitest 536/536 ·
Playwright 20/20 · `next build` exit 0 · design audit 0 flags in every category.

Already true, so these tasks start from a better place than the plan assumes:

- **Task 4 (CI):** `.github/workflows/docker-image.yml` already builds and pushes on every
  `main` push, and `ci.yml` exists. What is missing is the *mandatory* part — required checks
  and branch protection — plus the Playwright/migration/Docker jobs.
- **Task 5 (immutable images):** CI already publishes `:sha-<7>` next to `:latest`. The tag
  exists; the task is to make it the deployed default and remove the mutable fallback.
  `.env.production` currently sets `IMAGE_TAG=latest`.
- **Task 10 (Redis):** BullMQ, `JobRun` mirroring and the maintenance worker are all in place
  from the runtime-hardening work. Queue *observability* and remote-TLS compatibility are the
  gap.
- **Crons** are installed and firing (`bin/cron-call.sh` on the VM, verified in syslog).
  `CRON_SECRET` was rotated 2026-08-05 after being exposed.

Explicitly blocked, tracked in `docs/DEPLOY.md` → "Open before real client data":

- **HTTPS / TLS.** Still plain HTTP on a bare IP; credentials cross in cleartext.
  `CRM_DOMAIN`, `CADDY_SITE_ADDRESS` and `NEXTAUTH_URL` are the only values needed.
- **Cloud SQL automated backups.** None scheduled; the only snapshot is manual.

---

## Task 1 — findings before starting

`prisma/seed.ts` is worse than `CLAUDE.md` described. Confirmed by reading it:

- **17 unguarded `deleteMany()`**, including `tenant` and `user`, with no environment check
  of any kind.
- It uses a bare `const raw = new PrismaClient()`, which **bypasses the tenant-scoping
  extension in `lib/prisma.ts` entirely** — so the deletes are not tenant-scoped even in
  principle.
- Hardcoded shared password `telestar2026` at `prisma/seed.ts:50`, applied to every seeded
  user. That string is also the demo login in `CLAUDE.md` and `E2E_PASSWORD` in the e2e specs.
- Real-looking `@telestar.vn` addresses for every persona.
- Wired into `package.json` as both `db:seed` **and** `prisma.seed`, so `prisma migrate dev`
  and `prisma migrate reset` invoke it automatically.

The `prisma.seed` wiring is the sharp edge: a routine `migrate dev` against a misconfigured
`DATABASE_URL` wipes the target database with no prompt.

---

## Progress log

- 2026-08-05 — Plan pinned from the pre-domain hardening brief. No code changed yet.

- 2026-08-05 — **Task 1 ✅** (`9908642`). `lib/seed-guard.ts` + 16 tests; `prisma/seed.ts` → `seed-demo.ts`; `prisma.seed` key removed from package.json so `migrate dev`/`reset` can no longer fire it; hardcoded password replaced by `DEMO_SEED_PASSWORD` with a random fallback. Verified by running: refused with no confirmation, on `NODE_ENV=production`, against the live Cloud SQL IP, and against `localhost/telestar_crm`; succeeded against a scratch `telestar_crm_dev`. Vitest 552/552.

---

## Task 3 — inventory before starting (2026-08-06)

Deferred first: the rest of Task 2 (26 tests + the sign-out-all UI) is parked by decision on
2026-08-06 and should be picked up **last**, after Tasks 3–10. The branch is pushed and green
apart from those tests.

Task 3 starts further along than the plan assumes — `OutboundMessage` already exists with
`idempotencyKey String @unique`, `status`, `providerMessageId`, `sentAt` and bounce fields, and
`workers/email.ts` already owns the send lifecycle from the runtime-hardening P4 work. Two real
defects to fix rather than a build from scratch:

**1. The idempotency key is wrong in both directions.** `lib/bullmq/jobOptions.ts` builds it as
`sha256(leadId:accountId:subject)`:

- *False dedup.* Two legitimately different sends that share lead + account + subject — a
  re-enrollment, or a follow-up step reusing a subject line — collide on one key.
  `createOutboundMessage` returns the existing row and the second email is silently never sent.
- *Missed dedup.* The same task retried after a template re-render produces a different subject,
  therefore a different key, therefore a **duplicate delivery**. This is precisely the failure
  Task 3 exists to prevent.

The plan's `manual-task:<taskId>` is deterministic per task and fixes both. Sequence sends need
an equivalent stable key — task id where one exists, otherwise enrollment id + step id. It must
not include any field that can be re-rendered.

**2. `createOutboundMessage` is not atomic.** It does `findUnique` then `create`, so two workers
can both observe "no row" and both create; one then dies on the unique constraint. Should be a
single `upsert` on `idempotencyKey`, followed by a compare-and-set claim
(`updateMany where status='pending'`) to move `pending -> sending` — the same CAS pattern
`lib/admin/campaignMembers.ts` and the task-completion path already use.

Callers to route through the shared service: `lib/workflows/email.ts` (sequence path) and
`app/api/inbox/threads/[id]/reply/route.ts` (manual reply, currently builds its own
`idempotencyKey` from a `uniqueId`).

Also still missing per the plan: a `reconciliation_required` state for ambiguous provider
success, and the reconciliation pass that resolves it. Provider adapters already return a
message id (`GmailAdapter`, `ImapAdapter`), which is what reconciliation would match on.

---

## Task 3 — done (2026-08-07), branch `fix/idempotent-manual-email`

Both defects in the inventory above are fixed, plus a third found while building.

**The key.** `lib/email/idempotency.ts` builds it from durable ids only, prefixed by
source: `manual-task:<taskId>`, `sequence-step:<enrollmentId>:<stepId>`,
`reply:<threadKey>:<requestId>`, `manual-send:<requestId>`. Nothing re-renderable enters
it, so a retry after a template re-render lands on the same key, and two sends sharing a
subject no longer collide. The old `sha256(leadId:accountId:subject)` helper is deleted
from `lib/bullmq/jobOptions.ts`.

Ad-hoc composes and inbox replies have no durable id of their own, so the client sends a
`clientRequestId` (one per open composer, `MailComposerModal`) and the server mints one
when it is absent. That gives no cross-request dedup without a client key, but it cannot
false-dedup — and the worker-side guarantee holds regardless.

**The claim.** `createOutboundMessage` is a single `upsert` with an empty update branch.
`workers/email.ts` then does a CAS — `updateMany where status in (pending, failed)` —
before suppression, quota or the provider, so a losing worker burns nothing. New columns
`claimedAt` and `attemptCount` (migration `20260807000000_outbound_idempotency_claim`,
additive).

**The third defect.** `repairStaleSending` wrote `failed` for a `sending` row with no
provider id. `failed` is claimable, so a message that may already have been delivered was
one manual retry from a second delivery. It now writes `reconciliation_required`, and the
send path treats that status, `sending` and `permanently_failed` as unsendable. An
ambiguous provider error (timeout, socket hang up) goes there too; only errors that prove
non-delivery — SMTP 5xx rejection, auth failure, `ECONNREFUSED`, `ENOTFOUND` — return the
row to the claimable pool. `classifySendFailure` is a pure function with its own tests.

**The reconciliation pass.** New repair type `outbound-reconcile`, in the maintenance
worker and the maintenance cron's default list. Settles a row as `sent` on delivery
evidence (provider id, reply, or bounce); past a 24h grace window with no evidence it
writes `permanently_failed` and notifies the lead's owner. It never resends.

*Known limit, deliberate:* with no provider-side lookup keyed on our own idempotency key,
"no evidence" cannot distinguish a silent delivery from a message that never left — which
is why the fallback is a human decision, not a resend. Matching on a custom message header
would tighten this and needs `send()` to carry headers across all three adapters.

Gates: `tsc --noEmit` 0 · Vitest **592/592** · `next build` exit 0 · eslint unchanged from
the branch point (379 errors / 501 warnings, all pre-existing; CLAUDE.md's "0 errors" note
is stale). Not yet deployed — see the undeployed-commits note above.
