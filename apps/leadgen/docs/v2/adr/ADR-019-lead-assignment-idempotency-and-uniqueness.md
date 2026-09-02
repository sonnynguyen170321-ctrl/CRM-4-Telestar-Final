# ADR-019 - Lead Assignment Idempotency and Uniqueness

Status: Proposed for V2.CORE0 human review.

## Context

V2 needs a central working object for SDR-owned account and contact work. Company qualification cannot be treated as a single global truth because the same company may be scored differently by project, ICP version, assignment level, or contact context.

Bulk ingestion also needs deterministic behavior. Re-uploading the same lead source must update or reuse the same active assignment when identity is clear, and must not create duplicate SDR work.

## Decision

`LeadAssignment` is the central working object for V2 CRM/review workflows.

V2 supports both:

- company-level assignments
- contact-level assignments

Company-level active uniqueness:

```txt
organizationId + projectId + icpVersionId + companyId + assignmentLevel=company
```

Contact-level active uniqueness:

```txt
organizationId + projectId + icpVersionId + companyId + contactId + assignmentLevel=contact
```

Bulk ingestion must use deterministic idempotent upsert semantics. Fuzzy or ambiguous identity matches must create review candidates or manager review work, not duplicate active assignments.

## Rationale

This keeps scoring context, ownership, review state, and outreach workflow attached to the work item instead of mutating global company state. It also allows contact-specific persona readiness without overclaiming that a whole company is qualified.

## Scope

This ADR locks the V2 invariant only. V2.CORE0 does not create schema, runtime upsert code, APIs, UI, or migrations.

## Required invariants

- `LeadAssignment` is the canonical CRM work object.
- Qualification is scoped by organization, project, ICP version, company, assignment level, and optional contact.
- Active assignment uniqueness must prevent duplicate active company/contact work items.
- Ingestion upserts must be deterministic for clear identity matches.
- Ambiguous fuzzy matches must be review-safe.

## Explicit forbidden behavior

- Do not store company qualification as one global mutable company field.
- Do not create duplicate active assignments for the same scoped company/contact target.
- Do not auto-create assignments from ambiguous fuzzy identity matches.
- Do not use contact-level evidence to globally qualify the company.

## Future CORE1 schema implications

CORE1 should add or harden `LeadAssignment` with `assignmentLevel`, direct `organizationId`, project and ICP version scope, company/contact references, active-state handling, and composite active uniqueness.

Prisma nullable uniqueness may not express the required company/contact active uniqueness cleanly. CORE1 may need partial/manual SQL indexes for active assignments.

## Runtime/API/UI implications for later phases

Ingestion, scoring, activity recap apply, manager review, contacts, and CRM UI should read/write through `LeadAssignment` for SDR work state. Later APIs should expose assignment identity and review candidates explicitly.

## Conflict notes with existing ADRs

ADR-013 identity resolution remains the matching policy. This ADR defines what happens after identity is clear enough to create or upsert CRM work.

ADR-010 activity recap matching remains review-safe. Activity rows should not bypass these assignment uniqueness rules.

## Open questions

- Exact active-state column and index implementation are deferred to CORE1 planning.

## Human review gate

Human review must approve this ADR before CORE1 schema planning or any runtime assignment upsert implementation.
