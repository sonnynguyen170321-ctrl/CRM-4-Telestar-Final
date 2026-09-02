# ADR-027 - V2 Manager Review Model and Boundaries

Status: Proposed for V2.MR1-SCHEMA human review.

## Context

V2 has tenant-safe identity/session handling, read-only CRM workspace, and the first scoped workflow mutation with transactional audit. Manager Review is still unimplemented.

V8 Enterprise requires Manager Review to be designed before schema, runtime, route, or UI work. Legacy `ManagerReviewItem` exists in V1-era activity recap code, but it is not V2 implementation authority because it is not built around V2 tenant context, `V2LeadAssignment`, immutable `V2HardRuleAssessment`, or the current audit pattern.

## Decision

Create a new V2-native Manager Review model in a later schema phase. The model will be tenant-scoped, review-safe, and centered on explicit human decisions.

Manager Review means:

```txt
the tenant-scoped human decision queue for ambiguous, risky, or policy-sensitive lead work
```

The first schema proposal is documented in `docs/v2/manager-review/V2_MANAGER_REVIEW_SPEC.md`.

## Locked schema decisions for MR1

- Add a new `V2ManagerReviewItem` model in MR1, not in MR0-DOCS.
- Require `organizationId`.
- Keep `leadAssignmentId` nullable at schema level.
- Require `leadAssignmentId` at runtime for scoring, manual SDR request, and workflow conflict sources.
- Allow optional `hardRuleAssessmentId` for scoring-created review items.
- Include optional context IDs for project, company, contact, and ICP version.
- Include `sourceType`, optional `sourceId`, optional `sourceRefJson`, and required `sourceFingerprint`.
- Use `priority` only: `LOW`, `NORMAL`, `HIGH`, `CRITICAL`.
- Do not add `severity` in MR1.
- Use `IN_PROGRESS`, not `ASSIGNED`, as the active working status.
- Represent ownership with `assignedToUserId`.
- Do not include `OUTREACH_EVENT` in the first source enum.
- Do not include `SNOOZE` or `ESCALATE` as resolution types.
- Do not add back-relations to `V2Organization`, `V2LeadAssignment`, `V2HardRuleAssessment`, or `V2User` in MR1.
- Use explicit foreign-key id fields, indexes, and tenant-scoped queries.

## Statuses

```txt
OPEN
IN_PROGRESS
SNOOZED
RESOLVED
DISMISSED
ARCHIVED
```

Allowed transitions:

```txt
OPEN -> IN_PROGRESS
OPEN -> SNOOZED
OPEN -> RESOLVED
OPEN -> DISMISSED
IN_PROGRESS -> OPEN
IN_PROGRESS -> SNOOZED
IN_PROGRESS -> RESOLVED
IN_PROGRESS -> DISMISSED
SNOOZED -> OPEN
SNOOZED -> IN_PROGRESS
RESOLVED -> OPEN via explicit reopen
DISMISSED -> OPEN via explicit reopen
RESOLVED/DISMISSED -> ARCHIVED for admin cleanup/hiding
```

## Source types

MR1 first schema enum:

```txt
HARD_RULE_ASSESSMENT
MANUAL_SDR_REQUEST
WORKFLOW_CONFLICT
INGESTION_ROW
IDENTITY_MATCH
ACTIVITY_RECAP_ROW
AI_SUGGESTION
FEEDBACK_EXAMPLE
```

`OUTREACH_EVENT` is reserved for a future outreach/send phase only.

`ACTIVITY_RECAP_ROW` is the only Activity Recap source origin in MR1. Activity Recap subtypes are reason codes, not separate source types. Examples include no match, multiple company/contact candidates, low-confidence match, status suggestion, possible duplicate activity, possible correction, stale activity date, and company/domain conflict. `sourceType` describes origin; `reasonCode` describes why the item needs review.

## Reason codes

MR1 should include a practical first list:

```txt
SCORING_NEEDS_REVIEW
MISSING_REQUIRED_EVIDENCE
LOW_CONFIDENCE_HARD_DISQUALIFIER
WEAK_COMPANY_ONLY_EVIDENCE
SDR_REQUESTED_REVIEW
WORKFLOW_STATUS_CONFLICT
NO_MATCH_FROM_RECAP
MULTIPLE_COMPANY_CANDIDATES
MULTIPLE_CONTACT_CANDIDATES
GENERIC_EMAIL_ONLY
FUZZY_NAME_ONLY
NO_PROJECT_CONTEXT
POSSIBLE_DUPLICATE_ACTIVITY
STATUS_CHANGE_SUGGESTED
STALE_ACTIVITY_DATE
COMPANY_DOMAIN_CONFLICT
AI_DISAGREEMENT
```

## Resolution types

```txt
APPROVE_CONFIRM
REJECT_DISMISS
REQUEST_CHANGES
LINK_EXISTING
CREATE_MISSING_ENTITY_LATER
NO_ACTION_NON_ACTIONABLE
CONVERT_TO_FEEDBACK_LATER
UPDATE_WORKFLOW_STATUS_LATER
```

