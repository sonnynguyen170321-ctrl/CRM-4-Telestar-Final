---
title: "Lead Gen Intelligence - TeleStar SDR OS V2 Final Execution Plan V0.8 Enterprise"
subtitle: "Enterprise-ready SDR + Outreach OS execution plan after V2.ICP1R"
author: "Lead Gen Intelligence / TeleStar"
date: "2026-06-09"
---

# Lead Gen Intelligence - TeleStar SDR OS V2 Final Execution Plan V0.8 Enterprise

## Document Control

| Field | Value |
|---|---|
| Document version | V0.8 Enterprise |
| Replaces | V0.7 master plan / earlier pilot-oriented roadmap |
| Canonical status | Active source of truth for V2 execution planning as of 2026-06-09 |
| Current project state | V2.ICP1R completed as isolated pure TypeScript ICP evaluation harness |
| Strategic mode | Scalable Enterprise SaaS & Outreach OS foundation |
| Execution mode | V1 frozen; V2 side-by-side; enterprise backend invariants before UI/runtime |
| Immediate next phase | V2.CORE0 docs-only ADRs, then V2.CORE1 schema hardening |
| Explicit hold | Do not proceed to V2.A2 Manager Review UI, V2.9 app shell, V2.10 lead review UI, runtime scoring, ingestion runtime, outreach send, or sequence automation until approved |
| Primary source inputs | V0.7 final execution plan PDF, SESSION_LOG.md, V2_ENTERPRISE_ARCHITECTURE_SUMMARY.md |
| Intended use | Human planning, Claude/GPT/Gemini review, Codex phase prompts, repo-pinned planning artifact |

## 0. Executive Decision

Lead Gen Intelligence remains the umbrella project. TeleStar SDR OS V2 remains the first major product under it. The core product direction is unchanged: it is not a CSV filter and not a simple scoring helper. It is a Lead Gen + SDR Operating System designed to manage qualification, review, activity evidence, and eventually outreach.

The major change in V0.8 is strategic framing and phase order.

V0.7 framed the system as an enterprise-ready internal pilot with Stop & Ship checkpoints. V0.8 upgrades the framing to a scalable Enterprise SaaS & Outreach OS foundation. The project should still be phase-controlled and must not overbuild UI or automation early, but the backend invariants must be enterprise-grade before CRM UI, ingestion runtime, scoring jobs, or outreach automation are built.

### 0.1 Final V0.8 Verdict

**GO for V2.CORE0 planning and docs. CONDITIONAL GO for V2.CORE1 schema only after schema impact review. NO-GO for Manager Review UI or runtime features right now.**

The correct current sequence is:

```txt
V2.ICP1R completed and reviewed
-> V2.CORE0 enterprise backend invariants ADRs
-> human review of ADRs
-> V2.CORE1 schema hardening plan with current Prisma audit
-> human review
-> V2.CORE1 schema migration
-> V2.JOB0 async job engine
-> V2.INGEST-HV0 high-volume ingestion runtime
-> V2.SCORE-HV0 bulk scoring runtime
-> V2.CRM0 lead workspace and manager review UI
```

### 0.2 Why V2.A2 / CRM UI is paused

V2.A1 produced pure activity match confidence logic, but the enterprise architecture review exposed a more important risk: the backend schema is not yet hardened enough for scale, tenant isolation, high-volume jobs, outreach status transitions, suppression compliance, or sequence readiness.

Building Manager Review UI now would make the app feel productive in the short term, but it could hard-code weak assumptions:

- tenant filtering through long join chains instead of direct organization scoping;
- synchronous ingestion/scoring/export work that will time out at volume;
- duplicate LeadAssignment creation during bulk upload;
- mixing qualification state with outreach workflow state;
- missing suppression and final message snapshots before sending;
- hard-delete or cascade patterns that break audit/compliance later.

Therefore V0.8 intentionally stops the UI track and inserts CORE0, CORE1, and JOB0 before heavy runtime work.

---

# 1. Product Identity and Business Target

## 1.1 Product Name

| Level | Name |
|---|---|
| Umbrella project | Lead Gen Intelligence |
| First product | TeleStar SDR OS V2 |
| Product category | Enterprise Lead Gen + SDR + Outreach Operating System |
| Internal owner | TeleStar / Hao / Brand |

## 1.2 What V2 Must Become

V2 must help TeleStar answer operational questions that matter every day:

| Question | Product capability required |
|---|---|
| Which companies are worth working for this client/project/ICP? | ICP-scoped scoring and LeadAssignment qualification |
| Which contacts are usable and which identifiers are valid? | Contact + ContactIdentifier identity layer |
| Which leads are qualified, uncertain, unqualified, or need review? | HardRuleAssessment + ManagerReviewItem |
| What did each SDR actually do today/this week? | ActivityRecord + activity recap ingestion |
| Which activity rows are trusted vs ambiguous? | Activity match confidence resolver + review queue |
| Which leads should SDRs act on next? | Lead workspace + workflowStatus + OutreachTask |
| Can we safely email this person? | SuppressionEntry + sender account + final send gate |
| What happened after outreach? | EmailSend, EmailEvent, ActivityRecord, workflowStatus updates |
| Which ICP rules are working? | FeedbackExample, benchmark labels, scoring policy versions |

## 1.3 What V2 Must Not Become Too Early

V2 must not jump straight into a shiny UI or sequence engine before the backend is safe.

| Do not build yet | Why |
|---|---|
| Manager Review UI before CORE1 | Review objects may need tenant/idempotency/workflow changes first |
| CRM app shell before job foundation | UI will trigger long-running operations without queue safety |
| Bulk scoring from UI | Needs async job engine, immutable assessment snapshots, and latest assessment pointer |
| Real email send | Needs suppression, sender accounts, final message snapshot, audit, webhook idempotency |
| Sequence engine execution | Needs workflowStatus separation, stop conditions, sender limits, and job workers |
| Advanced theme/profile customization | Non-critical until core workflow is stable |
| AI autonomous learning | Must remain human-in-the-loop, benchmarked, and versioned |

---

# 2. V1 Boundary and Source-of-Truth Carryover

## 2.1 V1 Status

V1 is frozen as the legacy/LTS baseline. It already supports the core company-first workflow:

