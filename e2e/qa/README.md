# QA lanes — exploratory scaffolding, not CI coverage

Nothing in this directory runs in CI, and nothing here should be read as coverage.

These files were written as an exploratory audit sweep: they drive the app as each persona,
write screenshots and run notes into `qa-runs/`, and record findings. That is useful work, and
it is not the same thing as a maintained regression suite.

## Why they are named `.qa.ts`

They used to be named `.spec.ts`, which reads as "this executes". It did not. `playwright.config.ts`
defines four projects — `setup`, `audit`, `demo`, `chromium` — and none of their `testMatch`
patterns cover `e2e/qa/`. Eight files sat here looking like tests and never ran once.

That mattered: `laneG` held the **only** browser assertion anywhere on the no-silent-removal
impact dialog — the rule `CLAUDE.md` names as *"the rule that must not regress"* — and it had
never executed. An independent audit found it. The same trap had already caught
`automation-journeys.spec.ts`, which is why `CLAUDE.md` warns that a spec at the `e2e/` root
matches no project and silently never runs.

`scripts/check-test-discipline.mjs` now fails CI if any `e2e/**/*.spec.ts` is matched by no
Playwright project, so this cannot recur. The `.qa.ts` extension is what keeps these files
outside that rule honestly — by not claiming to be specs — rather than by an exemption.

## Promoted so far

| Lane | Unique coverage | Status |
|---|---|---|
| `laneG` | impact dialog shows non-zero owned work; Confirm inert until a handling mode is named; Cancel is a true no-op; transfer moves work to the named target before removal | **Promoted** to `e2e/admin/member-removal-dialog.spec.ts`, rewritten against the maintained `e2e/support` fixture layer. The QA lane's artefact recorder was left behind on purpose — writing into the project directory triggered Fast Refresh, remounted the page mid-assertion, and forced that lane to demand a production build. |

## Not yet triaged

`laneA` `laneB` `laneC` `laneD` `laneE` `laneF` `_smoke`.

Each needs the same treatment: read it against what the maintained suites in `e2e/auth`,
`e2e/roles`, `e2e/leads`, `e2e/admin`, `e2e/meetings`, `e2e/reports` and `e2e/journeys` already
assert, promote whatever is genuinely unique, and delete the rest. Candidates already visible
from their titles — none verified as unique yet, none to be treated as coverage until they are:

- `laneA` 1.3 — the Demo Accounts panel exposing a shared password in plain text, and the
  low-privilege client-roster exposure probe via `/api/campaigns`. Both are security-shaped and
  belong in `e2e/roles` if they hold.
- `laneC` — the import wizard's five steps, dry run, error download and duplicate resolution;
  Vietnamese accented/unaccented search; the leadgen console losing filters on session
  revalidation.
- `laneE` — the booking-link waterfall and the client-report draft → approve → share-link flow.
- `laneF` — AI degradation with no provider key configured, which the Vitest suite covers at the
  service layer but nothing covers in a browser.

Until a lane is triaged, treat its findings as leads to investigate, not as passing tests.
