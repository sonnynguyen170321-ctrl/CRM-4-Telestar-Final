| | |
|---|---|
| Branch | `feat/phase-8-internal-rc` (pushed, tracking `origin/feat/phase-8-internal-rc`) |
| HEAD | `93d8028` — `fix(test): assert the RLS suite's database is never the shared one` |
| Base | `feat/phase-8-sdr-operations-ui` (`73973a2`) |
| Cherry-picked | `6fe1032` from `fix/phase-8-runtime-stabilization` (landed as `dc09042`) |
| Status | **RC1 — ready for deep internal QA.** Two consecutive green full runs, all gates passed. Not merged. Not production-approved. |

## Commits on this branch

```text
93d8028  fix(test): assert the RLS suite's database is never the shared one
a7a3b7e  fix(tenant): remove remaining implicit tenant fallbacks
f3ab112  docs(handoff): record the browser gate results and the next defect to close
65d891f  docs(handoff): record the RC gate results, the leadgen finding, and the next command
f84ecc2  fix(leadgen): refuse a request with no tenant instead of defaulting it to one
c2a8699  fix(test): assert RLS coverage of our models, not equality with a shared database
713f202  docs(handoff): record the Phase 8 internal RC and how its one conflict was resolved
dc09042  fix(runtime): stabilize phase 8 sequence and reply recovery   ← cherry-picked 6fe1032
73973a2  feat(sdr-ops): task context origin navigation and human-first reply taxonomy  ← base
```

## What this branch is

The Phase 8 product surface and the Phase 8 runtime fixes in one place, for internal validation:

```text
feat/phase-8-sdr-operations-ui   SDR operations UI, inbox reply exception workflows,
  (73973a2)                      task context origin, human-first reply taxonomy
    + 6fe1032                    sequence/reply runtime stabilization (S1–S4)
```

Nothing else is in it. The Class D **review API** and the sales-attribution guardrails live on
`integrate/runtime-safety-73973a`; Phase 9/10 role surfaces and approved learning live on
`integrate/productization-73973a`. Both are out of scope here by instruction.

## What the cherry-pick brought

| Area | Change |
|---|---|
| `workers/sequence.ts` | S1 — a post-lock exception releases the execution claim instead of stranding the task |
| `workers/maintenance.ts` | S2 — schedule-drift repair is occurrence-aware |
| `workers/sync.ts` | S3 — reply eligibility gates on the authoritative `SequenceEnrollment`, not the `Lead.sequenceStatus` cache |
| `workers/sync.ts` | S4 — redelivered provider messages are deduplicated |
| `lib/research/cache.ts` | research cache stabilization |
| `tests/phase-8-stabilization.test.ts` | new, 506 lines, S1–S4 |

## The one conflict, and how it was resolved

`tests/ai-optional.test.ts`. Both sides edited the AI-surface allowlist.

- **`73973a2` (ours)** added `components/dashboard/CommandCenterStrip.tsx` to the allowlist, because
  the old `AI_IMPORT` regex matched *any* path containing `/ai/` — including the type-only
  `@/components/ai/types` — and the strip imported it.
- **`6fe1032` (theirs)** narrowed the regex to `lib/ai` only and allowlisted `components/ai`.

**Resolved in favour of the stabilization side.** With the narrowed regex the dashboard exemption is
no longer needed, so keeping it would have widened the allowlist for no reason. The resolution makes
the test *stricter*, not weaker: one fewer file is exempt from the "AI is optional" rule.

## Gates at RC1 (`93d8028`)

Every gate below was re-run on this exact code state, after the tenant and harness work.

| Gate | Command | Result |
|---|---|---|
| Full Vitest — **run 1** | `node node_modules/vitest/vitest.mjs run` | exit 0 · **1385 passed, 5 skipped, 0 failed** · 97 files · 306s |
| Full Vitest — **run 2** | same, no code change between | exit 0 · **1385 passed, 5 skipped, 0 failed** · 97 files · 188s |
| TypeScript | `tsc --noEmit` | exit 0, 0 errors |
| ESLint | `eslint app components lib workers` | exit 0, 0 errors, 0 warnings |
| Whitespace | `git diff --check` | clean |
| Production build | `node scripts/build.cjs` | exit 0 |
| Migration order | `npm run check:migration-order` | ok — **41 migrations**, 4 new |
| Prisma validate | `prisma validate` | valid |
| Migrate status | `prisma migrate status` | up to date |
| Drift vs fresh shadow | `migrate diff --from-migrations … --exit-code` | **No difference detected**, exit 0 |
| RLS coverage | `vitest run tests/rls-policy-coverage.test.ts` | 6 passed |
| Tenant context | `vitest run tests/tenant-context.test.ts` | 5 passed |
| Playwright demo | `--project=demo` | **8/8** (5 walkthrough + 3 SDR exception workflows) |
| Playwright roles / tenant isolation | `--project=audit e2e/roles` | **67/67** |