```txt
CSV upload
-> normalize and dedupe company rows
-> website research
-> hard-rule scoring
-> optional AI second opinion
-> SDR review and feedback overlay
-> export
-> contacts
-> activity recaps
-> manager review
```

V2 is side-by-side. No V2 phase may quietly modify V1 routes, V1 APIs, V1 scoring, V1 AI queue, V1 export, V1 feedback logic, or V1 migrations unless a phase explicitly approves it.

## 2.2 V1 Rules That Carry Forward

| Rule | V2 meaning |
|---|---|
| Deterministic rules are source of scoring truth | HardRuleAssessment is immutable deterministic assessment |
| AI is assistive | AiInsight is optional; never overwrites human final or deterministic truth |
| Human review is final overlay | SDR/Manager review decisions create review/feedback state, not mutation of old assessments |
| Export must be explicit | Export should clearly indicate final human review, deterministic result, and AI assistive output |
| Feedback is evidence, not self-learning | FeedbackExample is append-only tuning evidence; rule changes require human approval and benchmark |

## 2.3 V1 Import and Sunset

V2 can later import selected V1 data, but it must not silently mix old feedback or old scoring results into active V2 training/tuning.

| Data | V0.8 recommendation |
|---|---|
| V1 companies | Optional future import; not required for CORE0/CORE1 |
| V1 contacts | Optional future import; only after identity policy is locked |
| V1 feedback examples | Import only as `legacy_feedback` with provenance |
| V1 AI outputs | Do not use as V2 source-of-truth |
| V1 sunset | Only after V2 supports core qualification/review/export/action loop |

---

# 3. Current Repo Execution Checkpoint

This section summarizes completed work from SESSION_LOG.md. It is not a replacement for `git log`; before any Codex prompt, the agent must verify current branch, status, and recent commits.

## 3.1 Completed and Logged Phases

| Phase | Completed output | Runtime changed? | Schema/migration changed? | V1 touched? |
|---|---|---:|---:|---:|
| V2.1C | Placed reviewed V2 docs and guardrails | No | No | No runtime files |
| V2.1C.1 | Consolidated older V2 scoring research docs into reference/archive | No | No | No runtime files |
| V2.4D | Added missing ADRs for confidence aggregation and evidence reliability/direction | No | No | No |
| V2.5 | V2 enterprise foundation schema: organizations, users, teams, memberships, audit events | No | Yes | No |
| V2.6D | Product tree ADR cleanup | No | No | No |
| V2.6 | Product tree schema: client accounts, projects, offers, ICP profiles, ICP versions | No | Yes | No |
| V2.7 | Identity schema: companies, contacts, contact identifiers, lead assignments | No | Yes | No |
| V2.8 | Scoring persistence and feedback schema | No | Yes | No |
| V2.8D | Roadmap label reconciliation; V2.INGEST declared canonical next phase | No | No | No |
| V2.INGEST | Unified ingestion jobs/rows schema skeleton | No | Yes | No |
| V2.A0 | CanonicalActivityRow contracts + normalization helpers | No | No | No |
| V2.A0.1 | Docs-only activity and lead upload data flow spec | No | No | No |
| V2.A0.2 | Wide-row expansion contracts and sourceActivityHash TS contract | No | No | No |
| V2.A1 | Pure TS activity match confidence resolver | No | No | No |
| V2.ICP-HOLD | Human freeze after weak ICP benchmark and scoring runtime concerns | No | No | No |
| V2.ICP1R | Additive pure TS ICP rule schema and evaluation harness | No | No | No |

## 3.2 Current Important Runtime Boundary

As of V2.ICP1R, the project has a lot of schema, contracts, fixtures, and pure TypeScript logic, but it still does not have the full enterprise runtime pipeline.

| Area | Current status |
|---|---|
| ICP rule schema and evaluation harness | Pure TS done; isolated; verified |
| Old scoring core | Intentionally untouched by ICP1R |
| Runtime scoring integration | Not done |
| API routes for V2 scoring | Not done |
| UI for V2 scoring/review | Not done |
| Background scoring jobs | Not done |
| Ingestion runtime | Not done |
| Manager Review UI | Not done and explicitly paused |
| Outreach send | Not done |
| Sequence engine | Design later; not runtime |

## 3.3 Key Semantic Decisions Already Made

| Domain | Decision |
|---|---|
| V2.INGEST | Schema skeleton only; no parser, upload API, file serving, identity resolver, scoring, AI, V1 import/backfill |
| Ingestion schema | No `FUTURE_IMPORT`, no `clientAccountId`, no `icpVersionId`, single row status enum, matched company/contact as nullable lineage placeholders |
| Activity contracts | V2 CanonicalActivityRow is a redesign, not a V1 refactor |
| sourceActivityHash | Required in TypeScript only; not DB/schema/dedupe runtime yet |
| A1 resolver | Pure resolver logic only; no Prisma/V1 imports |
| Generic email | Cannot auto-match contact |
| Public email domain | Blocked from company-domain evidence |
| Phone match | Cannot auto-match contact alone |
| Contact/company mismatch | Forces needs_review |
| Exact company domain without contact/assignment | Suggested match, not auto_match |
| ICP1R qualification | Uses `QUALIFIED`, `NEEDS_REVIEW`, `UNQUALIFIED` in new harness |
| ICP1R confidence | New 0-100 `computeIcpConfidenceScore`; old 0-1 confidence remains untouched |
| Persona-sensitive evidence | Company-only evidence can pre-rank but cannot final-qualify without required persona/contact evidence |

---

# 4. Enterprise Architecture: 12 Layers

V0.8 treats these 12 layers as the main architecture map. CORE0 and CORE1 must lock the layers that affect schema and invariants before UI/runtime work.

## 4.1 Layer 1 - Tenant / Security Foundation

### Invariant

Every V2 business data table must have direct `organizationId`. Do not depend on long join chains for tenant filtering at scale.

### Tables requiring direct organizationId

| Category | Tables |
|---|---|
| Identity | V2Company, V2Contact, V2ContactIdentifier |
| Work objects | V2LeadAssignment |
| Scoring and feedback | V2HardRuleAssessment, V2AiInsight, V2FeedbackExample |
| Ingestion | V2IngestionJob, V2IngestionRow |
| Activity and review | V2ActivityRecord, V2ManagerReviewItem |
| Outreach | V2OutreachTask, V2EmailSend, V2SuppressionEntry, V2SequenceEnrollment |
| Jobs | V2Job |

