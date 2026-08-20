---
id: testing-certification
version: 1.0.0
domain: testing-certification
risk: R3
sources: [tests/**, e2e/**, scripts/certification/**, playwright.config.ts, vitest.config.ts]
---

# Testing and certification

**LOAD WHEN** changing the test harness, fixtures, evidence collection, or certification
validators.

**DO NOT LOAD WHEN** writing an ordinary test for a feature — the feature's own domain skill
covers that.

## The ladder

focused regression → domain tests → wider Vitest + relevant Playwright → every release gate.

Never run the full suite after a trivial edit. Never let focused tests substitute for the
release suite.

## Core invariants

- **Capture the exit code from the tool, never from a pipe.** `| tee`, `| tail`, `| grep` all
  report the last stage. A full session of green gates once hid a real type error this way.
  Record counts, not the word "PASS".
- **A gate must be able to fail for the right reason.** Assert the expected *count*, not merely
  the absence of failures — a loop over a discovered set that discovers nothing reports success.
- **Skips are classified**: intentional platform skip · temporary external prerequisite ·
  forbidden release skip. `.skip` added to make a candidate green is a defect.
- **`BLOCKED_EXTERNAL` is not green**, and neither is `NOT_TESTED`.
- **Certification verdicts are generated from evidence.** Never hand-edit generated output.

## Known failure modes

- **A spec that matches no Playwright project silently never runs.** The `audit` project's
  `testMatch` covers named subdirectories (`e2e/journeys/`, `e2e/roles/`, …); the `chromium`
  project runs a hardcoded list. A spec at the `e2e/` root belongs to neither. New specs go in
  a named subdirectory.
- **Shared-database interference.** Several DB suites call `deleteMany()` in `beforeEach` and
  share one database, so parallel files can wipe each other's rows. Re-run a suspect file
  alone before treating a failure as real.
- **The published demo password is refused** by the fixture guard. E2E needs a run-scoped
  password and the additive `pw-audit` fixture — which is idempotent and namespaced, so it
  never touches seeded demo rows.
- **E2E against `next dev`.** Run against a built app (`next build` + `next start`); the dev
  server's behaviour differs where it matters.
- **A mock that is more generous than reality.** A fixture returning a fixed non-zero cost for
  every call, including failures with no tokens, hid a settlement bug until settlement became
  per-attempt.

## Required tests

```
tests/certification-validator.test.ts   tests/certification-role-evidence.test.ts
tests/release.test.ts                   tests/render.test.ts
node scripts/check-test-discipline.mjs --ci
```

`check-test-discipline` runs twice: statically before the suite, and against the results
afterwards, because a suite can skip itself at runtime for a reason no grep predicts.

## Eval cases

- a suite silently stopped running → project `testMatch`, R3
- a candidate is green with a provider test skipped → skip classification, R4
- a certification document disagrees with the collected evidence → generator ownership, R4