Two earlier full runs on `a7a3b7e` were also green, so four consecutive green full runs stand.

## The test-harness flake — investigated, and the standing theory was wrong

The harness had twice produced dozens of unrelated failures that vanished on a rerun. The theory on
file was PostgreSQL connection-pool exhaustion from the suite that creates a throwaway database.

**Measured, not assumed:** sampling `pg_stat_activity` every 3s across a full run peaks at
**33 of 100** connections. Exhaustion is not the cause. Do not re-chase it.

What does match the symptom is what that suite *applies*: `supabase/rls.sql` ENABLEs and FORCEs
row-level security on every tenant-owned table. Pointed at the shared database — a misread
`ADMIN_DATABASE_URL`, a future edit to `urlFor` — every row would become invisible to every suite
running beside it, failing dozens of files at once and then passing on the next run because the
database is dropped in teardown. The separation was correct but assumed; `93d8028` asserts it
before anything is created (target database ≠ admin database, name carries the throwaway prefix).

The residual risk is **two full suites run against the same database at once** — several DB suites
call `deleteMany()` in `beforeEach`, so they wipe each other's rows. That is a property of the
shared local Postgres, not of this branch. Run one suite at a time, or point `DATABASE_URL` at your
own database.

## What was fixed after the cherry-pick

**`tests/rls-policy-coverage.test.ts`** asserted set equality between the schema's tenant-owned
models and every `tenantId`-carrying table in the live catalog. The local Postgres is shared between
worktrees, so a Phase 10 branch's applied migrations left two tables behind and the equality failed
for a reason unrelated to this branch. It now asserts that every tenant-owned model of *ours* is
covered, naming any offender; "no unknown extras" belongs to the migration drift gate, which runs
against a fresh shadow database where a stray table cannot exist.

**The Leadgen audit found a blind tenant default in eleven places** — `user.tenantId ||
'default-tenant'` across nine route files and `lib/leadgen/pool.ts`. It never fires in normal
operation, which is the danger: a session without a tenant would have read and written a real
tenant named `default-tenant` instead of failing. Routes now use `requireTenantId` (403);
`lib/leadgen/pool.ts` uses `tenantIdOrThrow`; the two writes that only needed the column drop it
and let the `lib/prisma.ts` extension stamp it. `tests/leadgen-tenant-context.test.ts` walks the
leadgen surface and fails if the pattern returns.

## Repo-wide tenant-fallback audit — complete

Every `default-tenant` occurrence in the repository, classified. Production request/auth/data-access
code is the only category that mattered; fixtures, seeds and docs legitimately name the tenant.

| Location | Class | Note |
|---|---|---|
| `app/api/leadgen*/**` (9 files), `lib/leadgen/pool.ts` | **FIXED** (`f84ecc2`) | `requireTenantId` / `tenantIdOrThrow` / dropped where the extension stamps |
| `app/api/client-reports/route.ts` ×2 | **FIXED** | session tenant, then stored `User.tenantId`, then **403** — no literal |
| `app/api/leads/import/route.ts` | **FIXED** | `requireTenantId` → 403 |
| `lib/cache.ts` | **FIXED** | a fallback key is a *shared* namespace: two tenantless callers read each other's cached lists. Now throws |
| `lib/audit.ts` ×3 | **FIXED** | audit rows are evidence; an unresolvable tenant now skips the row and logs, never misattributes |
| `lib/bullmq/enqueue.ts` ×3 | **FIXED** | `tenantId` becomes the `JobRun` tenant the worker *executes* as, and seeds the dedupe key. Now required |
| `lib/bullmq/workerUtils.ts` | **FIXED** | a job whose `JobRun` cannot be read now fails instead of running as `default-tenant` |
| `lib/prisma.ts:30` | **SAFE** | bypass context for the session lookup that *discovers* the tenant; never scopes data |
| `vitest.config.ts`, `tests/**`, `tests/setup/db-baseline.ts` | **TEST/DEMO ONLY** | the tenant row the suites write against |
| `prisma/seed-demo.ts`, `scripts/create-user.ts`, `create-admin.ts`, `list-users.ts` | **TEST/DEMO ONLY** | explicit local seeding |
| `prisma/migrations/**` | **SAFE** | historical `DEFAULT 'default-tenant'` on old columns, since removed by a later migration |
| `docs/**` | **DOCUMENTATION ONLY** | — |