### Design reason

Direct tenant scoping is mandatory for enterprise scale. It reduces tenant leak risk, simplifies authorization filters, and avoids slow joins for every list/query.

## 4.2 Layer 2 - Async Job Foundation

### Invariant

All heavy operations must run in background jobs. No high-volume ingestion, scoring, export, AI generation, email send, or sequence step should run as a long synchronous HTTP request.

### V2Job minimum model

| Field | Purpose |
|---|---|
| id | Job identifier |
| organizationId | Tenant boundary |
| jobType | What operation is being performed |
| sourceType | Origin object type, such as ingestion job or lead assignment |
| sourceId | Origin object ID |
| status | queued, running, succeeded, failed, cancelled, retry_scheduled |
| progressCurrent | Current processed count |
| progressTotal | Total count where known |
| startedAt | Worker start timestamp |
| completedAt | Success timestamp |
| failedAt | Failure timestamp |
| errorCode | Stable machine-readable error |
| errorMessage | Human-readable failure summary |
| retryCount | Number of retries attempted |
| idempotencyKey | Prevent duplicate job execution |

### Required job types

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

## 4.3 Layer 3 - Bulk Data and Idempotency Foundation

### Invariant

No duplicate active LeadAssignment.

LeadAssignment uniqueness must handle two levels:

| Assignment level | Unique meaning |
|---|---|
| company | organizationId + projectId + icpVersionId + companyId + assignmentLevel = company |
| contact | organizationId + projectId + icpVersionId + companyId + contactId + assignmentLevel = contact |

### Upsert policy

| Incoming row | Expected behavior |
|---|---|
| same company + same ICP + no contact | upsert company-level assignment |
| same company + same contact + same ICP | upsert contact-level assignment |
| same company + different contact + same ICP | create separate contact-level assignment |
| same company + same contact + different ICP | create separate LeadAssignment |
| fuzzy identity only | do not auto-upsert; create review candidate |

### Why nullable contact needs explicit strategy

A normal composite unique with nullable `contactId` can fail to prevent duplicate company-level assignments because null uniqueness behavior differs by database semantics. CORE1 must implement explicit company-level and contact-level uniqueness strategy.

## 4.4 Layer 4 - ICP Scoring Brain

### Invariant

Every HardRuleAssessment is immutable and explainable. Old assessments are never mutated.

### Required HardRuleAssessment fields

| Field | Purpose |
|---|---|
| organizationId | Tenant boundary |
| leadAssignmentId | Working object being assessed |
| projectId | Project context snapshot |
| icpVersionId | ICP rule version used |
| scoringPolicyVersion | Scoring code/policy version |
| fitScore | Final fit score |
| companyFitScore | Account/company component |
| personaFitScore | Contact/persona component |
| qualification | qualified, needs_review, unqualified, company_qualified_needs_contact |
| confidence | Evidence confidence |
| inputSnapshotJson | Input used at scoring time |
| rulesSnapshotJson | Rules used at scoring time |
| evidenceSnapshotJson | Evidence captured before scoring |
| matchedRulesJson | Positive rules matched |
| missedRulesJson | Required rules missed |
| negativeSignalsJson | Negative evidence found |
| reviewReasonsJson | Reasons for human review |
| explanation | Human-readable explanation |
| createdAt | Immutable creation time |

### Latest assessment pointer

LeadAssignment should store `latestHardRuleAssessmentId` to avoid expensive latest-assessment queries over high-volume tables.

## 4.5 Layer 5 - Qualification vs Workflow Status

### Invariant

Scoring qualification and operational workflow status must be separate.

| State type | Belongs to | Examples |
|---|---|---|
| Qualification | HardRuleAssessment | qualified, needs_review, unqualified, company_qualified_needs_contact |
| Workflow status | LeadAssignment | new, assigned, working, contacted, responded, meeting_booked, meeting_done, nurture, not_interested, bounced, suppressed, disqualified, archived |

### Why this matters

A lead can be structurally qualified but operationally should stop outreach because it bounced, replied, unsubscribed, booked a meeting, or became not interested. Sequence and task logic should depend on workflowStatus, not only qualification.

## 4.6 Layer 6 - Manager Review at Enterprise Scale

Manager Review is not just a drawer. It must support single-item resolution and bulk review.

### V2ManagerReviewItem minimum model

| Field | Purpose |
|---|---|
| organizationId | Tenant boundary |
| sourceType | Origin category, such as ingestion row, activity row, scoring result |
| sourceId | Origin object ID |
| sourceRefJson | Composite source reference for traceability |
| projectId | Project context |
| leadAssignmentId | Optional linked lead |
| companyId | Optional linked company |
| contactId | Optional linked contact |
| icpVersionId | Optional ICP context |
| reasonCode | Stable reason for review |
| severity | low, medium, high, critical |
| confidence | Match/decision confidence |
| suggestedAction | System-suggested safe action |
| candidateSummariesJson | Candidate matches shown to reviewer |
| status | open, assigned, resolved, ignored, rejected |
| assignedReviewerId | Owner of review task |
| resolutionAction | Final action chosen |
| resolutionNote | Manager note |
| resolvedByUserId | Resolver |
| resolvedAt | Resolution timestamp |
| createdAt | Creation timestamp |

## 4.7 Layer 7 - ActivityRecord Truth Layer

### Invariant

ActivityRecord is append-only. It is the historical event log.

Activity outcomes can suggest LeadAssignment workflow status changes, but should not blindly mutate status except for explicitly approved safe cases.

| Activity outcome | Suggested workflow effect |
|---|---|
| meeting_booked | Can suggest or safely set meeting_booked if policy allows |
| meeting_done | Can suggest meeting_done |
| positive_response | Suggest responded / follow-up priority |
| bounced | Suggest bounced and contact identifier invalid |
| not_interested | Suggest not_interested / nurture / closed path |
| wrong_person | Suggest contact invalid / find new contact |

## 4.8 Layer 8 - OutreachTask Layer Before Send

Outreach is broader than email. V2 needs a task bridge before full automation.

### V2OutreachTask minimum model

