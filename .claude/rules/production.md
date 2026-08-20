---
paths:
  - docker-compose*.yml
  - Dockerfile*
  - .github/workflows/**
  - scripts/deploy*
  - scripts/prod-*
  - scripts/certification/**
  - scripts/build.cjs
domain: production-release
risk: R4
---

# Production and release

## Authorization boundary

No instruction to "fix everything", "make it green" or "work continuously" grants authority to
mutate production. Deploys, rollbacks, production database writes, production secret changes,
live destructive fixtures and mail-sending changes each require **explicit operator
authorization for that action**.

Read-only production diagnostics are a separate, lighter policy.

## Topology

Docker Compose on GCP with Cloud SQL. Web and workers are separate always-on containers;
workers are not serverless functions. `docker-compose.gcp.yml` is the production override and
`scripts/check-production-compose.mjs` asserts its invariants — Cloud SQL wiring, local
Postgres disabled, no port exposure.

Any document describing this deployment as Vercel + Neon is describing a topology this project
left. Correct it rather than following it.

## Releases have immutable identity

Build from the merge SHA. Record image repository, immutable SHA tag, digest, build SHA and
build timestamp. Deploy by digest or exact SHA. `latest` may exist as a convenience and is
never evidence of what is running.

Before deploying: current production commit and digest, new digest, Cloud SQL backup id and
timestamp, rollback image, rollback command. Verify the backup completed and the rollback
image exists. A rollback command that has never restored service is not a rollback plan.

## Evidence, not assertion

Certification verdicts are generated from evidence. Never hand-edit a generated certification
output; the generator owns the verdict.

Evidence must name the exact candidate SHA. If any runtime, test or configuration file changes
after certification begins, the old evidence is void — new SHA, new certification. Never
attach evidence gathered on one SHA to another.

Green means the gate ran and passed on this candidate. `BLOCKED_EXTERNAL` is not green.
`NOT_TESTED` is not green.

## CI gates must be ones this repository can actually run

Mandatory checks are decided by the `CI required checks` aggregate job, which encodes the
acceptable result for each job. Platform-dependent scanners (CodeQL, Dependency Review) are
additional signals and may be honestly red without blocking a release; the mandatory
dependency gate is `npm audit --audit-level=high`, which runs on every event and every plan.

Never make a mandatory check pass with `continue-on-error`, `|| true`, a weakened assertion or
an unreviewed skip. A diagnostic command may use `|| true` only when its output is not a gate
and the real gate has already failed.