**NEEDS REVIEW: none remaining.**

`tests/tenant-context.test.ts` (renamed from `leadgen-tenant-context`) now walks `app/api`, `lib`
and `workers` — 200+ files — and fails if the pattern returns. `lib/prisma.ts` and
`lib/bullmq/workerUtils.ts` are exempted **by path**, so the two legitimate uses are visible rather
than pattern-matched away.

One existing test asserted the old behaviour (`falls back to default-tenant when tenantId is
undefined`). It was inverted, not deleted: it now asserts the refusal, because the thing it pinned
was the defect.

## Unresolved failures

None. No known defect is outstanding on this branch.

## Uncommitted changes

None. Working tree clean at `93d8028`.

## Known remaining work (not defects)

- **Leadgen AI gap** — `LeadPoolItem → research/enrichment → deterministic dedupe → campaign ICP
  assessment → qualification recommendation → controlled promotion → CRM Lead → prospect work
  order`. A deliberate follow-on workstream, explicitly **after** internal QA. Do not start it
  during hardening.
- **Class D review API** and sales-attribution guardrails live on `integrate/runtime-safety-73973a`,
  Phase 9/10 on `integrate/productization-73973a`. Neither is part of this RC.

## Exact next action

RC1 is stable. The next task is the **deep Playwright role/process internal QA audit** — moving the
question from "does it pass tests?" to "can a real Telestar user operate the CRM end to end?".

Cover, per role (Director, Floor Manager, Team Lead, SDR, Leadgen Manager, Leadgen): navigation,
visibility, permissions, mutations, ownership, assignment, queues, dashboard data, empty states and
forbidden actions — plus the leadgen intake chain, the SDR reply/handoff loop, sequence timing and
recovery, and cross-tenant refusal on every id-bearing endpoint.

**Exact next command** (start the app, then write the first role spec under `e2e/roles/`):

```bash
node node_modules/tsx/dist/cli.mjs scripts/demo-seed.ts --reset
node node_modules/next/dist/bin/next start -p 3300 &
ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='PwAudit!2026' node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts
BASE_URL=http://localhost:3300 E2E_PASSWORD='PwAudit!2026'   node node_modules/@playwright/test/cli.js test --project=audit e2e/roles
```

Rules for that pass: reproduce a defect, find the root cause, add regression coverage, fix, re-run
the workflow, commit small, push, update this file. **Email stays in dry-run.** Do not merge to
main, do not start Phase 9/10.

### Re-running the browser gates

```bash
node node_modules/tsx/dist/cli.mjs scripts/demo-seed.ts --reset
node node_modules/next/dist/bin/next start -p 3300 &      # 3000/3100 are usually held by other lanes
BASE_URL=http://localhost:3300 node node_modules/@playwright/test/cli.js test --project=demo

ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='PwAudit!2026' node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts
BASE_URL=http://localhost:3300 E2E_PASSWORD='PwAudit!2026' \
  node node_modules/@playwright/test/cli.js test --project=audit e2e/roles
```

## Environment notes that cost time if unknown

- The checkout path contains `&`, so every npm/npx `.bin` shim resolves wrongly. Call entry scripts
  through `node` directly, as above. `scripts/build.cjs` already does this.
- `tsc` and `next build` need `NODE_OPTIONS=--max-old-space-size=8192` or they die at the heap limit
  with exit 134 — a memory limit, not a type error.
- `prisma generate` fails on Windows with `EPERM … query_engine-windows.dll.node` while any dev or
  production server is holding the DLL. Stop the server first.
- The local Postgres is shared between worktrees. Other branches' applied migrations leave tables
  behind, so a strict catalog-equality assertion can fail for reasons unrelated to this branch.
- Ports 3000/3100 are commonly held by other lanes' servers; start this one on a free port.
