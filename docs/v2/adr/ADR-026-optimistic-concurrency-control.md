# ADR-026 - Optimistic Concurrency Control

Status: Proposed for V2.CORE0 human review.

## Context

Enterprise configuration records can be edited by multiple users or processes. Silent last-write-wins updates can overwrite ICP rules, templates, sequences, and future configuration without warning.

## Decision

Mutable configuration/versioned tables should use optimistic concurrency control.

Initial scope:

```txt
ICPVersion
MessageTemplate
Sequence
future config/versioned tables
```

CORE1 should add `version Int @default(1)` or equivalent where approved. Updates must check the expected version. Later APIs should return `409 Conflict` on version mismatch.

Published immutable records must not be edited in place.

## Rationale

OCC keeps collaborative edits safe without requiring pessimistic locks. It also preserves published configuration history and avoids accidental overwrites.

## Scope

This ADR defines concurrency policy only. V2.CORE0 does not add schema, APIs, UI, or runtime update handlers.

## Required invariants

- Mutable config updates must check expected version.
- Successful updates increment version.
- Version mismatch must not silently overwrite existing data.
- Published immutable records are not edited in place.
- Future config tables must be audited for OCC requirements.

## Explicit forbidden behavior

- Do not use silent last-write-wins for scoped configuration records.
- Do not edit published immutable records in place.
- Do not hide concurrent update conflicts from later API/UI callers.

## Future CORE1 schema implications

CORE1 should add `version Int @default(1)` or equivalent to approved mutable config tables and identify immutable/published records that require copy-on-edit behavior instead of direct updates.

## Runtime/API/UI implications for later phases

Later APIs should require expected version on updates and return `409 Conflict` when stale. UI should prompt users to refresh/reconcile instead of overwriting.

## Conflict notes with existing ADRs

ADR-006 ICP publish permission remains compatible. This ADR adds concurrency safety around draft/edit/publish workflows.

ADR-020 qualification vs workflow separation remains compatible because OCC applies to configuration, not immutable assessment history.

## Open questions

- Exact copy-on-edit behavior for each config type is deferred to CORE1 planning and later runtime phases.

## Human review gate

Human review must approve this ADR before CORE1 schema planning or mutable configuration update APIs.
