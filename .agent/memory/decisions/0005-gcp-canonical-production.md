---
id: ADR-0005
title: Docker Compose on GCP with Cloud SQL is canonical production
status: accepted
supersedes: an earlier Vercel + Neon topology
classification: CURRENT_CANONICAL
---

# ADR-0005 — GCP is canonical production

## Context

The project began on Vercel with a Neon Postgres database. Two properties of that stack fought
the product:

- **Serverless web only.** BullMQ workers must be always-on. They cannot live in a function that freezes between requests, so the workers needed a separate always-on host regardless.
- **No interactive transactions on the Neon HTTP driver.** Multi-step atomic work had to be written as single-statement compare-and-set, or given a second TCP connection.

## Decision

Production is **Docker Compose on GCP with Cloud SQL**. Web and workers are separate always-on
containers. `docker-compose.gcp.yml` is the production override.

## Why

Once the workers need an always-on host and the database needs a TCP path, the serverless
platform is providing routing and nothing else — while still imposing its constraints on every
piece of code that might one day run in it. Consolidating removes a whole class of "this works
locally, and in the worker, but not on the web tier" defects.

Cloud SQL matches the local PostgreSQL major version, so a migration replay locally is
evidence about production rather than an approximation.

## Consequences

- Any document describing this deployment as Vercel + Neon is describing a topology the project left. Correct it rather than following it — this is the single most common piece of stale architecture in older docs.
- Releases are built as images and deployed by immutable digest or exact SHA (see ADR-0006).
- `scripts/check-production-compose.mjs` asserts the topology invariants: Cloud SQL wiring, local Postgres disabled, no port exposure.
- The old driver constraint no longer binds new code, but code written under it still exists and is correct. `lib/admin/transferWork.ts` is deliberately idempotent-resumable rather than transactional; wrapping it in `$transaction` would look atomic without being atomic, because the `lib/prisma.ts` extensions defeat array batching.

## Protection

- `scripts/check-production-compose.mjs`, wired into CI as a mandatory gate
- `tests/doctor.test.ts`
- `.claude/rules/production.md` loads on any compose, workflow or deploy-script change