| Field | Purpose |
|---|---|
| organizationId | Tenant boundary |
| projectId | Project context |
| leadAssignmentId | Lead to act on |
| assignedToUserId | SDR owner |
| taskType | call, linkedin, email, follow_up, research, manual_note |
| channel | email, linkedin, call, whatsapp, zalo, other |
| dueAt | Scheduled due time |
| status | open, in_progress, completed, skipped, cancelled |
| priority | low, normal, high, urgent |
| sourceType | Created from review, scoring, sequence, manual, activity |
| sourceId | Origin ID |
| completedAt | Completion time |
| completedActivityRecordId | Activity created when task completed |
| createdByUserId | Creator |

## 4.9 Layer 9 - Suppression / Compliance Gate

### Invariant

No email send job can leave the system without a synchronous suppression check immediately before provider API call.

### V2SuppressionEntry minimum model

| Field | Purpose |
|---|---|
| organizationId | Tenant boundary |
| scopeType | global, organization, project, domain, identifier |
| scopeId | Optional scoped target |
| identifierType | email, domain, contact, company |
| identifierValueNormalized | Suppressed normalized value |
| suppressionType | bounce, unsubscribe, blacklist, manual, compliance, invalid |
| reason | Human-readable reason |
| source | provider_webhook, manual, import, system |
| createdByUserId | Creator if manual |
| createdAt | Creation timestamp |
| expiresAt | Optional expiry |

## 4.10 Layer 10 - Template and Message Snapshot

### Invariant

Every real email send stores the final rendered message snapshot. Never store only `templateId`.

### Required EmailSend snapshot fields

| Field | Purpose |
|---|---|
| finalSubject | Exact subject sent |
| finalBody | Exact body sent |
| recipientEmail | Final recipient |
| senderEmail | Final sender |
| templateId | Template source |
| templateVersionId | Template version source |
| variablesSnapshotJson | Variables at render time |
| suppressionResultJson | Final suppression result |
| renderedAt | Render timestamp |
| sentAt | Send timestamp |
| provider | Gmail, Workspace, SMTP, etc. |
| providerMessageId | Provider message reference |

## 4.11 Layer 11 - Sender Accounts / Provider Integration

### V2SenderAccount minimum model

| Field | Purpose |
|---|---|
| organizationId | Tenant boundary |
| userId | Optional owner user |
| teamId | Optional team owner |
| provider | gmail, workspace, smtp, other |
| emailAddress | Sender email |
| displayName | Sender name |
| status | active, paused, revoked, error |
| dailyLimit | Daily send limit |
| hourlyLimit | Hourly send limit |
| warmupState | cold, warming, warm, paused |
| lastUsedAt | Last send time |
| credentialRef | Encrypted credential reference |

Credentials need encrypted storage, rotation policy, revoked status, and provider-specific failure handling. Gmail/Workspace OAuth is preferred for MVP if available.

## 4.12 Layer 12 - Sequence Engine

Design now, build later.

### Core entities

```txt
V2Sequence
V2SequenceVersion
V2SequenceStep
V2SequenceEnrollment
V2SequenceEnrollmentStep
V2SendAttempt
V2SequenceStopCondition
```

### Sequence invariants

| Invariant | Meaning |
|---|---|
| One active enrollment | One active enrollment per LeadAssignment per Sequence |
| Versioned sequence | Existing enrollments continue on assigned version unless migrated |
| Stop conditions | Reply, positive reply, meeting booked, manual stop, bounce, unsubscribe, suppressed, lead disqualified, project closed, contact invalid |
| Job-driven execution | Sequence steps execute through workers, not synchronous UI |
| Suppression final gate | Even sequence email must pass synchronous suppression before provider call |

---

# 5. System-Level Blindspots to Fix in CORE1

## 5.1 Soft Delete and Data Retention

Core records should not be hard-deleted in normal workflows.

| Entity | Required fields |
|---|---|
| V2Company | deletedAt, deletedBy |
| V2Contact | deletedAt, deletedBy |
| V2LeadAssignment | deletedAt, deletedBy |
| V2ICPVersion | deletedAt, deletedBy |
| V2MessageTemplate | deletedAt, deletedBy |

Hard delete causes audit gaps, broken foreign keys, and bad compliance posture. CORE1 should add soft-delete fields to core entities and future runtime must filter active records by default.

## 5.2 Audit Log Explosion Control

Bulk operations should not create one audit row per touched row by default.

| Anti-pattern | Correct pattern |
|---|---|
| 100,000 AuditEvent rows for one import | One parent AuditEvent with JSON summary and jobId |
| unbounded audit table forever | Retention/partitioning strategy or archival path |
| no payload snapshot | Include counts, filters, actor, target scope, and source job |

## 5.3 Webhook Idempotency

Outreach webhook events can be duplicated or arrive out of order. V2EmailEvent must enforce unique `providerEventId`.

| Event type | Idempotency behavior |
|---|---|
| bounce | Store once; update workflow/suppression once |
| reply | Store once; stop sequence once |
| unsubscribe | Store once; create suppression once |
| delivered/open/click later | Store event once if enabled; do not duplicate counters blindly |

## 5.4 Optimistic Concurrency Control

Config records edited by managers need a version column.

| Config table | Required field |
|---|---|
| V2ICPVersion | version default 1 |
| V2MessageTemplate | version default 1 |
| V2Sequence | version default 1 |

Runtime updates must check version to avoid manager A overwriting manager B's changes.

## 5.5 Async Export

Exports must be job-based.

| Old/simple pattern | Enterprise pattern |
|---|---|
| User clicks export and waits for HTTP response | User creates export job |
| API builds large CSV synchronously | Worker builds export file |
| Browser receives long download | Storage receives file; UI gets signed URL |
| Retry is unclear | Job can fail, retry, or be recreated safely |

---

# 6. Core Data Model V0.8

## 6.1 Central Product Object

LeadAssignment remains the center of V2.

A company is not globally qualified forever. A company can be qualified for Project A / ICP Version 1, unqualified for Project B / ICP Version 2, and needs_review for Project C due to missing evidence.

Therefore:

| Object | Scope |
|---|---|
| Company | Global tenant-scoped company identity |
| Contact | Global tenant-scoped person identity |
| LeadAssignment | Company/contact/project/ICP working object |
| HardRuleAssessment | Immutable score for one LeadAssignment and ICPVersion |
| WorkflowStatus | Operational state on LeadAssignment |
| ActivityRecord | Append-only evidence of work performed |
| ManagerReviewItem | Human decision queue for ambiguity/conflict |

