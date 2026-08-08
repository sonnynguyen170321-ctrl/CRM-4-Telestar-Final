# Pre-Domain Hardening — STATUS

> Resume pointer. Read this first, then execute the next unchecked task in
> [`PLAN.md`](./PLAN.md). Tick the box there and update this file when a task lands.

**Current phase:** Milestone C — Defense in depth
**Next task:** Task 6 — prepare and validate PostgreSQL RLS
**Blockers:** none.

> ⚠️ **`main` is protected as of 2026-08-08. You can no longer push to it.** Every change —
> including documentation — goes through a branch and a pull request, and cannot merge until
> `CI required checks` is green. This applies to the repository owner too (`enforce_admins`
> is on). Tasks 1, 3, 4 and 5 were merged locally before this; everything after is a PR.

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

---

## Task 4 — workflows done (2026-08-07), branch `ci/mandatory-quality-gates`

### 🔴 CI has been red since Task 1 merged, and nobody saw it

`ci.yml` ran `npm run db:seed` against a database named `telestar_crm`. Task 1's guard
refuses any database name without `dev`/`development`/`test`/`local` in it, so that step
has failed on every run since `9908642`. Verified by calling the guard directly:

```
old CI name REFUSED: Database name "telestar_crm" does not contain any of: dev,
development, test, local.
```

This is exactly the failure mode Task 4 exists to end — a check nothing depends on stops
being a check. The CI database is now `telestar_crm_test`, which the guard accepts, and
the seed runs with `ALLOW_DESTRUCTIVE_SEED` plus a `DEMO_SEED_PASSWORD` minted per run
(`openssl rand -hex 24`) that also becomes `E2E_PASSWORD`. No password is committed.

### What the workflow now runs

Eight jobs, every one with a timeout, every third-party action pinned to a commit SHA:

| Job | Gate |
| --- | --- |
| `quality` | `npm ci`, `prisma generate`, `migrate deploy`, lint, `tsc --noEmit`, Vitest — Postgres + Redis services |
| `migrations` | `migrate diff --exit-code` against an empty shadow DB: replays every migration from scratch **and** fails on schema drift |
| `e2e` | seed, production build, `npm start`, Playwright (`crm-journeys` + `deep-smoke`) against the built app; artifacts uploaded on failure |
| `docker` | image builds (validation only, no push) |
| `secret-scan` | gitleaks over full history |
| `dependency-review` | PR only, fails on high severity |
| `codeql` | JavaScript/TypeScript analysis |
| `ci-required` | aggregate — the single check to require in branch protection |

`ci-required` uses `if: always()` with an explicit result test, because a `needs` job that
is skipped or cancelled otherwise reports success and waves the merge through.

gitleaks runs through its Docker image rather than `gitleaks-action`, which requires a paid
licence key for organisation-owned repositories and would start failing the day this repo
moves into an org.

### Publishing is now gated

`docker-image.yml` no longer triggers on push to `main`. It triggers on `workflow_run` of
CI **concluding successfully**, and checks out `workflow_run.head_sha` — the commit CI
actually validated, not whatever `main` points at by then. A failing commit on `main` now
produces no image at all. It also tags the full SHA and records the pushed digest in the
job summary, which is what Task 5 needs to deploy by digest.

### Verified locally

- Both workflows parse; all 9 jobs carry timeouts; zero unpinned actions.
- Seed guard accepts `telestar_crm_test`, refuses `telestar_crm`, refuses without the
  confirmation variable.
- `migrate diff --exit-code` against a fresh shadow database: **`No difference detected.`**
  — the migration history and `schema.prisma` agree, including Task 3's migration.
- `next.config.ts` sets no `output: 'standalone'`, so the `npm start` the e2e job uses is
  the same command the container's `CMD` runs.

**Not verified:** the `e2e` job itself. Rehearsing it locally would need `.env` repointed
at a scratch database, and editing the developer `.env` to prove a CI job works is a bad
trade. Watch its first run on GitHub before requiring it.

### Outstanding — branch protection is not applied

`gh` is not installed on this machine (`gh auth status` → `command not found`), and branch
protection is GitHub-side configuration, not repository content. **Until it is applied CI
is advisory: it reports, it does not block.** The ruleset, the single check to require,
which two jobs to hold back (`CodeQL` and `Dependency review` need a public repo or GHAS),
and the five break-it verifications are in [`docs/BRANCH_PROTECTION.md`](../BRANCH_PROTECTION.md).

