# V2 Workflow Linkage Contracts

Status: active workflow-governance contract for production-grade V2 sessions.

Purpose: prevent isolated session output. Every implementation session must prove
that its work consumes the previous workflow stage and produces an object,
state, or read model that the next stage can consume.

This document is not a feature prompt. It is the contract future prompts must
reference before code changes.

---

## 1. Non-Negotiable Session Block

Every V2 implementation prompt must include this block before allowed files:

```txt
WORKFLOW LINKAGE
Workflow stage:
Upstream objects consumed:
Objects created or updated:
Downstream consumers:
Idempotency key:
Tenant boundary:
User-visible proof:
Automated linkage proof:
```

If a session cannot fill the block with concrete model names, functions, routes,
or UI surfaces, it is not ready for implementation.

Planning-only sessions may use `none` for created/updated objects, but they must
state which future workflow stage their plan governs.

---

## 2. Canonical Production Spine

The V2 product spine is:

```txt
Product Context / ICP
-> Upload / Ingestion
-> Identity Resolution
-> LeadAssignment
-> Company Intelligence
-> Scoring
-> CRM Workspace
-> Manager Review
-> Feedback / ICP Tuning
-> Activity / SDR Management
-> Outreach
-> Webhooks / Suppression / Reporting
```

No page, handler, helper, model, job, or script should be added without a named
position in this spine.

---

## 3. Workflow Contracts

### 3.1 Product Context Contract

Canonical context:

```txt
organizationId
clientAccountId
projectId
offerId
icpProfileId
icpVersionId
```

Production rules:

- `organizationId` comes from authenticated tenant context, not a client param.
- Lead scoring requires `projectId` and `icpVersionId`.
- Upload, lead workspace, company workspace, export, and reports must use the
  same context semantics.
- A company by itself is not enough to score or export CRM work.

Downstream consumers:

```txt
upload
leads
companies
contacts
reports
exports
ICP editor
outreach targeting
```

Required proof:

- ContextBar URL params refilter the lead workspace.
- Uploaded rows create LeadAssignments under the selected project and ICP.
- Export/report counts match the same scoped LeadAssignment query.

### 3.2 Ingestion Lineage Contract

Canonical lineage:

```txt
V2IngestionJob.id
V2IngestionRow.id
sourceRowHash
normalizedRowJson.identityMatch
normalizedRowJson.leadAssignmentUpsert
V2Job source/idempotency metadata
```

Production rules:

- Every LeadAssignment created from upload must be traceable to an ingestion job
  and row.
- Ambiguous rows must create ManagerReviewItem records, not silent skips.
- Duplicate reruns must not create duplicate leads, review items, jobs, or
  assessments.

Downstream consumers:

```txt
progress UI
lead workspace lineage link
manager review
export audit
reports
```

Required proof:

- Lead rows can link to their source ingestion row.
- Progress counts reconcile row statuses, enrichment jobs, scoring jobs, and
  created LeadAssignments.
- Reprocessing the same job creates zero duplicate LeadAssignments and review
  items.

### 3.3 Identity Resolution Contract

Canonical outcomes:

```txt
exact
candidate
none
conflict
```

Production rules:

- Exact matches may auto-link.
- Candidate matches go to Manager Review.
- None matches may create new company/contact work only when enough identity is
  present.
- Conflicts never auto-link.
- Activity recap and LinkedIn import must reuse the same resolver; do not build a
  second resolver.

Downstream consumers:

```txt
ingestion
manager review
activity recap
contacts
LinkedIn import
outreach
```

Required proof:

- Shared resolver fixtures cover company upload, activity recap, and LinkedIn
  import cases.
- Candidate rows create exactly one active review item by fingerprint.
- Exact rows create or reuse exactly one active LeadAssignment per scope.

### 3.4 LeadAssignment Contract

Canonical unit:

```txt
organizationId
projectId
icpVersionId
companyId
contactId?
assignmentLevel
```

Production rules:

- LeadAssignment is the CRM work unit.
- Company-level and contact-level uniqueness are separate.
- Qualification comes from immutable HardRuleAssessment.
- `workflowStatus` is mutable workflow state on LeadAssignment.
- Contact evidence must not globally qualify a company.

Downstream consumers:

```txt
scoring
CRM
manager review
feedback
activity
outreach
reports
exports
```