## 6.2 Product Hierarchy

```txt
Organization
-> User / Team / Membership
-> ClientAccount
-> Project / Engagement
-> Offer / Product
-> ICPProfile
-> ICPVersion
-> Company
-> Contact / ContactIdentifier
-> LeadAssignment
-> HardRuleAssessment / AiInsight / FeedbackExample
-> ManagerReviewItem
-> ActivityRecord
-> OutreachTask
-> EmailSend / SuppressionEntry / EmailEvent
-> SequenceEnrollment later
```

## 6.3 Qualification and Workflow State Model

### Qualification values

| Qualification | Meaning |
|---|---|
| qualified | Sufficient evidence that lead fits ICP |
| company_qualified_needs_contact | Company fits but persona/contact requirement is incomplete |
| needs_review | Evidence is incomplete, conflicting, or low confidence |
| unqualified | Strong evidence lead does not fit ICP |

### Workflow statuses

| Workflow status | Meaning |
|---|---|
| new | Created but not assigned/started |
| assigned | Owned by SDR/team |
| working | Active outreach/research in progress |
| contacted | Contact attempt made |
| responded | Reply/response received |
| meeting_booked | Meeting booked |
| meeting_done | Meeting completed |
| nurture | Keep for later |
| not_interested | Explicit negative response |
| bounced | Email bounce or invalid delivery |
| suppressed | Blocked by suppression/compliance |
| disqualified | Operationally disqualified by human/process |
| archived | No longer active but retained |

## 6.4 Why Separation Is Non-Negotiable

| Scenario | Qualification | Workflow status | Correct behavior |
|---|---|---|---|
| Great ICP fit, first email sent | qualified | contacted | Continue follow-up if no stop condition |
| Great ICP fit, replied positively | qualified | responded | Stop sequence; create follow-up task |
| Great ICP fit, bounced | qualified | bounced | Stop email; mark identifier invalid/suppressed |
| Good company, no persona | company_qualified_needs_contact | new/working | Research contacts, do not final-qualify contact-level yet |
| Not interested reply | qualified or needs_review | not_interested | Stop outreach regardless of structural fit |

---

# 7. ICP Scoring Runtime Direction

## 7.1 Current ICP1R Boundary

V2.ICP1R is complete as an additive pure TypeScript schema and evaluation harness. It proves rules can parameterize qualification and that the same company data can score differently against different ICPs.

It does not yet:

- create database assessments;
- call APIs;
- run background scoring jobs;
- update LeadAssignment latest assessment pointer;
- power UI;
- run live AI benchmark automation;
- mutate old scoring core.

## 7.2 ICP Runtime Principles

| Principle | Rule |
|---|---|
| ICPVersion rules are parameterized | No global hardcoded ICP assumptions where client/project rules should control behavior |
| Published ICPVersion is immutable | Changes create new version, not in-place edits |
| Assessment is immutable | Never update old HardRuleAssessment; create new snapshot |
| Evidence before hard gates | Collect evidence before applying service-only or disqualifying gates |
| Fit vs confidence split | Fit score is how good the match is; confidence is evidence trust |
| Company vs persona split | Company fit and persona/contact fit are separate components |
| Missing website is policy-driven | Can be terminal, review_required, or continue_low_confidence based on ICP |
| Human feedback is tuning evidence | Feedback does not auto-apply rule changes |

## 7.3 Score Snapshot Requirements

Every runtime score must capture:

| Snapshot | Purpose |
|---|---|
| inputSnapshotJson | What data was scored |
| rulesSnapshotJson | Which ICP rules were used |
| evidenceSnapshotJson | Evidence found and reliability/direction |
| matchedRulesJson | Positive matches |
| missedRulesJson | Required evidence missing |
| negativeSignalsJson | Negative evidence |
| reviewReasonsJson | Why human review is needed |
| scoringPolicyVersion | Which evaluator/policy produced the result |

## 7.4 Human-Final Benchmark Requirement

Do not claim production accuracy from agent-only benchmark output.

| Benchmark source | How to use |
|---|---|
| Gemini/Claude/GPT agent review | Useful disagreement signal and reasoning data |
| Human SDR/manager final labels | Required before claiming actual scoring accuracy |
| Weak benchmark labels | Useful for finding rule gaps, not production truth |
| 200+ reviewed examples | Minimum practical calibration base for evidence weights and confidence priors |

---

# 8. Unified Ingestion V0.8

## 8.1 Scope

V2 uses one ingestion framework for:

```txt
company_upload
contact_upload
activity_recap
future_enrichment_import
pipeline_snapshot later
meeting_tracker later
```

Do not create separate upload systems for company qualification and activity recap. They need the same foundations: file upload, mapping, normalization, validation, traceability, idempotency, rollback, and error reporting.

## 8.2 Current State

V2.INGEST added only schema skeleton. It did not add runtime parsing, upload API, file serving, resolver behavior, scoring execution, AI calls, V1 import, or TypeScript ingestion runtime.

## 8.3 Ingestion Runtime Direction

The enterprise version becomes `V2.INGEST-HV0` and must run through jobs.

```txt
User uploads file
-> create V2IngestionJob
-> store source file metadata
-> create V2Job ingestion_parse
-> worker parses rows
-> create V2IngestionRows
-> mapping confirmation
-> create V2Job ingestion_normalize
-> normalize rows
-> create V2Job identity_match
-> match company/contact candidates
-> create V2Job lead_assignment_upsert
-> idempotently create/update LeadAssignments
-> create ManagerReviewItems for ambiguous rows
```

## 8.4 Row Traceability

Every row must preserve raw and normalized states.

| Field | Purpose |
|---|---|
| sourceRowNumber | User-facing row location |
| sourceRowHash | Row-level dedupe within job |
| rawRowJson | Original row content |
| normalizedRowJson | Normalized row content |
| validationStatus | valid, invalid, needs_review |
| flagsJson | Warnings, missing fields, unsafe conditions |
| matchedCompanyId | Nullable lineage candidate after resolver |
| matchedContactId | Nullable lineage candidate after resolver |
| sourceActivityHash | Event-level hash for wide-row expansion, TS/runtime contract first |

---