`SNOOZE` is a status transition with `snoozedUntil`.

`ESCALATE` is an assignment/action with `assignedToUserId` and an audit event.

Snooze and escalation/reassignment are not resolution types. Snooze is represented by `status = SNOOZED`, `snoozedUntil`, and an audit event. Escalation/reassignment is represented by an `assignedToUserId` change and an audit event.

## Permissions

MR1-SCHEMA must not change tenant permission types or role policy.

MR2-RUNTIME may reuse existing `manager_review.decide` as a temporary umbrella permission unless explicitly approved otherwise.

Future granular permissions are deferred:

```txt
manager_review.read
manager_review.create
manager_review.assign
manager_review.resolve
manager_review.dismiss
manager_review.reopen
```

Initial role policy:

- `OWNER`, `ADMIN`, and `MANAGER` can decide.
- `TEAM_LEAD` can read/create review requests but cannot resolve, dismiss, or reopen by default.
- `SDR` can create manual review requests only on visible tenant-scoped leads, but cannot decide.

## Idempotency

Prevent duplicate active review work with:

```txt
one active review item per organizationId + sourceFingerprint
```

Active means:

```txt
status in OPEN, IN_PROGRESS, SNOOZED
and deletedAt is null
```

The schema phase should add a manual partial unique index because Prisma cannot express active-only uniqueness cleanly.

`sourceFingerprint` must be:

- non-empty;
- server-generated;
- deterministic;
- sha256 of a canonical string;
- stored without a DB default;
- never an empty string fallback;
- used for active duplicate prevention.

Canonical input examples:

```txt
HARD_RULE_ASSESSMENT:
v1|org:{organizationId}|source:HARD_RULE_ASSESSMENT|assessment:{hardRuleAssessmentId}|reason:{reasonCode}

MANUAL_SDR_REQUEST:
v1|org:{organizationId}|source:MANUAL_SDR_REQUEST|lead:{leadAssignmentId}|reason:{reasonCode}

ACTIVITY_RECAP_ROW:
v1|org:{organizationId}|source:ACTIVITY_RECAP_ROW|job:{ingestionJobId}|row:{sourceRowHash}|event:{eventIndexWithinRow}|reason:{reasonCode}
```

`MANUAL_SDR_REQUEST` must not include `createdByUserId` in the fingerprint. Active duplicate prevention is one active item per organization, lead assignment, and reason code. `createdByUserId` remains stored separately in `createdByUserId`, `metadataJson.requestedByUserId`, `V2AuditEvent.actorUserId`, and audit metadata.

## Audit

Required event names:

```txt
manager_review.item_created
manager_review.item_started
manager_review.item_assigned
manager_review.item_escalated
manager_review.item_snoozed
manager_review.item_resolved
manager_review.item_dismissed
manager_review.item_reopened
manager_review.item_archived
manager_review.item_metadata_updated
```

Every future Manager Review state-changing route/helper must write a `V2AuditEvent` transactionally with the review item change.

`manager_review.item_started` means `OPEN -> IN_PROGRESS`.

`manager_review.item_assigned` means `assignedToUserId` changed, including claim, reassignment, or escalation.

## Safety constraints

Future Manager Review runtime must:

- call `requirePermission`;
- derive organization, user, and membership from server context;
- never trust `organizationId`, `userId`, role, or permission from URL/body;
- filter every linked record by `organizationId`;
- return safe not-found for cross-tenant, deleted, inactive, or missing records;
- avoid automatic `qualification`, `workflowStatus`, scoring, job, feedback, or outreach mutations.

## Relationship to existing systems

WF1:

- Manager Review may recommend a workflow change later.
- It must not mutate `workflowStatus` automatically.
- Any later bridge must call the tenant-safe WF1 workflow mutation path or an approved successor.

Activity Recap:

- MR1 reserves source fields for unmatched, ambiguous, or conflicting recap rows.
- Activity Recap suggestions must not blindly mutate lead status.

Scoring:

- Future scoring integration can create review items from `NEEDS_REVIEW` or low-confidence assessments.
- It must not mutate `V2HardRuleAssessment`.

FeedbackExample:

- Review resolution must not auto-create `V2FeedbackExample` in MR1.
- Feedback conversion must be a later explicit action.

## Consequences

Positive:

- Manager Review is tenant-safe before runtime/UI work.
- Review dedupe is deterministic and auditable.
- Workflow, scoring, feedback, Activity Recap, and outreach boundaries remain separate.
- MR1 schema stays small by avoiding back-relations on existing central V2 models.

Tradeoffs:

- MR1 requires manual SQL for active-only uniqueness.
- Some source fields remain optional to support future Activity Recap no-match cases.
- Granular permission expansion is deferred.
- Back-relations may need to be reconsidered later if runtime/query ergonomics require them.

## Human review gate

Human review must approve this ADR and the companion spec before `V2.MR1-SCHEMA`.