Required proof:

- The same company can have different LeadAssignments across projects or ICPs.
- One active assignment exists per unique company/contact/project/ICP scope.
- No read model displays a global company qualification.

### 3.5 Company Intelligence Contract

Canonical output:

```txt
V2CompanyResearchSnapshot
V2CompanyIntelligenceProfile
neutral fact tokens
evidence pointers
research status
freshness / staleAt
```

Production rules:

- Intelligence facts are neutral, not verdicts.
- Company intelligence never stores fitScore, qualification, or workflow status.
- Failed, partial, blocked, no-website, and stale states are first-class states.
- The facts used by scoring must be visible in company/lead explainability.

Downstream consumers:

```txt
scoring
company brief
lead why drawer
reports
outreach personalization
```

Required proof:

- Scoring input reads the latest eligible intelligence profile.
- Company page and lead drawer show the same fact evidence used by scoring.
- Missing/stale enrichment is visible, not hidden.

### 3.6 Scoring Contract

Canonical output:

```txt
V2HardRuleAssessment
fitScore
confidence
qualification
accountPreRank
reason codes
evidenceSnapshotJson
rulesSnapshot
inputFingerprint
```

Production rules:

- HardRuleAssessment rows are immutable.
- The latest assessment pointer moves transactionally.
- `NOT_SCORED` is derived from `latestHardRuleAssessmentId IS NULL`.
- `UNCERTAIN` is deprecated and must not be written or surfaced as canonical V2
  output.
- Scoring should be fact-token driven, not dependent on scraped prose or demo
  keyword text.

Downstream consumers:

```txt
lead workspace
manager review
feedback
exports
reports
ICP tuning
outreach targeting
```

Required proof:

- Re-running identical scoring does not create duplicate assessments.
- Changing scoring input or ICP rules creates a new immutable assessment.
- Why drawer evidence matches persisted assessment snapshots.

### 3.7 Manager Review Contract

Canonical output:

```txt
V2ManagerReviewItem
sourceFingerprint
status
resolutionType
resolutionMetadataJson
audit event
```

Production rules:

- Review items are idempotent by source fingerprint.
- Resolution does not mutate historical assessments.
- Approved resolution may correct identity/workflow or enqueue scoring only
  through explicit audited paths.
- Convert-to-feedback creates immutable feedback evidence.

Downstream consumers:

```txt
CRM
feedback
reports
activity
data quality
```

Required proof:

- Ambiguous upload rows appear in review queue.
- Resolving a review item removes the active queue item and updates the intended
  downstream object.
- Re-running the producer does not create duplicate active review items.

### 3.8 Feedback Contract

Canonical output:

```txt
V2FeedbackExample
leadAssignmentId
hardRuleAssessmentId
aiInsightId?
corrected qualification/type/reason
approvedForLearning
datasetSplit
```

Production rules:

- Feedback is evidence, not automatic truth.
- Feedback never rewrites ICP rules automatically.
- Feedback links to immutable assessment snapshots.
- ICP authoring can surface feedback as tuning signal for the next version.

Downstream consumers:

```txt
ICP editor
ICP preview
reports
future benchmark/tuning
```

Required proof:

- Correcting a score creates a feedback row.
- The old assessment remains unchanged.
- ICP authoring or reporting can read aggregate feedback signals.

### 3.9 Activity Contract

Needed production output:

```txt
V2ActivityRecord or equivalent
leadAssignmentId
companyId
contactId?
actorUserId
channel
outcome
occurredAt
sourceActivityHash
source upload lineage
```

Production rules:

- Activity attaches to LeadAssignment.
- Fuzzy activity matches go to Manager Review.
- Tenant timezone is explicit.
- Duplicate recap uploads do not duplicate activity records.

Downstream consumers:

```txt
lead timeline
SDR management
manager queue
reports
outreach loop
```

Required proof:

- Activity recap upload creates activity on the correct LeadAssignment.
- Ambiguous activity rows produce review items.
- Duplicate recaps are idempotent by activity hash.

### 3.10 Outreach Contract

Needed production output:

```txt
sender
sequence
sequence step
outreach message
outreach activity
provider event
suppression check
```

Production rules:

