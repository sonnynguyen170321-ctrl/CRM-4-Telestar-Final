# Automation Engine — STATUS

**Read this first.** Then execute the next unchecked item in [`PLAN.md`](PLAN.md).

| | |
|---|---|
| Phase | All phases in `PLAN.md` complete. **Email Automation lane (Plan 1) landed on `integrate/phase-8-10-final`** — see [`EMAIL_AUTOMATION_LANE.md`](EMAIL_AUTOMATION_LANE.md) |
| Branch | `feat/automation-engine-pr` (merged forward from the deleted `feat/automation-engine`) |
| Base commit | `bd018c1 feat(automation): complete automation engine upgrade (Phases 0-15)` |
| Next task | None in this initiative. Three non-blocking follow-ups listed at the bottom of `PLAN.md`. |
| Blockers | None |

## 2026-08-14 — the lane is closed out on `integrate/phase-8-10-final` @ `e222657`

The gap this lane tracked — *nothing hands an approved draft to the launch* — is closed end to
end, and now has a whole-business regression test behind it
(`tests/golden-journey.test.ts`, 14/14): a human edits the model's draft while approving, the
edit becomes durable `SequenceStepCopy` before the first step is executable, and the
`OutboundMessage` carries those exact words with no AI provider configured.

The gates below are the 2026-08-09 run against `feat/automation-engine-pr` and are kept for the
record. Current candidate gates live in
[`../revenue-ai/STATUS.md`](../revenue-ai/STATUS.md) and the final acceptance report.

## Gates — verified 2026-08-09, local, against `feat/automation-engine-pr`

| Gate | Command | Result |
|---|---|---|
| Types | `NODE_OPTIONS=--max-old-space-size=8192 node node_modules/typescript/bin/tsc --noEmit` | 0 errors |
| Lint | `node node_modules/eslint/bin/eslint.js app components lib context tests` | 0 errors, 0 warnings |
| Unit/integration | `node node_modules/vitest/vitest.mjs run` | 791 passed, 5 skipped, 63 files |
| Migrations | `node node_modules/prisma/build/index.js migrate status` | up to date, 26 migrations |
| E2E | `BASE_URL=http://localhost:3001 node node_modules/@playwright/test/cli.js test e2e/journeys/automation.spec.ts e2e/roles/automation-roles.spec.ts` | 18 passed (9 setup + 9 spec) |

`eslint .` reports 380 errors — that is **not** a regression. The project's lint scope is
`eslint app components lib context tests` (see `package.json`); the extra errors are
`no-require-imports` in `scripts/*.cjs`, which are outside it by design.

## Running the E2E suite

The audit harness refuses the published demo password. `E2E_PASSWORD=telestar2026` fails at
`e2e/support/fixture.ts:67` with *"E2E_PASSWORD is the published demo password. Use a run-scoped
value."* Generate one, build the fixture, then run:

```bash
export E2E_PASSWORD="$(node -e "console.log('E2e!'+require('crypto').randomBytes(18).toString('base64url'))")"
ALLOW_E2E_FIXTURE=1 node node_modules/tsx/dist/cli.mjs scripts/e2e-audit-fixture.ts
BASE_URL=http://localhost:3000 node node_modules/@playwright/test/cli.js test e2e/journeys/automation.spec.ts e2e/roles/automation-roles.spec.ts
```

`scripts/e2e-audit-fixture.ts` refuses to run without `ALLOW_E2E_FIXTURE=1` and refuses any
`DATABASE_URL` host that is not `localhost`/`127.0.0.1`/`::1`. Prune the disposable accounts
afterwards with `--prune`.

## Two traps that cost time here

**Spec placement decides whether a spec runs at all.** `e2e/automation-journeys.spec.ts` sat at
the `e2e/` root, where no Playwright project matched it: the `audit` project's `testMatch` only
covers `e2e/(auth|roles|leads|…|journeys|resilience)/*.spec.ts`, and the `chromium` project runs
a hardcoded three-file `LEGACY_SPECS` list. It reported no failures because it never executed.
It now lives at `e2e/journeys/automation.spec.ts`. **Any new spec must go in one of the named
subdirectories** — putting it at the root silently disables it.

**Journey 4/5 asserted copy that never existed.** It waited on `Recent Automation Log`; the page
renders `Live Automation Activity Feed`. The assertion now targets the real heading and requires
the feed to resolve to either logged rows or the explicit empty state, so a silently failed fetch
fails the test instead of passing on an empty table.

## Constraints still in force

Inherited from `.claude/rules/runtime-hardening.md` and unchanged by this work:

- BullMQ is never the only source of truth — every delayed job is rebuildable from the database
- Eligibility is checked at scheduling time **and** re-checked at execution against live CRM state
- Every send goes through `OutboundMessage`; no direct provider send from an API route
- No `$transaction` in worker paths that run on the Neon HTTP driver
- Live sequence sending stays off and email stays in dry-run for the pre-domain phase
