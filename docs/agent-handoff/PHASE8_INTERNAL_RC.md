# Phase 8 — internal release candidate

**Read this first.** It is the resume pointer for the internal RC branch: what it is, what has been
proven, and the exact next command.

| | |
|---|---|
| Branch | `feat/phase-8-internal-rc` |
| HEAD | `dc09042` — `fix(runtime): stabilize phase 8 sequence and reply recovery` |
| Base | `feat/phase-8-sdr-operations-ui` (`73973a2`) |
| Cherry-picked | `6fe1032` from `fix/phase-8-runtime-stabilization` |
| Status | **Integrated and green on targeted tests.** Not merged anywhere. Not production-approved. |

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

## Test results at `dc09042`

```text
tests/phase-8-stabilization.test.ts   passed
tests/sync-worker.test.ts             passed
tests/ai-optional.test.ts             passed
                                      50 passed, 0 failed
```

Command used:

```bash
node node_modules/vitest/vitest.mjs run \
  tests/phase-8-stabilization.test.ts tests/sync-worker.test.ts tests/ai-optional.test.ts
```

No regressions were found, so nothing was fixed and no test was modified beyond the conflict
resolution above.

## Unresolved failures

None on the targeted suites.

## Uncommitted changes

None. Working tree clean at the checkpoint.

## Exact next action

Run the wider gates against this branch, then the database gates, then the Leadgen audit. In order:

```bash
# 1. full suite + types + lint
node node_modules/vitest/vitest.mjs run
NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js app components lib workers

# 2. database gates (non-destructive)
npm run check:migration-order
node node_modules/prisma/build/index.js validate
node node_modules/prisma/build/index.js migrate status
node node_modules/prisma/build/index.js migrate diff \
  --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "postgresql://postgres:postgres@127.0.0.1:5432/telestar_shadow" --exit-code

# 3. RLS coverage
node node_modules/vitest/vitest.mjs run tests/rls-policy-coverage.test.ts
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
