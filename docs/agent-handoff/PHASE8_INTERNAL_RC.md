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

The same pattern still exists outside the audited surface and is **not** fixed here:

```text
app/api/client-reports/route.ts   (2 occurrences)
app/api/leads/import/route.ts     (1 occurrence)
```

## Unresolved failures

None.

## Uncommitted changes

None. Working tree clean at `f84ecc2`.

## Exact next action

Run the Playwright suites against this branch. Everything else in the gate list has passed.

**Exact next command** (the demo project needs a seeded demo tenant and a server on a free port —
3000/3100 are usually held by other lanes):

```bash
node node_modules/tsx/dist/cli.mjs scripts/demo-seed.ts --reset
node node_modules/next/dist/bin/next start -p 3300 &
BASE_URL=http://localhost:3300 node node_modules/@playwright/test/cli.js test --project=demo
```

Then, in order:

1. `BASE_URL=http://localhost:3300 node node_modules/@playwright/test/cli.js test --project=audit e2e/roles`
   — role access and tenant isolation. Needs the audit fixture first:
   `ALLOW_E2E_FIXTURE=1 E2E_PASSWORD='<strong>' node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts`
2. Decide whether the two remaining `|| 'default-tenant'` sites (`client-reports`, `leads/import`)
   are in scope for this RC. They are the same defect class, outside the audited surface.
3. Do **not** start Phase 9/10, and do not merge this branch anywhere.

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