# 9. Activity Recaps V0.8

## 9.1 Product Role

Activity Recaps remain a core product pillar because TeleStar is an SDR/BPO operation. Management needs to see activity volume, quality, outcomes, meeting progress, and ambiguous activity rows.

## 9.2 Current State

| Phase | Output |
|---|---|
| V2.A0 | CanonicalActivityRow contracts and normalization |
| V2.A0.1 | Activity and lead upload data-flow spec |
| V2.A0.2 | Wide-row expansion contracts and sourceActivityHash |
| V2.A1 | Pure activity match resolver |

## 9.3 Enterprise Runtime Direction

Activity runtime is no longer the immediate next phase. It moves after CORE0, CORE1, JOB0, INGEST-HV0, SCORE-HV0, and CRM0 as `V2.ACTIVITY0`.

```txt
Upload activity recap
-> ingestion job parses file
-> normalize to activity candidate events
-> resolver matches company/contact/LeadAssignment candidates
-> high-confidence rows create ActivityRecord
-> low/medium/conflicting rows create ManagerReviewItem
-> safe status suggestions may be proposed
-> human review resolves ambiguous cases
```

## 9.4 Activity Status Mutation Policy

ActivityRecord should not blindly mutate LeadAssignment.workflowStatus except in explicitly approved safe cases. Default behavior is suggestion + review.

| Case | Default action |
|---|---|
| exact lead match + meeting booked | can set or suggest meeting_booked depending on policy |
| exact lead match + bounced | suggest bounced and identifier invalidation |
| low-confidence match | create ManagerReviewItem |
| contact-company mismatch | create ManagerReviewItem |
| outcome conflicts current workflow status | create ManagerReviewItem |
| unmatched company/contact | create review candidate or create-from-recap path |

---

# 10. Manager Review V0.8

## 10.1 Why Manager Review Is Paused

The Review UI itself is not wrong. The timing is wrong. V2.A2 should not proceed until CORE1 schema defines the enterprise ManagerReviewItem shape, tenant scoping, source references, workflow status separation, and job-driven source objects.

## 10.2 Required Review Item Sources

| Source type | Example reason |
|---|---|
| ingestion_row | missing required data, invalid row, duplicate ambiguity |
| identity_match | no match, multiple candidates, fuzzy only |
| activity_event | low confidence match, outcome conflict |
| hard_rule_assessment | needs_review qualification, missing required evidence |
| ai_insight | stale AI insight, low confidence AI disagreement |
| feedback_example | SDR correction requiring manager validation |
| outreach_event | bounce/unsubscribe/reply conflict |

## 10.3 Review Resolution Actions

| Action | Meaning |
|---|---|
| approve_match | Accept suggested company/contact/lead assignment |
| reject_match | Reject suggested match |
| create_company | Create company from source row |
| create_contact | Create contact from source row |
| link_existing_company | Link row to existing company |
| link_existing_contact | Link row to existing contact |
| create_lead_assignment | Create working lead assignment |
| update_workflow_status | Apply approved operational status change |
| ignore | Mark non-actionable |
| escalate | Assign to higher role |
| convert_to_feedback | Store as FeedbackExample |

## 10.4 Bulk Review Requirements

Before UI, model must support:

- assigned reviewer;
- severity;
- reason code;
- suggested action;
- candidate summaries;
- status;
- resolution action;
- resolution note;
- source ref;
- audit link;
- tenant scope.

---

# 11. Outreach Architecture V0.8

## 11.1 Outreach Is Later, But Its Invariants Are Now

Real sending and sequence execution are later. But schema decisions for workflowStatus, suppression, sender accounts, message snapshots, and job execution must be designed before outreach begins.

## 11.2 Outreach Build Order

| Phase | Purpose |
|---|---|
| TASK0 | Manual task queue for SDR action before automation |
| OUTREACH-INFRA0 | Templates, variable render, suppression model, dry-run |
| SEND1 | Real manual single send |
| SEQ0 | Sequence foundation schema and logic |
| SEQ1 | Controlled sequence sending |

## 11.3 Suppression First Principle

No email leaves the system unless the last step before provider call checks suppression synchronously.

Suppression checks should cover:

| Scope | Examples |
|---|---|
| Identifier | exact recipient email suppressed |
| Domain | whole domain blocked |
| Contact | contact-level suppression |
| Company | company-level suppression |
| Project | client/project suppression list |
| Organization | Telestar-wide suppression |
| Global | legal/compliance block |

## 11.4 Final Message Snapshot

Every real send must store what was actually sent.

This protects:

- audit trail;
- client reporting;
- debugging;
- compliance;
- template version changes;
- future sequence analysis.

---

# 12. ThemeProfile V0.8

ThemeProfile stays in the roadmap, but it remains non-critical.

## 12.1 Allowed Early Later

| Allowed | Boundary |
|---|---|
| accent color | user-level or project-level only |
| compact/comfortable density | safe UI preference |
| saved table views | productivity feature |
| saved columns | productivity feature |
| default landing page | user/team preference |
| project/account emoji/icon | lightweight personalization |

## 12.2 Forbidden

| Forbidden | Why |
|---|---|
| arbitrary CSS | support and security risk |
| layout builder | scope explosion |
| custom workflow stages via theme | breaks source-of-truth semantics |
| changing qualification colors | creates training/support confusion |
| changing status color meanings | dangerous for ops consistency |
| theme-required navigation | blocks core workflow |

ThemeProfile should not restart until core CRM/review/action loop exists and enterprise backend invariants are stable.

---

# 13. Revised Roadmap V0.8

## 13.1 Current Immediate Roadmap

