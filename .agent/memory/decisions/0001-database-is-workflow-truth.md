---
id: ADR-0001
title: The database is workflow truth; queues only execute
status: accepted
classification: CURRENT_CANONICAL
---

# ADR-0001 — The database is workflow truth

## Context

Sequence steps, imports, email sends and AI work orders all run asynchronously through BullMQ.
Every one of them has a state an operator can ask about: is this lead enrolled, has this
message gone, did the import finish. That state has to live somewhere.

## Decision

```
API route records intent.   Worker executes intent.   Database records truth.
UI reads database truth.    BullMQ can be rebuilt from database truth.
```

The queue is an execution mechanism. It is never the record of what is true, and no UI reads
it as one.

## Why

Redis is a cache tier. It gets flushed, it gets resized, a managed provider fails over and
loses in-flight state. If the queue is also the record of intent, that loss is silent and
unrecoverable: nothing in the database says the work was ever meant to happen, so nothing can
rebuild it and nothing can even report that it went missing.

Making the database authoritative means a lost queue is an availability problem — replay from
the database and continue — rather than a data-loss problem.

## Alternatives

- **Queue as source of truth.** Faster, fewer writes. Rejected: unrecoverable on Redis loss, and unqueryable for operators.
- **Dual-write with reconciliation.** Rejected: two truths and a reconciler is three things to get wrong; the reconciler becomes the real source of truth without saying so.

## Consequences

- Every worker writes `JobRun` progress and every state transition writes an Activity/audit row.
- Every delayed job must be rebuildable from the database — `queue-reconciliation` exists for exactly this.
- Extra writes on the hot path. Accepted.

## Protection

- `tests/queue-reconciliation.test.ts`
- `tests/bullmq.test.ts`
- `.claude/rules/workers-runtime.md` states the law where a worker change loads it