Note this changes the working loop: Tasks 1 and 3 were merged straight into `main` locally.
Requiring pull requests stops that.

---

## Task 5 — done (2026-08-07), branch `deploy/immutable-images`

### The mutable default is gone, and compose now refuses to guess

`docker-compose.yml` declared `image: …:${IMAGE_TAG:-latest}`. Both `web` and `worker`
inherit that one anchor, so the tag was the only thing deciding what ran — and `:latest` is
mutable. Two `up -d` runs a week apart could start different code with nothing recording
the change, and a `worker` restarted on a newer `:latest` than `web` produces symptoms that
all look like application bugs.

It is now `${CRM_IMAGE:?<message>}` — **no default**. Compose exits with that message
rather than starting anything. `CRM_IMAGE` must be a digest (`…@sha256:…`) or a full
40-character SHA tag; `prod-check-env` rejects anything else, including the `:sha-<7>` tag
CI also publishes (7 hex characters is a poor primary key for a deployment, and a short tag
can be repointed).

`IMAGE_TAG` is gone from `.env.production.example`, `.env.docker.example`, `AWS_DEPLOY.md`,
`DOCKER_DEPLOY.md`, `GCP_DEPLOY.md` and `DEPLOY.md`.

### A container can now say what it is

`APP_COMMIT`, `APP_VERSION` and `APP_BUILT_AT` are build args baked into the runner stage as
both env vars and OCI labels. `lib/release.ts` reads them; `/api/health` returns
`commit`/`version`/`builtAt`; the worker logs its release on boot. The default is the
literal `unknown`, which `lib/release.ts` treats as *absent* — a locally built image cannot
masquerade as a release.

The publish workflow passes the build args, adds `org.opencontainers.image.version`
(a `git describe --exact-match` release tag when the commit has one, else the commit), and
tags the full SHA alongside `:latest` and `:sha-<7>`.

### Deploying, rolling back, and the record

- **`scripts/deploy.sh`** — prompts for the Cloud SQL backup, resolves the commit's tag to
  a digest **once**, migrates using that same image, pins `.env.production` to it while
  keeping the replaced digest in `PREVIOUS_CRM_IMAGE`, restarts `web` and `worker`, runs
  the smoke test, and appends a record. Refuses a commit with no published image — which is
  also the CI check, since nothing is published unless CI passed.
- **`scripts/rollback.sh`** — deploys `PREVIOUS_CRM_IMAGE`, so a rollback needs no lookup,
  no checkout and no rebuild. Refuses any non-immutable reference. Sets
  `PREVIOUS_CRM_IMAGE` to the image it rolled off, so a bad rollback is itself reversible.
  Warns that migrations are **not** reversed and points at the backup.
- **`deployments.ndjson`** — append-only, one JSON object per line: timestamp, commit,
  digest, image, previous image, latest migration, operator. Gitignored, because the VM is
  a git checkout and a tracked file there would conflict on every `git pull`.

### `scripts/post-deploy-smoke.sh` — six checks

`/api/health` ok · **web reports the commit that was deployed** · `/admin` redirects rather
than 404s · `/login` renders · **`web` and `worker` are the same image digest** · the worker
registered its queues. Read-only, safe to run any time.

### Verified

`tsc --noEmit` 0 · Vitest **607/607** (15 new in `tests/release.test.ts`) · `next build`
exit 0 · `npm run lint` 0 errors · all three shell scripts pass `bash -n`.

The config assertions in `tests/release.test.ts` are deliberate: this task's regression
surface is a YAML default someone re-adds for convenience, so the tests read
`docker-compose.yml` and `.env.production.example` directly and fail on `:latest`, on a
per-service `image:` key, and on a missing `CRM_IMAGE`. Note js-yaml does not apply `<<:`
merge keys — the test asserts neither service declares an image of its own, which is the
stronger statement anyway. `js-yaml` was promoted from transitive to an explicit
devDependency so that test cannot break on a lockfile change.

**Not verified:** anything requiring Docker or the VM — no Docker on this machine. The
scripts are syntax-checked, not executed. First real deploy should be watched.

