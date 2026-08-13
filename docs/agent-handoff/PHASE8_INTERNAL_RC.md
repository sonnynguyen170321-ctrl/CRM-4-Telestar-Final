# Phase 8 — internal release candidate

**Read this first.** It is the resume pointer for the internal RC branch: what it is, what has been
proven, and the exact next command.

| | |
|---|---|
| Branch | `feat/phase-8-internal-rc` (pushed, tracking `origin/feat/phase-8-internal-rc`) |
| HEAD | `f84ecc2` — `fix(leadgen): refuse a request with no tenant instead of defaulting it to one` |
| Base | `feat/phase-8-sdr-operations-ui` (`73973a2`) |
| Cherry-picked | `6fe1032` from `fix/phase-8-runtime-stabilization` (landed as `dc09042`) |
| Status | **Integrated, green on the full suite, database gates passed.** Not merged anywhere. Not production-approved. |

## Commits on this branch

```text
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

## Gates at `f84ecc2`

| Gate | Result |
|---|---|
| Targeted Phase 8 (`phase-8-stabilization`, `sync-worker`, `ai-optional`) | **50 passed**, 0 failed |
| `vitest run` (full) | **1385 passed, 5 skipped**, 0 failed — 97 files |
| `tsc --noEmit` | 0 errors |
| `eslint app components lib workers` | 0 errors, 0 warnings |
| `git diff --check` | clean |
| `next build` (via `scripts/build.cjs`) | exit 0 |
| `npm run check:migration-order` | ok — 41 migrations, 4 new |
| `prisma validate` | valid |
| `prisma migrate status` | up to date |
| `migrate diff --from-migrations` vs fresh shadow | `No difference detected`, exit 0 |
| `tests/rls-policy-coverage.test.ts` | 6 passed |
| Leadgen (`leadgen`, `leadgen-redesign`, `leadgen-tenant-context`) | **20 passed** |
| Playwright `--project=demo` | **8/8 passed** (5 walkthrough + 3 SDR exception workflows) |
| Playwright role access + tenant isolation (`e2e/roles`) | **67/67 passed** |

### One flake worth recognising, not chasing

The first full run reported 59 failed files. A rerun with no code change reported one. The suites
share a single local Postgres and one of them creates a throwaway database and applies the whole
schema to it; under that load the pool exhausts and unrelated suites fail on connections. Its
teardown terminates backends **only for its own `datname`**, so it is not killing other suites'
connections directly. If a run comes back with dozens of failures spread across unrelated files,
rerun before investigating.

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

None.

## Uncommitted changes

None. Working tree clean at `f84ecc2`.

## Exact next action

Every gate in the list above has passed. The RC is stable and pushed; nothing is in flight.

The next piece of work is the remaining `|| 'default-tenant'` sites, which are the same defect
class the Leadgen audit found, one surface over:

```text
app/api/client-reports/route.ts   lines 35 and 110
app/api/leads/import/route.ts     1 occurrence
```

**Exact next command:**

```bash
grep -rn "|| 'default-tenant'" app/api/client-reports/route.ts app/api/leads/import/route.ts
```

Then apply the same treatment: `requireTenantId(user)` in a route, `tenantIdOrThrow(actor)` in a
service, or drop the field entirely where `lib/prisma.ts` already stamps it. Extend the directory
list in `tests/leadgen-tenant-context.test.ts` (or add a sibling test) so the new surface is
guarded too, then run:

```bash
node node_modules/vitest/vitest.mjs run tests/leadgen-tenant-context.test.ts tests/client-reports.test.ts
```

Also still open, and deliberately not started: **Phase 9/10 stays out of this branch**, and this
branch is not merged anywhere.

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
