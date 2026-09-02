# ADR-020 - Qualification vs Workflow Status Separation

Status: Proposed for V2.CORE0 human review.

## Context

V2 must distinguish scoring truth from operational state. A company or lead can be qualified by ICP rules while still being unworked, in review, suppressed, sequenced, contacted, or closed. Collapsing these concepts makes exports, manager review, SDR workflows, and scoring history unsafe.

## Decision

Qualification is ICP/scoring truth. `workflowStatus` is operational/outreach state.

Hard rule assessments are immutable historical scoring snapshots. Manager overrides or SDR review decisions may create feedback/review state, but must not mutate prior assessment history.

`LeadAssignment` should receive `workflowStatus` in CORE1.

## Rationale

This preserves a clean source of truth:

- scoring says whether the target fits the ICP
- workflow says what the business is doing with that target
- feedback/review says what humans corrected or approved

## Scope

This ADR applies to V2 scoring, lead assignments, review, outreach, and exports. V2.CORE0 does not implement schema, APIs, UI, or runtime behavior.

## Required invariants

- Qualification values come from immutable scoring/assessment outputs.
- Workflow status values describe operational state only.
- Outreach status is not scoring qualification.
- Human review must not rewrite historical scoring snapshots.
- Export source-of-truth must be able to distinguish assessment result from current operational state.

## Explicit forbidden behavior

- Do not encode outreach states as qualification values.
- Do not use `uncertain` as the canonical V2 qualification output.
- Do not mutate old `HardRuleAssessment` records after manager review.
- Do not let manager override erase assessment evidence.

## Future CORE1 schema implications

CORE1 should add `workflowStatus` to `LeadAssignment` and ensure hard rule assessment models remain immutable. Latest pointers may be added for list performance, but the pointed assessment remains historical.

## Runtime/API/UI implications for later phases

CRM and manager review UI should show qualification and workflow state as separate controls/columns. APIs should return both. Exports should use the reviewed/latest approved truth according to the export ADRs, not a collapsed status.

## Conflict notes with existing ADRs

ADR-014 evidence reliability/direction remains compatible because it describes scoring evidence quality. This ADR prevents evidence-derived qualification from being reused as workflow state.

V2.ICP1R guardrails require `QUALIFIED`, `NEEDS_REVIEW`, and `UNQUALIFIED`; this ADR keeps that separate from outreach workflow.

## Open questions

- Exact `workflowStatus` enum values are deferred to CORE1 planning.

## Human review gate

Human review must approve this ADR before CORE1 schema planning or any CRM/review UI uses workflow state.