---

## Task 4 — complete (2026-08-08). Branch protection is live.

### The protection, read back from the API

| Setting | Value |
| --- | --- |
| Required status check | `CI required checks` |
| Strict (branch up to date) | true |
| `enforce_admins` (no bypass) | **true** |
| Pull request required | true |
| Required approvals | **0** — see below |
| Conversation resolution | true |
| Force pushes / deletions | blocked |

**0 approvals, not the plan's ≥1.** GitHub does not allow approving your own pull request,
so ≥1 plus `enforce_admins` on a single-maintainer repository leaves `main` permanently
unmergeable — the only escape being to weaken `enforce_admins`, which makes the rule
advisory for the person most able to bypass it. Everything that actually protects `main` is
absolute for everybody: no direct pushes, no merging a red build, no force pushes, no
deletion. Raise to 1 the day a second person has write access; it is a one-field change.
(GitHub suggests `BrandNg` as a reviewer, so that day may already be here.)

Proven, not assumed — pushing to `main` as the repository owner:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Changes must be made through a pull request.
remote: - Required status check "CI required checks" is expected.
! [remote rejected] main -> main (protected branch hook declined)
```

PR #11 (Task 5) was then merged **through** the gate rather than around it.

### The publish gate, as a truth table

Observed live, not contrived:

| Commit | CI | Docker Image |
| --- | --- | --- |
| `39fb980` — old workflow | ❌ failure | ✅ **published from a red build** |
| `64d50b4` — new workflow | ❌ failure | ⏭️ **skipped** |
| `9cfe82b` — new workflow | ✅ success | ✅ published |

The first row is the hole Task 4 closed, and it was live until 2026-08-07.

### What getting CI green actually turned up

Three real defects, none of them CI plumbing:

1. **CI had been failing on every run since Task 1 merged** (`9908642`). `ci.yml` seeded a
   database named `telestar_crm`; the seed guard refuses any name lacking
   dev/development/test/local. Nothing depended on the result, so nobody noticed — the exact
   failure this task exists to end. The CI database is now `telestar_crm_test`.

2. **Two suites inherited seeded state from developer machines.** `bullmq.test.ts` and
   `run-now-immediate.test.ts` wrote tenant-scoped rows but nothing created the `Tenant`,
   giving `Foreign key constraint violated: JobRun_tenantId_fkey` on a fresh database.
   `rls.test.ts` took `user.findFirst()` / `campaign.findFirst()` — whichever rows happened
   to exist — so it passed on a seeded workstation, failed on CI, and silently tested against
   a different user on every machine. Both now provide their own preconditions
   (`tests/setup/db-baseline.ts` and self-built fixtures).

3. **The Playwright job was hitting its 40-minute timeout, not failing an assertion.**
   `crm-journeys.spec.ts` hardcoded `telestar2026` at six call sites and never read
   `E2E_PASSWORD`, so a randomly-seeded CI password failed every persona login; then
   `playwright.config.ts` — which selected its budgets on whether `BASE_URL` was *set*, not
   on whether the target was remote — applied a 120s per-test budget to a localhost run with
   `workers: 1`. Rehearsed in the CI configuration afterwards: **20/20 in 58s**.

### The secret scan

gitleaks reported 6 findings on first run. Triaged across 92 commits: **none is a live
credential.** Placeholder text in `.env` templates, loopback DSNs, the documented
`0123456789abcdef…` test key, Google-token-shaped fixtures, and deploy-guide DSNs whose
password is `${DB_PASSWORD}` or `<password>`. No PAT, no AWS key, no private key, nothing
resembling the `CRON_SECRET` rotated on 2026-08-05. So `.gitleaks.toml` allowlists those
values narrowly, keeps `useDefault = true`, and anchors the database exemptions to loopback
hosts and placeholder passwords — a credentialled DSN pointing anywhere real still fails.

`tests/gitleaks-allowlist.test.ts` pins that boundary, because a widened allowlist fails
silently. One wrinkle worth remembering: that test file must itself contain credential-shaped
strings to prove they are *not* exempted, so it is path-exempted by exact filename — the
scanner would otherwise flag the fixtures proving the scanner works.

### Still open

- **`Dependency review` fails on capability, not content** — "Dependency review is not
  supported on this repository". Enable Settings → Code security → **Dependency graph** and
  it goes green. It is deliberately *not* in the required checks, so it blocks nothing.
  Do not leave it red indefinitely: a permanently-failing check trains people to ignore
  checks, which is what this task set out to fix.
- **`CodeQL` is green but also not required.** Add it to the required contexts once you are
  happy it is stable.
- Action-deprecation warning: some pinned actions still target the Node 20 runtime.

---

## Task 6 — RLS: policies and roles landed (2026-08-08), enforcement validation outstanding

### Two findings, both material

**1. Seventeen tenant-owned tables had no policy.** `supabase/rls.sql` hardcoded a 24-name
array against a schema with 41 tenant-owned models. Missing: `Account`, `Contact`,
`SequenceEnrollment`, `ImportBatch`, `ImportRow`, `BookingLink`, `Meeting`, `Opportunity`,
`OpportunityActivity`, `ClientReport`, `ClientReportRecipient`, `ClientReportExport`,
`ClientReportShareLink`, `LeadPoolItem`, `CampaignLeadRequirement`, `LeadgenActivity`,
`Attachment`. `docs/opportunity-pipeline/PLAN.md:49` had already spotted the staleness and
deferred it — the hardcoded list is the root cause, so it would have gone stale again.

The table list is now derived from the catalog (every `public` table with a `tenantId`
column). Verified by applying it: **41 of 41** enabled, forced, policy present.

**2. Superusers bypass RLS entirely, and `FORCE` does not help.** With rls.sql applied to
all 41 tables, `SELECT count(*) FROM "User"` as `postgres` still returned every row.
`FORCE ROW LEVEL SECURITY` closes the *table owner* loophole; the superuser loophole cannot
be closed by policy at all. **Applying rls.sql while the app connects as a superuser
produces a system that looks isolated and is not.**

`supabase/roles.sql` is the answer: `crm_migrator` owns the schema and holds DDL; `crm_app`
and `crm_maintenance` are `NOSUPERUSER` with DML only; default privileges carry grants onto
tables future migrations create; and the script refuses to finish if either application role
is a superuser.

### State of enforcement

`DB_RLS_ENFORCED` appears in no env template, so **DB-level RLS is off** and the app-layer
`tenantId` injection in `lib/prisma.ts` is the only isolation today. That remains true after
this change — nothing here enables RLS anywhere. Per the plan, it must not be force-enabled
before the enforcement matrix passes in staging.

### Outstanding for Task 6

- **The two-tenant enforcement matrix under `DB_RLS_ENFORCED=true`.** It needs an isolated
  database and a non-superuser role, because enabling FORCE on the shared test database
  would blank every row for whichever suite runs alongside — and because, per finding 2,
  running it as `postgres` would pass while proving nothing. Best shape: a standalone script
  that creates its own database, applies schema + `rls.sql` + `roles.sql`, connects as
  `crm_app`, and asserts cross-tenant read/update/delete all fail.
- **Staging enablement**, then production. Blocked on having a staging target.
- **Product decision, needs a human:** `User.email` is currently `@unique` — globally unique
  across tenants. Two tenants therefore cannot both have `sonny@telestar.vn`. If per-tenant
  uniqueness is wanted it becomes `@@unique([tenantId, email])`, which changes login lookup
  (`auth.ts` would need a tenant discriminator) — a real behavioural change, not a
  constraint swap. **Recorded, not decided.**

### Inventory (for the record)

Bare `new PrismaClient()` — bypasses the tenant extension entirely: `prisma/seed-demo.ts`,
`scripts/create-admin.ts`, `scripts/create-user.ts`, `scripts/prod-audit.ts`,
`scripts/encrypt-existing-tokens.ts`, `scripts/sync-sequence-enrollments.ts`,
`tests/setup/db-baseline.ts`, and a stray `inspect_policies.ts` at the repository root that
looks like a leftover debugging script and should probably go.

Raw SQL (`$queryRaw` / `$executeRaw`, not intercepted by the extension): `lib/prisma.ts`,
`workers/email.ts`, `workers/healthcheck.ts`, `lib/search/accentSearch.ts`,
`app/api/health/route.ts`, `app/api/admin/worker-health/route.ts`, `scripts/prod-audit.ts`.
