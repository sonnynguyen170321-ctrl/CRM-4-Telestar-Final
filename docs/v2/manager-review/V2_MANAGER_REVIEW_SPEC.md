# V2 Manager Review Spec

Status: locked for MR1 schema review

## 1. Product definition

Manager Review is the tenant-scoped human decision queue for ambiguous, risky, or policy-sensitive lead work.

It records why a lead or source row needs human review, what object or evidence triggered the review, who owns the decision, what safe action is suggested, and how the review was resolved. It is a review and audit layer, not a hidden mutation engine.

## 2. Non-negotiable boundaries

- No automatic qualification mutation.
- No automatic `workflowStatus` mutation.
- No scoring snapshot mutation.
- No AI source-of-truth.
- No outreach/send action.
- No V1 reuse.
- All future mutations must use server tenant context and backend permissions.

Manager Review can recommend or approve later actions, but each action must be explicit, permission-gated, tenant-scoped, and audited by the phase that implements it.

## 3. First schema shape

This is a text-only schema proposal for `V2.MR1-SCHEMA`. This spec does not edit Prisma schema or create migrations.

```prisma
enum V2ManagerReviewStatus {
  OPEN
  IN_PROGRESS
  SNOOZED
  RESOLVED
  DISMISSED
  ARCHIVED
}

enum V2ManagerReviewPriority {
  LOW
  NORMAL
  HIGH
  CRITICAL
}

enum V2ManagerReviewConfidence {
  HIGH
  MEDIUM
  LOW
  UNKNOWN
}

enum V2ManagerReviewSourceType {
  HARD_RULE_ASSESSMENT
  MANUAL_SDR_REQUEST
  WORKFLOW_CONFLICT
  INGESTION_ROW
  IDENTITY_MATCH
  ACTIVITY_RECAP_ROW
  AI_SUGGESTION
  FEEDBACK_EXAMPLE
}

enum V2ManagerReviewReasonCode {
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
}

enum V2ManagerReviewResolutionType {
  APPROVE_CONFIRM
  REJECT_DISMISS
  REQUEST_CHANGES
  LINK_EXISTING
  CREATE_MISSING_ENTITY_LATER
  NO_ACTION_NON_ACTIONABLE
  CONVERT_TO_FEEDBACK_LATER
  UPDATE_WORKFLOW_STATUS_LATER
}

model V2ManagerReviewItem {
  id                     String @id @default(cuid())
  organizationId         String

  leadAssignmentId       String?
  hardRuleAssessmentId   String?
  projectId              String?
  companyId              String?
  contactId              String?
  icpVersionId           String?

  sourceType             V2ManagerReviewSourceType
  sourceId               String?
  sourceRefJson          Json?
  sourceFingerprint      String

  reasonCode             V2ManagerReviewReasonCode
  reasonDetail           String?
  suggestedAction        String?
  priority               V2ManagerReviewPriority @default(NORMAL)
  confidence             V2ManagerReviewConfidence @default(UNKNOWN)
  candidateSummariesJson Json?
  metadataJson           Json?

  status                 V2ManagerReviewStatus @default(OPEN)
  assignedToUserId       String?
  createdByUserId        String?
  resolvedByUserId       String?

  resolutionType         V2ManagerReviewResolutionType?
  resolutionNote         String?
  resolutionMetadataJson Json?
  dueAt                  DateTime?
  snoozedUntil           DateTime?
  resolvedAt             DateTime?
  archivedAt             DateTime?
  deletedAt              DateTime?
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt
}
```

Field rules:

- `organizationId` is required and is the tenant boundary.
- `leadAssignmentId` is nullable at schema level so future Activity Recap no-match rows can be reviewed before a `V2LeadAssignment` exists.
- Runtime must require `leadAssignmentId` for `HARD_RULE_ASSESSMENT`, `MANUAL_SDR_REQUEST`, and `WORKFLOW_CONFLICT`.
- `hardRuleAssessmentId` is optional and used for scoring-created review items.
- `projectId`, `companyId`, `contactId`, and `icpVersionId` are optional context fields.
- `sourceFingerprint` is required; it must not have a DB default.
- Use `priority` only in MR1. Do not add `severity` until semantics are clearer.
- Do not use `ASSIGNED` as a status; ownership is represented by `assignedToUserId`.

`OUTREACH_EVENT` is reserved for a future outreach/send phase only. It must not be included in the first schema enum.

MR1 uses `sourceType = ACTIVITY_RECAP_ROW` as the Activity Recap source origin. Activity Recap subtypes are represented by `reasonCode`, not separate `sourceType` enum values. This keeps `sourceType` focused on origin while preserving filter/query power through reason codes.

Activity Recap reason-code subtypes include:

- no match;
- multiple company/contact candidates;
- low-confidence match;
- status suggestion;
- possible duplicate activity;
- possible correction;
- stale activity date;
- company/domain conflict.

MR1-SCHEMA should not add back-relations to existing models:

- `V2Organization`;
- `V2LeadAssignment`;
- `V2HardRuleAssessment`;
- `V2User`.

Use explicit foreign-key id fields, indexes, and tenant-scoped queries. This keeps the first schema migration small, avoids bloating existing central models, and matches the current V2 pattern where critical runtime paths use explicit tenant filters. Back-relations can be reconsidered in a later ergonomics/refactor phase if runtime/query ergonomics require them.

## 4. Lifecycle

Allowed status transitions:

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

