# Pre-Domain Hardening — STATUS

> Resume pointer. Read this first, then execute the next unchecked task in
> [`PLAN.md`](./PLAN.md). Tick the box there and update this file when a task lands.

**Current phase:** closing out — every task in `PLAN.md` is written.
**Next task:** none that can be done from the repository. What remains needs a live box, a
staging target, Docker, or a browser — see **Outstanding — needs an environment or a human**
below.
**Blockers:** none in the repo.

> **2026-08-14 — the create-user session-revocation item is CLOSED.** `scripts/create-user.ts`
> now increments `authVersion` whenever a change governs access — password, role, or active state
> — and leaves it alone for a rename. `--deactivate` exists and is mutually exclusive with
> `--activate`. Landed as `7845f8e` on `integrate/phase-8-10-final` (originally PR #44).
>
> **Rotating the published demo password on any live box remains ENVIRONMENT-ONLY.** The tool that
> does it safely now exists; whether it has been *run* against a deployment cannot be established
> from this repository.

> ⚠️ **`main` is protected as of 2026-08-08. You can no longer push to it.** Every change —
> including documentation — goes through a branch and a pull request, and cannot merge until
> `CI required checks` is green. This applies to the repository owner too (`enforce_admins`
> is on). Tasks 1, 3, 4 and 5 were merged locally before this; everything after is a PR.

> Protection is **strict** (branch must be up to date), so two open PRs cannot both merge
> without the second re-merging `main` first. Land them one at a time.

> **`authVersion` migration `20260806100000` lands with Task 2.** The column was already
> applied to the local database from the branch, so `prisma migrate status` on a machine that
> ran it will now agree; a machine that did not needs `migrate deploy`.

---

## Outstanding — needs an environment or a human

None of these can be finished from a checkout. They are the whole remaining surface.

1. ~~**Change the Director password on the live box**~~ — **done 2026-08-08.** Rotated on
   `9ca7e6b`, and the revocation was confirmed the only way that counts: an already-open
   Director session was refused on its next request, and both `telestar2026` and an
   accidentally-set intermediate value were rejected at sign-in. Deployment record:
   [`docs/DEPLOY.md` §8b](../DEPLOY.md).

   **Two things this did not fix.** Every *other* demo account still holds the published
   `telestar2026` — SDRs, team leads, floor managers — so this is now the largest remaining
   credential exposure on that box. And the site is still plain HTTP, so the new password
   crossed the network in cleartext at sign-in.

   Kept for the record, because the reasoning was wrong before it was right:

   > **Correction.** An earlier version of this line said the session revocation came free
   > "with Task 2 merged". It did not. Task 2 wired `authVersion` into the *application's*
   > password paths, while `scripts/create-admin.ts` — the only supported way to rotate this
   > credential on a deployed box — reset the password and left `authVersion` untouched. Run
   > as documented, it would have changed the password while every token minted under
   > `telestar2026` kept full Director access until it expired. Fixed, with
   > `tests/create-admin.test.ts` pinning the increment so the claim cannot silently become
   > false again.

2. 🔴 **Rotate or deactivate the other demo accounts.** Every non-Director demo user still
   has `telestar2026`, which is published in this repository. Now the single largest
   credential exposure on that box, ahead of TLS.

   > ⚠️ **Do not use `create-admin` for this.** It hardcodes `role: 'director'`
   > (`scripts/create-admin.ts:58`), so pointing it at an SDR rotates the password *and*
   > promotes the account. Running it across the eleven demo users would make every one of
   > them a Director — the opposite of hardening.

   Use `create-user`, which writes only the fields you pass:

   ```bash
   npm run create-user -- --email sdr1@telestar.vn --password '<new strong password>' --role sdr
   npm run create-user -- --email unused@telestar.vn --deactivate   # for accounts nobody needs
   npm run list-users                                               # confirm roles afterwards
   ```

   Both forms bump `authVersion`, so existing sessions minted under `telestar2026` are
   refused on their next request. **That was not true before 2026-08-09** — `create-user`
   wrote the password and left `authVersion` alone, the same defect `c02b7f0` fixed in
   `create-admin`. Rotating with the old script would have changed the password while every
   live token kept working until it expired. `tests/create-user.test.ts` pins the increment
   for password, role and deactivation changes, and pins that a rename does *not* sign
   anyone out.

   Until the box is redeployed past `#42` its image has no `tsx`, so `npm run create-user`
   fails with `tsx: not found`. Work around it the same way the Director rotation did:
   `npx --yes tsx scripts/create-user.ts -- --email … --password … --role …`.
3. **Enable RLS on a staging target** (Task 6). The policies, roles and procedure are written
   and tested; enforcement has never been switched on anywhere, because there is no staging
   database to switch it on against.
4. **Update `/opt/crm-4-u` on the box so the Task 5 deploy tooling actually applies.** Its
   checkout predates Task 5: the compose file there still resolves `IMAGE_TAG` and ignores
   `CRM_IMAGE`, so `scripts/deploy.sh` and `scripts/rollback.sh` are inert and
   `deployments.ndjson` is never written. Details and the migration hazard are in
   [`docs/DEPLOY.md` §8b](../DEPLOY.md). Redis failover scenarios (Task 10) still need
   Docker or a VM.
5. ~~**Manual verification of Task 2**~~ — **done 2026-08-08**, during the password
   rotation. An already-open Director session was refused on its next request, which is the
   same revocation path a deactivation takes.

---

## The completion gate is now fully ticked (2026-08-08)

The last two boxes in `PLAN.md` were tracking items rather than build work, and the evidence
for both already existed. Recording where it lives so the ticks are auditable.

**Live email sending still disabled.** Off at every layer, and off by *default* rather than
by configuration anyone has to remember:

| Layer | Evidence |
| --- | --- |
| Live box | `GET /api/cron/sequence-engine` returned `{"disabled":true,"sent":0}` — recorded in `docs/DEPLOY.md` §"Email sending decision made" |
| Compose | `docker-compose.yml` and `docker-compose.aws.yml` both interpolate `${EMAIL_SEND_DRY_RUN:-true}` / `${SEQUENCE_AUTOSEND_ENABLED:-false}` |
| Env templates | `.env.example`, `.env.docker.example`, `.env.production.example` all ship the safe values |
| CI | `ci.yml` pins `EMAIL_SEND_DRY_RUN: 'true'`, `SEQUENCE_AUTOSEND_ENABLED: 'false'` |
| Code | `workers/email.ts` engages dry-run unless explicitly disabled |

> ⚠️ **Both flags are fail-open**, as `.env.production.example` says in its own comment:
> dry-run engages only on the literal `"true"`, and autosend disables only on the literal
> `"false"`. A typo'd or deleted value sends real mail. Re-read that file before editing it
> on the box, and re-run the cron probe after any deploy — the live-box evidence above is a
> point-in-time check, not a guarantee.

**HTTPS and automated backups tracked as explicitly blocked.** Both are in
`docs/DEPLOY.md` → "Open before real client data": TLS (UX-001) with the exact three values
that need to change (`CRM_DOMAIN`, `CADDY_SITE_ADDRESS`, `NEXTAUTH_URL` — Caddy provisions
the certificate, no code change), and Cloud SQL automated backups, where `gcloud sql backups
list` showed a single manual snapshot and no schedule. Tracked, owned, and unblocked only by
the domain. The box asks that they be *tracked as blocked*, which they are — it does not
claim either is done.

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

### Task 6 — completed (2026-08-08)

The enforcement matrix now exists: **`npm run verify:rls`** (`scripts/verify-rls.mjs`).

It creates a throwaway database, applies the schema and `supabase/rls.sql`, creates a
`NOSUPERUSER` role, builds two tenants each with their own user/client/campaign/lead, and
then — connected as that unprivileged role holding tenant A's context — asserts:

```
PASS  reads its own tenant's rows
PASS  cannot read another tenant's rows
PASS  cannot read another tenant's row by direct id
PASS  cannot update another tenant's row
PASS  cannot delete another tenant's row
PASS  cannot insert a row attributed to another tenant
PASS  fails closed with no tenant context

Control — the same read as a superuser:
PASS  superuser sees both tenants (2 rows) — RLS does not apply to superusers
```

The control is deliberate. A suite that cannot fail proves nothing, so the script also
asserts that a superuser **does** see across tenants — which both confirms the assertions
above are detecting the policy rather than an empty table, and demonstrates the finding that
no policy can constrain a superuser. If that control ever returns 1 row, the checks above
have gone vacuous and the script says so.

It is a script rather than a Vitest suite for two reasons: enabling FORCE on the shared test
database would blank every row for whichever suite runs in parallel, and running the matrix
as the default local superuser would pass while proving nothing.

**Product decision, recorded:** `User.email` stays **globally unique**. Every user is
Telestar staff, so one person has one login. Per-tenant uniqueness would need
`@@unique([tenantId, email])` *and* a tenant discriminator at sign-in — a behavioural change
that buys nothing while Telestar is the only operator. Revisit if external client users ever
get accounts.

**Still not enabled anywhere.** `DB_RLS_ENFORCED` remains unset; app-layer injection is the
live isolation. Enabling is an ops sequence, not a code change: apply `roles.sql`, repoint
`DATABASE_URL` at `crm_app`, apply `rls.sql`, set `DB_RLS_ENFORCED=true` — staging first.
That last step is the only part still outstanding, and it is blocked on having a staging
target rather than on any work in this repository.

**Dependency graph** was enabled on the repository on 2026-08-08, so `Dependency review`
should now report properly instead of "not supported on this repository".

---

## Task 7 — Login throttling ✅ (2026-08-08)

Three counters per attempt, in Redis so they are shared across serverless instances:
`pair` (ip + email), `ip`, and `email`.

**The scopes are treated differently, and that is the whole design.** The obvious version —
lock an email address after N failures — is a weapon aimed at your own staff: anyone who
knows a colleague's address can lock them out of the CRM with a few dozen wrong passwords.
So `pair` and `ip` may lock (they are attacker-controlled, and locking them costs the
attacker their own access), while `email` may only delay and raise an alert. That satisfies
the plan's requirement in both directions: one IP cannot lock every account, because its own
`ip` counter locks first; and one attacker cannot deny service globally, because the `email`
scope never locks.

`ip` tolerates more failures than `pair` deliberately — one office NAT, VPN exit or CI
runner legitimately carries several people's typos, and locking the address takes them all
out.

Other decisions worth keeping:

- **Equal-time failures.** When the account does not exist or is deactivated, the code still
  runs a bcrypt comparison against a dummy hash. Skipping it would make unknown addresses
  answer measurably faster — an enumeration oracle no matter how uniform the message is.
  The message itself is a single exported constant, now used by `app/login/page.tsx` too.
- **Fails open when Redis is down.** A cache outage must degrade rate limiting, not
  authentication; failing closed would turn a Redis blip into a total lockout and hand an
  attacker a cheaper denial of service than the one being prevented. Logged loudly.
- **Success clears `pair` and `email` but not `ip`.** Clearing the IP counter would let an
  attacker holding one valid credential reset their spray budget at will.
- **Delay is capped** at 8s. Uncapped doubling ties up a request slot per attempt.
- **Addresses are hashed** into the Redis keys, so a Redis snapshot is not a user list.
- **`x-forwarded-for` is read last-hop-first.** The leftmost entries are client-supplied and
  forgeable; trusting them would give a fresh budget per forged header.
- **Microsoft Entra ID is untouched by construction** — the throttle lives inside
  `Credentials.authorize`, and the OAuth path never enters it.

26 tests in `tests/login-throttle.test.ts`, including the two denial-of-service traps
(an account never locks at any failure count; one IP is cut off before it can work through
the user table) and the shared-across-instances behaviour.

---

## Task 8 — CSP in report-only ✅ (2026-08-08). Enforcement deliberately deferred.

`Content-Security-Policy-Report-Only` on every response, violations posted to
`/api/csp-report`. Nothing is blocked yet — that switch belongs with the domain deploy,
once the reports are quiet.

**Origin inventory**, which is the part worth keeping:

| Browser-facing — in the policy | Why |
| --- | --- |
| `fonts.googleapis.com` | the `@import` at the top of `app/globals.css` |
| `fonts.gstatic.com` | the font files that stylesheet then references |
| `images.unsplash.com` | demo imagery |
| `login.microsoftonline.com` | Entra ID sign-in, as a `form-action` |

**Server-side only — deliberately absent:** `graph.microsoft.com`, `www.googleapis.com`,
`api.tavily.com`, `r.jina.ai`. The browser never contacts them; listing them would widen
the policy for nothing. **Navigation targets — also absent:** `linkedin.com`, `wa.me`,
`meet.google.com`, `calendly.com`. CSP does not govern `<a href>`.

Closed: `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`,
`frame-src 'none'`, `base-uri 'self'`, `connect-src 'self'`. No `unsafe-eval` anywhere.

**The one known gap, and why it is not fixed yet.** `script-src` still allows
`'unsafe-inline'`, because Next.js inlines its bootstrap and hydration scripts. The usual
fix is a per-request nonce from middleware — but `proxy.ts` deliberately does not run on
`/login`, `_next/static`, the health probe or the public client-report routes, so a
middleware-only nonce would leave exactly those pages violating their own policy. Widening
the matcher to cover `/login` risks a redirect loop on the one route that must stay
reachable. `buildCsp()` already accepts a nonce, so the switch is a change in one function
rather than at every caller.

**Header is set in `next.config.ts`, not the middleware** — for the same reason: the
middleware skips the routes a partial policy would most embarrassingly miss.

The report endpoint is unauthenticated by necessity (browsers post with no cookies) and so
is deliberately cheap: 8 KB body cap, nothing persisted, one log line, 204 to everyone.
`proxy.ts` excludes it alongside the health probe.

Verified live against a production build: header present on `/login`, a posted violation
returned 204 and logged
`[csp-report] directive=img-src blocked=https://evil.test/x.png document=…/login`.

**Before enforcing:** exercise every route with the browser console open, fix real
violations, tighten `script-src`, then change `CSP_HEADER_NAME` to
`Content-Security-Policy`. That last step ships with the domain.

- 2026-08-06 — **Task 2 in progress** (`f379cb2` on `fix/session-revocation`, pushed, **not merged**).
  Implementation complete and typechecking clean: `User.authVersion` + migration
  `20260806100000`, token stamping in `auth.ts`/`auth.config.ts`, database revalidation in
  `getSessionUser` (cached per request, run inside a `tenantStorage` bypass to avoid recursing
  through `getTenantIdFromSession`), increments on password change / admin reset / role change /
  deactivate / reactivate, and `POST /api/admin/users/[id]/sign-out-all`. 13 new tests pass.

  **Blocking merge:** 26 tests across `access-control`, `admin`, `admin-audit`,
  `email-health-access` and `leadgen-redesign` now return **401 where they assert 403**. That is
  the fix working — they mock `auth()` with synthetic users that have no database row, so the
  request is rejected as unauthenticated before reaching the role check. They encode the old
  contract in which the token was trusted.

  Two ways to fix each, both legitimate:
  1. Seed a real `User` row matching the mocked session id (keeps them as integration tests and
     keeps exercising revalidation).
  2. Mock `@/lib/auth`'s `getSessionUser` instead of `@/auth`'s `auth()` (keeps them as pure
     unit tests of route authorization; revalidation is already covered by
     `tests/session-revocation.test.ts`).

  Option 2 is cheaper and probably right for `access-control` and `leadgen-redesign`, which are
  pure authorization matrices. `admin.test.ts` already seeds users, so option 1 fits there.

  Still outstanding for Task 2 after that: a "Sign out all sessions" control in the `/admin`
  UI (the endpoint exists, nothing calls it), and the manual verification pass from PLAN.md.

---

## Task 2 — Session revocation ✅ (2026-08-08). Unparked and finished.

The implementation had been sitting on `fix/session-revocation` since 2026-08-06, blocked on
25 failing tests and a missing UI control. Both are done; `main` merged in, all gates green.

### The 25 failures were the feature working

Five suites asserted **403** and got **401**. They mock `auth()` with synthetic sessions for
ids like `sdr-1` and `aud-fm` that have no database row — so revalidation correctly rejected
them as unauthenticated before the role check they were testing. They encoded the old
contract in which the token was trusted.

The earlier note proposed mocking `getSessionUser` instead. **That is not available:**
`getSessionUser` is a module-local `const` in `lib/auth.ts`, and `requireAuth`/`requireRole`
call that local binding — replacing the export does not intercept them, and reshaping
production code to add a test seam would be the tail wagging the dog.

So the fixtures got real identities, by whichever route suited the suite:

| Suite | Fix | Why |
| --- | --- | --- |
| `access-control`, `admin`, `leadgen-redesign` | real rows via `tests/helpers/sessionUser.ts` | they already talk to a real database; they now exercise revalidation *and* the role matrix |
| `admin-audit`, `email-health-access` | taught their Prisma mock via `tests/helpers/mockDbUser.ts` | they mock `@/lib/prisma` wholesale, so a real row is invisible to them — they stay unit tests with no database |

Three things that cost time and are worth not rediscovering:

- **Fixture emails collide.** `User.email` is globally unique and the fixtures use plausible
  addresses like `sdr@telestar.vn`, which the demo seed already owns. The helper derives
  `<id>@session-fixture.test` instead and ignores the fixture's address; nothing asserts on
  it.
- **`vi.mock` factories are hoisted** above module-level `const`s, so a factory naming one
  directly throws `Cannot access before initialization`. The mock has to reference it
  through a lazy arrow.
- **Tenant has to match.** `admin-audit` fixtures carry `tenantId: 'admin-audit-tenant'`, and
  `getSessionUser` rejects a session whose token tenant differs from the row's — the
  cross-tenant check doing its job. Seeding the row under the default tenant produced a 401
  that looked like the original bug.

### Sign out all sessions

`POST /api/admin/users/[id]/sign-out-all` existed but nothing called it. `/admin/users` now
has a per-row control (director-only, like the other destructive actions). It bumps
`authVersion`, so existing tokens stop working on their **next request** rather than at
expiry — distinct from deactivating, since the user keeps their access and simply signs in
again. That is the right tool after a shared laptop, a lost phone, or a password typed into
the plain-HTTP demo box.

### Gates

Vitest **686/686**, `tsc` 0, lint 0 errors, `next build` exit 0.

**Still worth doing on the live box**, and not blocked by anything here: the Director
password change from the top of this file. With `authVersion` now in place, changing it also
invalidates every existing session — which is the stronger version of that fix, and the
reason the original note argued for taking Task 2 first.

---

## Task 10 — Managed Redis prep ✅ (2026-08-08)

Full inventory, requirements and migration steps: **`docs/REDIS_MIGRATION.md`**.

### The finding worth remembering

**`maxmemory-policy` must be `noeviction`.** BullMQ stores queue state in keys with no TTL,
so under any `allkeys-*` policy Redis deletes whichever keys it likes under memory pressure
— including job hashes and the lists referencing them. The failure is silent: a job simply
ceases to exist, or counters stop matching contents. Managed providers commonly default to
`allkeys-lru`, which is right for a cache and wrong for a queue. With `noeviction` a full
instance rejects writes loudly and the enqueue fails where someone can see it.

### Observability

`/api/admin/worker-health` already reported per-queue counts. Depth alone cannot distinguish
a healthy burst from a dead consumer, so it now also reports:

- **age of the oldest waiting job** — one job stuck for an hour is a smaller number than a
  healthy burst and a far worse condition;
- **a worker heartbeat**, read from `JobRun` in **Postgres, not Redis** — a heartbeat stored
  in Redis is unreadable exactly when Redis is the problem;
- **`alerts[]`**, the specific conditions worth acting on rather than raw numbers.

### Connection hardening

- `commandTimeout: 10_000` and `enableOfflineQueue: false`. Without these an unreachable
  Redis makes callers **hang** rather than fail — BullMQ's own calls never reject — so a web
  request that enqueued would sit until the platform killed it.
- Reconnect stays unbounded with capped backoff, deliberately: a worker must self-heal
  across a provider failover. Bounded *per command*, unbounded *per connection*.
- `assertUsableRedisUrl` rejects a non-`redis(s)` scheme, and rejects a password sent over
  plaintext to a non-local host — the exact mistake a migration invites, copying the host
  and forgetting the extra `s`.
- `docker-compose.yml` no longer hardcodes `redis://redis:6379`; it reads
  `${REDIS_URL:-redis://redis:6379}`, so a managed instance needs no file edit.

### Durability

Every business-critical job is backed by a durable row — `OutboundMessage` for sends,
`SequenceEnrollment`/`Task` for sequences, `ImportBatch`/`ImportRow` for imports — so a Redis
outage is a delay, not data loss. The one thing Redis loss costs is jobs already delayed to
a future time; the maintenance `missing-delayed` repair rebuilds those from `Task`.

17 tests in `tests/redis-readiness.test.ts`, including that depth alone raises no alert,
that a single stuck job does, that an unreadable queue is reported rather than counted as
zero, and the URL-validation cases.

---

## Task 9 — Private security reporting ✅ (2026-08-08)

**GitHub private vulnerability reporting is enabled**, applied via
`gh api -X PUT .../private-vulnerability-reporting` and confirmed by reading it back:
`{"enabled": true}`. Note the repo object's `security_and_analysis` block does **not**
surface this field — only the dedicated endpoint does, so "not reported" there is not
evidence it is off.

`SECURITY.md` was nine lines and its advice was self-contradictory: it asked reporters to
open "an issue in a secure manner". There is no such thing — a public issue is a disclosure,
and one that reaches attackers before it reaches a fix. It now points at the private
advisory form as the only monitored channel.

What it now carries, per the plan: supported versions (latest `main` only — there are no
release branches and older images are never patched in place), what to include in a report
(feature, reproduction, impact, redacted evidence, optional mitigation), an acknowledgement
window of 2 business days with 5 to assess and 14 to fix a confirmed critical, a named
incident owner, and escalation for each of the five categories the plan asks for —
credential exposure, cross-tenant access, unauthorized email, database loss, RCE — written
against this system's actual failure modes rather than generic advice.

Two deliberate choices:

- **No `security@` mailbox yet.** The plan asks for one "once the domain exists". Publishing
  an address nobody monitors is worse than publishing none, so the file says exactly that
  and commits to adding it with the domain.
- **The known weaknesses are listed openly** — plain HTTP, RLS not enforced, `unsafe-inline`
  in `script-src`, the published demo password. A researcher who reports one of those has
  wasted their time and ours; the file asks them instead to report anything *worse than
  described*. This is a public repository, so none of it is news to an attacker.

There is no second on-call, and the file says so rather than implying a rota that does not
exist.
