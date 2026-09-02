# ADR-021 - Async Job Processing Foundation

Status: Proposed for V2.CORE0 human review.

## Context

Enterprise-scale ingestion, scoring, AI insight generation, export generation, email send, and sequence execution cannot run as long synchronous HTTP requests. V2 needs an idempotent job foundation before high-volume runtime phases.

## Decision

`V2Job` belongs in CORE1 schema planning. JOB0 implements runtime processing later.

Initial job types:

```txt
ingestion_parse
ingestion_normalize
identity_match
lead_assignment_upsert
icp_score
activity_apply
export_generate
ai_insight_generate
email_send
sequence_step_execute
```

Lifecycle:

```txt
queued
running
succeeded
failed
cancelled
retry_scheduled
```

Required fields:

```txt
idempotencyKey
retryCount
errorCode
errorMessage
progressCurrent
progressTotal
sourceType
sourceId
```

## Rationale

A shared job model makes heavy work retryable, observable, tenant-scoped, and idempotent across ingestion, scoring, AI, exports, and outreach.

## Scope

This ADR defines the foundation only. CORE0 does not add Redis, BullMQ, worker code, job APIs, queues, or schema.

## Required invariants

- Heavy operations must not depend on long synchronous HTTP requests.
- Jobs must be idempotent by key and source.
- Jobs must expose progress and terminal state.
- Retry attempts must be counted and errors must be inspectable.
- Job source identity must be explicit.

## Explicit forbidden behavior

- Do not implement Redis/BullMQ in CORE0.
- Do not run high-volume ingestion/scoring/export/email work inside request/response handlers.
- Do not enqueue duplicate work when a matching idempotency key is active or completed.
- Do not hide failed job error codes from later UI/API surfaces.

## Future CORE1 schema implications

CORE1 should decide whether `V2Job` is added immediately or reserved for JOB0, but the schema plan must include tenant scope, idempotency, lifecycle, progress, retry, source identity, and error fields.

## Runtime/API/UI implications for later phases

JOB0 should provide worker-safe state transitions, retry policy, cancellation behavior, and status APIs. Later UI should show progress/status from jobs instead of assuming synchronous completion.

## Conflict notes with existing ADRs

ADR-012 unified ingestion remains the ingestion object model. This ADR adds the async execution boundary needed for high-volume ingestion.

ADR-016 degraded-state UX remains compatible because job status and errors provide the data needed for degraded UI states.

## Open questions

- Exact queue backend and worker deployment model are deferred to JOB0.

## Human review gate

Human review must approve this ADR before CORE1 schema planning or JOB0 runtime implementation.