| Order | Phase | Type | Goal | Runtime? | Schema? |
|---:|---|---|---|---:|---:|
| 1 | V2.CORE0 | Docs | Enterprise backend invariants ADRs | No | No |
| 2 | V2.CORE1-PLAN | Planning | Audit current Prisma schema and define exact hardening diff | No | No |
| 3 | V2.CORE1 | Schema | Add orgId, composites, soft delete, versions, workflowStatus, pointers | No | Yes |
| 4 | V2.JOB0 | Runtime foundation | Async job model + worker foundation | Yes | Possibly |
| 5 | V2.INGEST-HV0 | Runtime | High-volume async ingestion | Yes | Maybe |
| 6 | V2.SCORE-HV0 | Runtime | Bulk ICP scoring job using ICP1R | Yes | Maybe |
| 7 | V2.CRM0 | UI/API | Lead workspace + review workflows | Yes | Maybe |
| 8 | V2.ACTIVITY0 | Runtime/UI | Activity recap at scale | Yes | Maybe |
| 9 | V2.TASK0 | Runtime/UI | Manual outreach task layer | Yes | Maybe |
| 10 | V2.OUTREACH-INFRA0 | Runtime/schema | Templates, dry-run, suppression | Yes | Yes |
| 11 | V2.SEND1 | Runtime | Real manual send with provider | Yes | Maybe |
| 12 | V2.SEQ0 | Schema/docs | Sequence foundation | Maybe | Yes |
| 13 | V2.SEQ1 | Runtime | Controlled automated sequence execution | Yes | Maybe |

## 13.2 V2.CORE0 Expected ADRs

| File | Decision locked |
|---|---|
| ADR-019-lead-assignment-idempotency-and-uniqueness.md | Company-level and contact-level LeadAssignment uniqueness/upsert policy |
| ADR-020-qualification-vs-workflow-status-separation.md | Separation of scoring result from operational status |
| ADR-021-async-job-processing-foundation.md | Job engine, retry, progress, idempotency, heavy-operation boundaries |
| ADR-022-soft-delete-and-data-retention.md | Soft delete, retention, audit, no hard-delete defaults |
| ADR-023-rbac-and-tenant-isolation.md | organizationId minimum, role checks, tenant boundary policy |
| ADR-024-webhook-provider-idempotency.md | providerEventId uniqueness, duplicate/out-of-order webhook handling |
| ADR-025-synchronous-suppression-gate.md | Authoritative suppression check immediately before provider sends |
| ADR-026-optimistic-concurrency-control.md | Versioned config updates and no silent last-write-wins |

## 13.3 V2.CORE1 Schema Hardening Targets

| Target | Description |
|---|---|
| Direct organizationId | Add to all V2 business tables that lack it |
| LeadAssignment assignmentLevel | Distinguish company-level from contact-level assignments |
| Composite uniqueness | Prevent duplicate active company/contact LeadAssignments |
| deletedAt/deletedBy | Add to core identity/config/work objects |
| version | Add to config tables for OCC |
| workflowStatus | Add operational state to LeadAssignment |
| latestHardRuleAssessmentId | Add pointer for fast list views |
| V2Job | Add job model or reserve for JOB0 depending scope decision |
| Email/outreach placeholder models | Only if CORE1 explicitly includes them; otherwise defer to OUTREACH-INFRA0/SEND1 |

## 13.4 What CORE1 Must Not Do

| Forbidden | Reason |
|---|---|
| API route implementation | CORE1 is schema hardening only |
| React/UI components | UI waits until backend shape is stable |
| Runtime scoring integration | SCORE-HV0 handles scoring jobs later |
| Ingestion parser/runtime | INGEST-HV0 handles runtime later |
| AI provider calls | AI remains optional assistive later |
| Email provider integration | SEND1 later |
| Sequence execution | SEQ1 later |
| V1 modifications | V1 frozen |

---

# 14. CORE0 Detailed Scope

## 14.1 Goal

Create concise ADRs that lock the enterprise backend invariants before schema changes.

## 14.2 Allowed Files

```txt
docs/v2/adr/ADR-019-lead-assignment-idempotency-and-uniqueness.md
docs/v2/adr/ADR-020-qualification-vs-workflow-status-separation.md
docs/v2/adr/ADR-021-async-job-processing-foundation.md
docs/v2/adr/ADR-022-soft-delete-and-data-retention.md
docs/v2/adr/ADR-023-rbac-and-tenant-isolation.md
docs/v2/adr/ADR-024-webhook-provider-idempotency.md
docs/v2/adr/ADR-025-synchronous-suppression-gate.md
docs/v2/adr/ADR-026-optimistic-concurrency-control.md
docs/v2/codex/SESSION_LOG.md
```

## 14.3 Forbidden Files

```txt
app/**
components/**
lib/**
lib/server/**
lib/scoring/**
lib/v2/scoring/**
lib/v2/activity-recaps/**
prisma/schema.prisma
prisma/migrations/**
package.json
package-lock.json
scripts/**
```

## 14.4 Verification

```powershell
git status --short
git diff --name-only
git diff --stat
git diff -- prisma/schema.prisma
git diff -- prisma/migrations
git diff -- app components lib scripts package.json package-lock.json
```

## 14.5 Exit Gate

CORE0 is complete only when:

- all six ADRs exist;
- each ADR states decision, rationale, implementation implication, and forbidden interpretation;
- SESSION_LOG entry is appended;
- no runtime/schema/package/V1 files changed;
- human review approves CORE1 planning.

---

# 15. CORE1 Detailed Scope

## 15.1 Goal

Harden existing V2 Prisma schema for enterprise tenant isolation, idempotency, soft delete, workflow separation, and future async jobs.

## 15.2 Required Pre-Planning Before Editing

Before Codex edits schema, it must output a schema audit table:

| Model | Has organizationId? | Needs deletedAt/deletedBy? | Needs version? | Needs workflowStatus? | Needs unique change? |
|---|---:|---:|---:|---:|---:|
| V2Company | TBD | TBD | No | No | TBD |
| V2Contact | TBD | TBD | No | No | TBD |
| V2ContactIdentifier | TBD | TBD | No | No | TBD |
| V2LeadAssignment | TBD | TBD | No | Yes | Yes |
| V2HardRuleAssessment | TBD | No | No | No | Maybe latest pointer relation |
| V2AiInsight | TBD | No | No | No | No |
| V2FeedbackExample | TBD | No | No | No | No |
| V2IngestionJob | TBD | No | No | No | Maybe job relation later |
| V2IngestionRow | TBD | No | No | No | No |
| V2ICPVersion | Inherited? direct? | Yes | Yes | No | Publish lifecycle |
| V2AuditEvent | Already foundation | No | No | No | Bulk grouping policy |

The table must be filled from actual `prisma/schema.prisma`, not guessed.

## 15.3 CORE1 Allowed Scope

