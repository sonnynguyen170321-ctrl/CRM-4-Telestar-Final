---
id: production-release
version: 1.0.0
domain: production-release
risk: R4
sources: [docker-compose*.yml, .github/workflows/**, scripts/prod-*, scripts/build.cjs, lib/env.ts]
---

# Production and release

**LOAD WHEN** changing compose topology, deployment, release identity, the environment
contract, or CI gates.

**DO NOT LOAD WHEN** running read-only production diagnostics.

## The boundary that is not negotiable

**No instruction grants production authority.** Not "fix everything", not "make it green", not
"work continuously". Deploys, rollbacks, production database writes, production secret changes,
live destructive fixtures and mail-sending changes each require **explicit operator
authorization for that action**.

Read-only diagnostics — health, served version, logs, attribution queries — are a separate,
lighter policy.

## Topology

Docker Compose on **GCP with Cloud SQL**. Web and workers are separate always-on containers.
`docker-compose.gcp.yml` is the production override; `scripts/check-production-compose.mjs`
asserts Cloud SQL wiring, local Postgres disabled, no port exposure.

**Any document describing this as Vercel + Neon is describing a topology this project left.**
It is the most common stale architecture claim in older docs. Correct it rather than following
it.

## Core invariants

- **Immutable identity.** Build from the merge SHA; deploy by digest or exact SHA. `latest` is
  a convenience and never evidence of what is running.
- **Evidence belongs to its candidate SHA.** A later edit to any runtime, test or config file
  voids it. Never attach evidence gathered on one SHA to another.
- **Certification verdicts are generated**, never asserted. The generator owns the verdict;
  generated output is not hand-edited.
- **Mandatory gates must be runnable here.** A required check that cannot pass on the current
  plan is not security — it is pressure to delete the check. Platform-dependent scanners
  (CodeQL, Dependency Review) are additional signals; the mandatory dependency gate is
  `npm audit --audit-level=high`, which runs on every event.
- **The image gate reads the mandatory aggregate**, not the workflow conclusion — otherwise an
  honestly-red optional scanner blocks every release forever.

## Before any mutation

Current production commit and image digest · new digest · Cloud SQL backup id and timestamp ·
rollback image · rollback command. **Verified present, not assumed.** A rollback command that
has never restored service is not a rollback plan.

## Known failure modes

- **`continue-on-error` / `|| true` / a weakened assertion** used to make a mandatory check
  pass. This converts a visible defect into an invisible one.
- **A gate that passes because it checked nothing.** Assert the expected count, not merely the
  absence of failures.
- **A piped exit code.** `tsc --noEmit | tail` reports `tail`. Capture the tool's own code.
- **Environment contract drift.** Three consumers read it — boot validator, deploy gate,
  generator — and they had already diverged over the AI provider keys.

## Required tests

```
tests/prod-env.test.ts        tests/release.test.ts
tests/cutover-preflight.test.ts   tests/doctor.test.ts
tests/certification-validator.test.ts
npm run check:production-compose  npm audit --audit-level=high
```

## Eval cases

- the served SHA does not match the release → immutable identity, R4
- CI is permanently red on a check nobody can fix → mandatory vs optional gates, R4
- a deploy proceeds with no verified backup → pre-mutation checklist, R4
