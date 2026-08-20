---
id: workers-durability
version: 1.0.0
domain: workers-durability
risk: R3
sources: [workers/**, lib/bullmq/**, app/api/cron/**]
---

# Workers, queues, durability

**LOAD WHEN** changing queue behaviour, retries, leases, idempotency, cron, or job failure
handling.

**DO NOT LOAD WHEN** enqueueing from a route without changing job semantics.

## Runtime law

```
API route records intent.   Worker executes intent.   Database records truth.
UI reads database truth.    BullMQ can be rebuilt from database truth.
```

Queues execute; they do not decide. Redis is a cache tier — it gets flushed and failed over.
If the queue is also the record of intent, that loss is silent and unrecoverable, because
nothing in the database says the work was ever meant to happen.

Six queues: `agent` · `email` · `import` · `maintenance` · `sequence` · `sync`. Nine worker
entrypoints. Generated: `.agent/generated/queue-map.json`.

Workers are separate **always-on** processes, not serverless functions.

## Core invariants

- **Every retryable write needs a stable idempotency key**, derived from durable ids — never a
  timestamp, never a random value. A retry that duplicates a send or a task is a
  data-integrity defect. A prospect cannot be un-emailed.
- **Every worker writes `JobRun` progress**, and every state transition writes an
  Activity/audit row.
- **Every delayed job is rebuildable from the database.** `queue-reconciliation` exists for
  exactly this.
- **Every endpoint checks access before enqueueing.** Authorization after the job is queued is
  authorization after the fact.
- **No non-idempotent worker job.** Ever.

## Known failure modes

- **At-least-once delivery treated as exactly-once.** BullMQ will re-deliver. A handler that
  is correct only when run once is a handler that is incorrect.
- **Lease expiry during long work.** A job whose lease lapses can be picked up concurrently by
  another worker. Fencing exists; check it before extending a handler's runtime.
- **Losing the cost of a failed attempt.** Work that partially completed before failing has
  still consumed whatever it consumed. Settle it.
- **Shutdown that never completes.** A worker must exit on SIGTERM rather than being killed.
  The suite covering this needs a live Redis; without one it is `BLOCKED_EXTERNAL`, and on CI
  a skip means the service container is broken, not that the test is optional.
- **Reading queue state as truth.** Any UI or report sourced from BullMQ rather than the
  database is wrong the moment Redis is cleared.

## Required tests

```
tests/bullmq.test.ts             tests/queue-reconciliation.test.ts
tests/*-worker.test.ts           tests/failure-matrix.test.ts
tests/import-race-stress.test.ts tests/import-concurrency.test.ts
tests/redis-*.test.ts            (needs a live Redis)
```

## Eval cases

- a lead receives the same email twice after a retry → idempotency key, R3
- jobs sit at `queued` and never execute → connection or reconciliation, R3
- a deploy loses scheduled sends → rebuildability from the database, R3