| Change | Allowed? | Notes |
|---|---:|---|
| Add `organizationId` where missing | Yes | Only V2 business tables |
| Add `deletedAt`, `deletedBy` to core entities | Yes | Company, Contact, LeadAssignment, ICPVersion, future Template if exists |
| Add `version` to config tables | Yes | ICPVersion now; template/sequence later if not existing |
| Add LeadAssignment workflowStatus enum | Yes | Separate from qualification |
| Add assignmentLevel enum | Yes | company/contact uniqueness |
| Add partial unique indexes/manual SQL where Prisma cannot express nullable uniqueness | Yes | Must document migration SQL clearly |
| Add latestHardRuleAssessmentId pointer | Conditional | Must avoid circular relation issues; plan first |
| Add V2Job model | Conditional | Could be CORE1 or JOB0; decide in plan before implementation |
| Add outreach models | No by default | Defer unless explicitly approved |

## 15.4 CORE1 Forbidden Scope

- no API route implementation;
- no React/UI;
- no scoring runtime;
- no ingestion runtime;
- no AI provider calls;
- no worker loop;
- no email send;
- no sequence runtime;
- no V1 changes;
- no seed/backfill unless explicitly approved;
- no destructive rollback.

## 15.5 CORE1 Verification

```powershell
git status --short
git diff --name-only
npx prisma validate
npx prisma migrate dev --name v2_core1_enterprise_schema_hardening
npx prisma generate
npm run lint
npm run typecheck
npm run build
git diff -- app components lib scripts package.json package-lock.json
```

## 15.6 CORE1 Rollback Note Requirement

Every migration must include a human-readable rollback note in SESSION_LOG:

```txt
Rollback note: Local rollback can remove only the V2.CORE1 hardening fields/enums/indexes from the generated migration. Do not run destructive rollback against shared/staging/prod data without backup and human approval.
```

---

# 16. Agent Operating Model V0.8

## 16.1 Codex

Codex remains the pinned execution agent per phase. Codex can touch schema, migrations, server logic, scoring engine, and API only when the active phase allows it.

## 16.2 OpenCode

OpenCode is in-editor helper only. It may edit current allowed files only. It must not expand scope, create out-of-phase files, touch schema, migrations, or V1.

## 16.3 Antigravity

Antigravity is UI/component generation only after UI phases restart. It is forbidden from scoring, server logic, schema, migrations, V1 routes, and enterprise invariant decisions.

## 16.4 Universal Rules

| Rule | Detail |
|---|---|
| One phase per session | No continuing to next phase automatically |
| Read docs first | Must read AGENTS, final plan, roadmap, phase spec, relevant ADRs, SESSION_LOG tail |
| Prove docs read | Output file hashes/sections found before editing |
| Allowed files only | Prompt must list exact allowed files |
| Append SESSION_LOG | Required for implementation sessions |
| Run verification | Required commands depend on phase |
| Human review gate | No commit/next phase unless user approves |

---

# 17. Updated Review Gates

## Gate 1 - V0.8 Accepted

| Criterion | Required? |
|---|---:|
| Hao approves enterprise direction | Yes |
| Small pilot framing replaced with Enterprise Core MVP framing | Yes |
| V2.A2 pause accepted | Yes |
| CORE0/CORE1 inserted before UI/runtime | Yes |
| V1 freeze preserved | Yes |

## Gate 2 - CORE0 Approved

| Criterion | Required? |
|---|---:|
| ADR-019 through ADR-026 created | Yes |
| No runtime/schema changes | Yes |
| ADRs do not contradict current schema history | Yes |
| Human review approves CORE1 planning | Yes |

## Gate 3 - CORE1 Plan Approved

| Criterion | Required? |
|---|---:|
| Actual Prisma schema audit completed | Yes |
| Exact fields/enums/indexes listed | Yes |
| Manual SQL index strategy reviewed | Yes |
| Backward compatibility checked | Yes |
| Rollback note prepared | Yes |

## Gate 4 - CORE1 Migration Approved

| Criterion | Required? |
|---|---:|
| prisma validate passes | Yes |
| migration created/applied locally | Yes |
| prisma generate passes | Yes |
| lint/typecheck/build pass | Yes |
| forbidden path diffs clean | Yes |
| SESSION_LOG appended | Yes |
| human review before JOB0 | Yes |

---

# 18. Do-Not-Build-Yet List V0.8

| Do not build yet | Earliest possible phase |
|---|---|
| Manager Review UI | CRM0 after CORE1/JOB0/INGEST-HV0/SCORE-HV0 |
| App shell polish | CRM0/V2.9 successor after backend invariants |
| Runtime scoring from UI | SCORE-HV0 |
| Runtime ingestion parser/upload APIs | INGEST-HV0 |
| AI insight generation jobs | after SCORE-HV0 or dedicated AI phase |
| Real email send | SEND1 |
| Sequence execution | SEQ1 |
| Email tracking pixels/click redirects | after SEND1 and compliance review |
| Public SaaS billing | much later |
| Advanced ThemeProfile | after core workflow and action loop |
| Autonomous AI rule updates | never without human approval and benchmark |

---

# 19. Practical Next Step Recommendation

The next action should not be a runtime Codex implementation prompt. The next action should be a two-step controlled prompt sequence:

1. **V2.CORE0 docs-only ADR prompt**
   - create six ADR files;
   - append SESSION_LOG;
   - no schema/runtime/code.

2. **V2.CORE1 plan-only schema audit prompt**
   - read actual Prisma schema;
   - produce exact diff plan;
   - no edits until approved.

Only after the CORE1 plan is reviewed should Codex run schema edits and migrations.

---

# 20. Final Working Principle V0.8

V2 must now be built like this:

```txt
enterprise invariants
-> tenant-safe schema
-> async job foundation
-> high-volume ingestion
-> bulk ICP scoring
-> lead workspace and manager review
-> activity recap at scale
-> task layer
-> template/suppression infrastructure
-> manual send
-> sequence foundation
-> controlled sequence automation
```

Not like this:

```txt
UI first
-> sync upload
-> sync scoring
-> patch duplicate bugs
-> patch tenant leaks
-> patch outreach status
-> patch suppression later
-> rewrite sequence engine later
```

The point of V0.8 is not to build more for the sake of building more. The point is to avoid putting a polished CRM UI on top of backend assumptions that cannot survive real TeleStar data volume, multi-user operations, outreach compliance, and future SaaS scale.
