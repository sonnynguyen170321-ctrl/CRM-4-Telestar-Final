# ADR-022 - Soft Delete and Data Retention

Status: Proposed for V2.CORE0 human review.

## Context

V2 must preserve auditability, scoring history, suppression evidence, and user trust. Hard deletes on mutable business records can break exports, assignment uniqueness, review history, and compliance investigation.

## Decision

Soft-delete core mutable entities by default:

```txt
Company
Contact
LeadAssignment
ICPVersion
MessageTemplate
Sequence
```

Join tables, log tables, event tables, immutable snapshots, and audit/event records are not soft-deleted by default.

Hard delete is allowed only for explicit privacy, legal, or cleanup workflows approved in a later phase.

## Rationale

Soft delete preserves history while letting UI and workflow hide inactive objects. It also protects assignment uniqueness and suppression/outreach safety from accidental data removal.

## Scope

This ADR defines retention policy only. V2.CORE0 does not add columns, migrations, cleanup jobs, UI, or APIs.

## Required invariants

- Core mutable business/config objects must support soft delete.
- Restore operations must be audited.
- Restore operations must be uniqueness-safe.
- Suppression evidence must not be casually deleted.
- Immutable history and audit records should remain append-only unless a specific privacy workflow applies.

## Explicit forbidden behavior

- Do not hard-delete core mutable business objects as the default action.
- Do not delete suppression evidence just because a related contact/company is deleted.
- Do not restore soft-deleted records in a way that violates active uniqueness.
- Do not use soft delete to hide unaudited destructive behavior.

## Future CORE1 schema implications

CORE1 should add `deletedAt` and `deletedBy` or equivalent fields to approved core mutable tables. Active uniqueness must account for soft-deleted records, likely with partial/manual SQL indexes where Prisma cannot express the policy.

## Runtime/API/UI implications for later phases

Later APIs should default to active records and require explicit include-deleted behavior. UI should make restore/destructive cleanup explicit. Cleanup/privacy workflows require separate approval.

## Conflict notes with existing ADRs

ADR-015 local-first migration and rollback remains compatible. Rollback is not the same as soft delete; both require audit-safe behavior.

ADR-017 dry-run and ADR-025 suppression gate rely on preserving suppression/send evidence.

## Open questions

- Exact retention periods and privacy deletion workflow are deferred to later compliance planning.

## Human review gate

Human review must approve this ADR before CORE1 schema planning or any delete/restore runtime behavior.