`SNOOZE` is not a resolution type. Snoozing is represented by `status = SNOOZED` plus `snoozedUntil`.

`ESCALATE` is not a resolution type. Escalation is represented by changing `assignedToUserId` and writing an audit event.

Snooze and escalation/reassignment are not resolution types:

```txt
snooze:
status = SNOOZED
snoozedUntil set
audit event written

escalation/reassignment:
assignedToUserId changed
audit event written
```

## 5. Permissions and roles

Current implementation strategy:

- `V2.MR1-SCHEMA`: no permission changes.
- `V2.MR2-RUNTIME`: use existing `manager_review.decide` as a temporary umbrella permission unless explicitly approved otherwise.
- Future granular permissions are deferred:
  - `manager_review.read`
  - `manager_review.create`
  - `manager_review.assign`
  - `manager_review.resolve`
  - `manager_review.dismiss`
  - `manager_review.reopen`

Initial role policy:

- `OWNER`, `ADMIN`, and `MANAGER` can decide review items.
- `TEAM_LEAD` can read/create review requests but cannot resolve, dismiss, or reopen by default.
- `SDR` can create manual review requests only on visible tenant-scoped leads, but cannot decide.

## 6. Idempotency

Active duplicate prevention:

```txt
one active review item per organizationId + sourceFingerprint
```

Active means:

```txt
status in OPEN, IN_PROGRESS, SNOOZED
and deletedAt is null
```

The schema phase should use a manual partial unique index because Prisma cannot express this active-only uniqueness cleanly.

`sourceFingerprint` requirements:

- non-empty;
- server-generated;
- deterministic;
- sha256 of a canonical string;
- no DB default;
- no empty string fallback;
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

The stored `sourceFingerprint` is the sha256 digest of the canonical input string, not the raw canonical string itself.

For `MANUAL_SDR_REQUEST`, do not include `createdByUserId` in the canonical input string. Active duplicate prevention should allow only one active manual review item per organization, lead assignment, and reason code. If multiple SDRs ask for the same lead/reason, that should not create duplicate active review items.

`createdByUserId` remains stored and audited separately through:

- `createdByUserId`;
- `metadataJson.requestedByUserId`;
- `V2AuditEvent.actorUserId`;
- audit metadata.

## 7. Audit events

Required audit events:

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

State-changing actions must write `V2AuditEvent` transactionally with the review item change.

Audit event mapping:

- `manager_review.item_started` means the lifecycle transition `OPEN -> IN_PROGRESS`.
- `manager_review.item_assigned` means `assignedToUserId` changed, including claim, reassignment, or escalation.

Minimum audit metadata:

- `membershipId`
- previous and next status when status changes
- previous and next assignee when assignment changes
- `sourceType`
- `sourceId`
- `sourceFingerprint`
- `reasonCode`
- `leadAssignmentId` when present
- `hardRuleAssessmentId` when present
- `resolutionType` when present
- `source`, such as `CRM_UI`, `SCORING`, `ACTIVITY_RECAP`, or `SYSTEM`

## 8. Safety and tenant isolation

Every future route/helper must:

- call `requirePermission`;
- derive organization, user, and membership from server context;
- never trust `organizationId`, `userId`, role, or permission from body or URL;
- filter all linked records by `organizationId`;
- return safe not-found for cross-tenant, deleted, inactive, or missing records;
- write `V2AuditEvent` transactionally for every state-changing action.

## 9. Relationship to WF1

Manager Review may recommend a workflow change later, but it must not mutate `workflowStatus` automatically.

Any later workflow bridge must call the existing tenant-safe WF1 workflow mutation path or an approved successor. Review resolution can record that a workflow update is approved later through `UPDATE_WORKFLOW_STATUS_LATER`, but that is not itself a workflow mutation.

## 10. Relationship to Activity Recap

MR0 reserves source fields so Activity Recap can later create review items for unmatched, ambiguous, or conflicting rows.

Activity Recap suggestions must not blindly mutate lead status. Activity Recap can later create review items for:

- no match from recap;
- multiple company or contact candidates;
- generic email only;
- fuzzy name only;
- no project context;
- possible duplicate activity;
- suggested status change;
- stale activity date;
- company domain conflict.

## 11. Relationship to Scoring

Scoring can later create review items from `NEEDS_REVIEW` or low-confidence assessments.

Scoring-created review items may reference `V2HardRuleAssessment`, but they must not mutate historical `V2HardRuleAssessment` rows, assessment snapshots, `qualification`, `fitScore`, `confidence`, or scoring metadata.

## 12. Relationship to FeedbackExample

Review resolution must not auto-create `V2FeedbackExample` in MR1.

Feedback conversion must be a later explicit action, permission-gated and audited. Until then, review items may only record `CONVERT_TO_FEEDBACK_LATER` as an approved future action.

## 13. Future phase split

- `V2.MR1-SCHEMA`: add schema/enums/indexes/manual partial unique index only.
- `V2.MR2-RUNTIME`: add tenant-safe runtime helpers/routes using `manager_review.decide` unless explicitly changed.
- `V2.MR3-UI`: add V2 Manager Review UI.
- `V2.SCORE-MR1`: create review items from scoring uncertainty.
- `V2.A2-INTEGRATION`: create review items from Activity Recap ambiguity/conflict.
- `V2.WF2`: workflow transition matrix and explicit review-approved workflow bridge.
- `V2.FEEDBACK1`: explicit review-to-feedback conversion.