- Suppression is checked synchronously immediately before provider send.
- Sends are job-backed and idempotent.
- Webhooks verify provider signatures before acting.
- Bounces create suppression and halt sequences.
- Outreach attaches to LeadAssignment/contact, not global company.

Downstream consumers:

```txt
activity timeline
workflowStatus
reports
manager queue
suppression
```

Required proof:

- Suppressed contacts cannot send.
- Successful sandbox send creates outreach activity.
- Unsigned webhook is rejected.
- Hard bounce creates suppression and blocks future sends.

---

## 4. Required Workflow Smoke Matrix

These checks are required as the corresponding production stages land.

### upload_to_scored_lead

```txt
Upload CSV
-> V2IngestionJob
-> V2IngestionRow
-> identityMatch
-> LeadAssignment
-> CompanyEnrichment
-> V2HardRuleAssessment
-> lead workspace row
-> company page evidence
```

Assertions:

- one active LeadAssignment per scope;
- lead row links to ingestion row;
- assessment evidence exists;
- company page shows same source fact family used by scoring.

### ambiguous_upload_to_review_resolution

```txt
Ambiguous upload row
-> candidate identity
-> V2ManagerReviewItem
-> resolve/link/create
-> LeadAssignment corrected
-> optional rescore
```

Assertions:

- exactly one active review item by source fingerprint;
- duplicate producer run creates no duplicate active review item;
- resolution writes audit event;
- old assessments remain immutable.

### lead_feedback_to_icp_tuning_signal

```txt
Lead score
-> SDR or manager correction
-> V2FeedbackExample
-> ICP tuning signal
```

Assertions:

- feedback links to assessment and LeadAssignment;
- old assessment and ICP rules remain unchanged;
- ICP editor/reporting can read aggregate feedback.

### activity_recap_to_lead_timeline

```txt
Activity recap upload
-> normalize/expand
-> shared identity resolver
-> ActivityRecord
-> lead timeline
-> SDR metrics
```

Assertions:

- duplicate recap upload creates no duplicate activities;
- fuzzy activity match creates review item;
- occurredAt and tenant timezone behavior are explicit.

### lead_to_suppressed_send_block

```txt
Lead/contact
-> compose/send request
-> synchronous suppression gate
-> provider send or block
```

Assertions:

- suppressed identifier blocks before provider call;
- non-suppressed sandbox send records outreach activity;
- secrets are not logged.

### send_to_webhook_to_activity

```txt
Provider event
-> signature verification
-> provider idempotency
-> outreach activity update
-> suppression/workflow/report update
```

Assertions:

- unsigned event is rejected;
- replayed event is ignored;
- hard bounce creates suppression and halts future sequence steps.

---

## 5. Current Coverage Snapshot

Already covered by existing scripts or tests:

- V2 job runtime idempotency/retry/stale handling.
- Identity resolver including Vietnamese normalization fixtures.
- Ingestion runtime including upload-to-lead/scoring portions.
- Company enrichment runtime and extraction tests.
- Score runtime smoke checks.
- Manager review runtime producer/lifecycle helpers.
- Workflow mutation smoke checks.

Known workflow coverage gaps:

- Review resolution to corrected LeadAssignment or feedback.
- Feedback capture to ICP tuning signal.
- Durable ActivityRecord workflow.
- Export source-of-truth workflow.
- Suppression gate and outreach send workflow.
- Signed webhook event workflow.
- Full UI-level authenticated SEE-IT for the complete upload-to-scored-lead path.

---

## 6. Prompt Template Addition

Append this to every future implementation prompt:

```txt
WORKFLOW LINKAGE
Workflow stage:
Upstream objects consumed:
Objects created or updated:
Downstream consumers:
Idempotency key:
Tenant boundary:
User-visible proof:
Automated linkage proof:

Stop condition:
- If any upstream object, downstream consumer, idempotency key, or tenant boundary
  cannot be named from the repo, stop and report a scope gap before coding.
```

---

## 7. Immediate Production Order

Recommended order after this governance gate:

```txt
UI0 shell contract
-> S1 ICP rules schema v2
-> S2 fact token vocabulary lock
-> S3 fact-driven scoring
-> C2 lead workspace production pass
-> R1 manager review resolution
-> S5 ICP authoring UI
-> C3 export source of truth
-> O1 outreach schema
-> O2 suppression gate
```

Do not begin outreach send work before the suppression gate exists and is tested.
