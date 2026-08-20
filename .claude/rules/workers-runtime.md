---
paths:
  - workers/**
  - lib/queue/**
  - lib/sequences/**
  - lib/automation/**
  - app/api/cron/**
domain: workers-durability
risk: R3
---

# Workers, queues, and scheduling

## Runtime law

```
API route records intent.   Worker executes intent.   Database records truth.
UI reads database truth.    BullMQ can be rebuilt from database truth.
```

Queues execute; they do not decide. Nothing reads BullMQ state as business truth.

## Forbidden

Direct provider send from an API route · an `email_sent` activity without provider success ·
sequence-field mutation through the generic Lead API · hard delete for archive · demo data as
a runtime dependency · blind tenant defaults in runtime writes · BullMQ-only state presented
as UI truth · deleting a sequence step while active enrollments exist · sending without a
suppression check · any non-idempotent worker job.

## Required

Every worker writes `JobRun` progress · every state transition writes an Activity/audit ·
every send goes through `OutboundMessage` · every delayed job is rebuildable from the database ·
every endpoint checks access **before** enqueueing work · every schema change carries Vitest
acceptance tests.

## Scheduling has exactly one owner

Nothing computes a schedule except `lib/automation/scheduling.ts` — not a component, not a
worker, not the preview endpoint. The preview calls the same function server-side precisely so
it cannot drift from what the worker does.

Jitter and A/B variant selection are seeded from durable ids
(`tenantId + sequenceId + stepId + leadId`), never `Math.random()`. That is why the sequence
builder reconciles steps by id instead of delete-and-recreate: new step ids would re-roll send
times and re-bucket every in-flight lead.

Quota exhaustion is a `DEFER`, not a permanent failure, and the deliverability preflight runs
*before* quota reservation so a blocked send never burns a slot.

## Idempotency

Every retryable write needs a stable idempotency key derived from durable ids. A retry that
duplicates a send, a task or an enrollment is a data-integrity defect.

Workers are separate always-on processes, not serverless functions. Multi-step atomic work
uses the direct TCP connection, not the HTTP driver, which has no interactive transactions.
