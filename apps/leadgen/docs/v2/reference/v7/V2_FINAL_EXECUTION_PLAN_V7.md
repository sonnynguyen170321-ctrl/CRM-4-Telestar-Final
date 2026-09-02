# Lead Gen Intelligence - TeleStar SDR OS V2 Final Execution Plan V7

Version: **v0.7.2 review-resolved patch**
Status: **Master execution plan before Codex implementation**
Scope: **Enterprise-ready internal pilot, side-by-side with frozen V1**

## 0. Executive decision

Lead Gen Intelligence is the umbrella project. The first product is **TeleStar SDR OS V2**, an internal SDR operating system for company/contact qualification, activity recap management, SDR review, manager review, feedback-driven scoring improvement, and a later outreach workflow.

V1 remains frozen as the legacy/LTS baseline. V2 is built side-by-side. V2 must not reuse V1 as a live dependency and must not mutate V1 data or behavior.

Active V2 source-of-truth docs live under `docs/v2/**`, with this execution plan as the top-level control document. Historical scoring research from earlier V2.1/V2.1B prompts is archived under `docs/v2/reference/v2-1-scoring-research/` and is reference-only.

## 1. Current Go / No-Go

### GO

- Use this plan and the v0.2 spec patch as the source of truth for docs placement.
- Run V2.1C only after human review accepts this patch.
- V2.1C is docs/guardrails placement only.

### NO-GO

- No runtime code yet.
- No Prisma schema changes yet.
- No migrations yet.
- No UI route/component build yet.
- No scoring function implementation yet.
- No V1 modifications.
- No V2.2 until `V2_ICP_VERSION_RULES_TYPE_SPEC.md` is reviewed and accepted.

## 2. Product hierarchy

The V2 model is not "company is qualified forever." Qualification is contextual.

```txt
Organization
-> ClientAccount
-> Project / Engagement
-> Offer / Product
-> ICP Profile
-> ICP Version
-> Company
-> Contact
-> LeadAssignment = Company Ã— Contact? Ã— Project Ã— ICP Version
-> HardRuleAssessment
-> AiInsight
-> SDR Review
-> Manager Review
-> FeedbackExample
-> ActivityRecord
```

The center of V2 is **LeadAssignment**, not Company.

## 3. Pilot scope

Pilot target:

```txt
10-15 internal users
10 client accounts
10 projects
20 ICP versions
5k-20k companies
5k-20k contacts
CSV company/contact imports
CSV activity recap imports
manual review/export
manual-send dry-run first
```

Stress target is separate from pilot target:

```txt
50 local users simulated
20k-50k companies
20k-50k contacts
optional 100k LeadAssignments
```

Codex must not confuse stress seed volume with pilot seed volume.

## 4. Success metrics

Pilot success is not "features built." Pilot success is measured by actual SDR workflow value.

### Primary metric

```txt
HardRule agreement >= 70%
```

At least 70% of deterministic qualifications are accepted by SDR/manager review without correction.

### Business usefulness metric

The team can upload, qualify, review, and export or act on a lead list faster than the current V1/spreadsheet process.

### Activity recap metric

Auto-match rate should improve as the database fills.

```txt
Week 1: expected lower match rate
Later pilot: rising toward 70-80% auto/suggested resolution
```

## 5. Core workflows

### Workflow A - Upload -> Qualify -> Review

```txt
Select ClientAccount / Project / ICP
-> upload CSV
-> unified ingestion parses + maps + validates rows
-> identity resolver matches companies/contacts
-> create LeadAssignments
-> run deterministic HardRuleAssessment
-> optional AI Insight later
-> SDR review
-> Manager review if needed
-> FeedbackExample
-> export / next action
```

### Workflow B - Activity Recaps

Activity Recaps are a core product workflow for a BPO SDR environment.

```txt
Upload SDR activity CSV
-> map columns
-> normalize CanonicalActivityRow
-> match company/contact/LeadAssignment
-> create ActivityRecord for high-confidence matches
-> create ManagerReviewItem for low-confidence/no-match/conflicts
-> show recap metrics by SDR/project/day/week
```

Pilot is **CSV only**. XLSX is deferred until CSV ingestion is stable.

### Workflow C - Manual-send early slice

Full outreach automation is deferred. A small safe early slice is approved:

```txt
V2.SEND0: render manual-send dry-run preview
V2.SEND1: send one manual email only after dry-run is accepted
```

Dry-run does not create EmailSend. Real send creates EmailSend + ActivityRecord + AuditEvent.

## 6. Unified ingestion

There must not be separate upload frameworks for company uploads and activity recaps.

Use one ingestion model:

```txt
ingestion_jobs
- job_type: company_upload | contact_upload | activity_recap
- status: uploaded | mapped | validating | validated | applying | applied | partially_applied | failed | rolled_back

ingestion_rows
- raw_row_json
- normalized_row_json
- source_row_hash
- validation_status
- match_status
- applied_target_ids
```

Pilot batch policy:

```txt
parse/normalize chunks: ~500 rows
DB apply batches: 100-250 rows
```

`partially_applied` is recoverable but not blindly auto-resumed. The user can retry failed rows, rollback applied rows, or export error rows.

## 7. Identity resolution

Identity resolution is shared by ingestion, activity recaps, scoring persistence, outreach, and reports.

### Company identity

Default:

```txt
canonical_domain unique per Organization
```

Match order:

```txt
1. canonical domain
2. normalized company name within account/project context
3. fuzzy name only as suggested match, never auto-merge
```

Parent/subsidiary/shared-domain conflicts create review items.

### Contact identity

Use `contact_identifiers`, not flat contact email columns.

Default:

```txt
non-generic email unique per Organization
generic email is weak evidence only
LinkedIn profile URL unique per Organization
phone is contextual and may be weak/medium
```

Contact is global. LeadAssignment is project/ICP-specific.

## 8. Scoring source of truth

```txt
HardRuleAssessment = deterministic rule result
AiInsight = optional second opinion snapshot
SDR Review = human final correction/review
Manager Review = validation/override workflow
FeedbackExample = append-only tuning evidence
Export = feedback final first, then HardRuleAssessment; AI optional only
```

AI must never overwrite HardRuleAssessment, SDR review, ManagerReview, FeedbackExample, or export final fields.

## 9. Scoring order

```txt
normalizeInput
-> computeDataQuality
-> collectAllEvidence
-> evaluateHardGates AFTER evidence
-> classifyCompanyType
-> computeFitScore
-> computeConfidence
-> deriveQualification
-> explainAssessment
```

Evidence-first is mandatory. Service keywords must not disqualify a company before product/platform evidence is collected.

## 10. ICP rule config

`IcpVersionRules` must be defined before V2.2. See:

```txt
docs/v2/scoring/V2_ICP_VERSION_RULES_TYPE_SPEC.md
```

Required config areas:

```txt
missingWebsitePolicy
geography
companySize
hardGates
positiveSignals
negativeSignals
companyTypeRules
confidencePolicy
```

## 11. Stale assessment behavior

`inputFingerprint` detects stale assessments. Stale does not mean auto-rerun.

```txt
HardRule stale: show outdated + manual re-run action
AI stale: show outdated + manual generate fresh insight action
No auto-AI rerun
Old snapshots remain immutable
```

## 12. Activity recap idempotency

ActivityRecord is append-only.

```txt
exact duplicate row: skip
minor correction: create new ActivityRecord with supersedes_activity_record_id
raw ingestion row: immutable
manager correction: resolution action + corrected activity record
```

No direct overwrite of existing ActivityRecord in pilot.

## 13. Manager review safety

ManagerReviewItems do not expire automatically in pilot.

Safety valve:

```txt
Allowed: low-risk bulk dismiss
Forbidden: bulk accept/update/mutate lead status
```

Low-risk bulk dismiss categories:

```txt
no_match_from_recap
duplicate_suspected
stale_activity_date
```

## 14. ThemeProfile

Theme stays in roadmap, but it is not pilot-critical.

Final rule:

```txt
ThemeProfile is V2.THEME1 after Stop & Ship by default.
Earlier implementation requires explicit human re-approval.
```

Forbidden:

```txt
arbitrary CSS
custom workflow layout
changing status color meaning
changing qualification colors
```

## 15. V1 / V2 boundary

V2 is side-by-side, not dynamically linked to V1.

Allowed:

```txt
manual or one-time import
legacy_feedback snapshots
source = v1_legacy
manager approval before using legacy feedback for tuning
```

Forbidden:

```txt
V2 screen reads live V1 tables
V2 scoring joins V1 runtime data
V2 export joins V1 runtime data
V2 mutates V1 data
```

## 16. Local-first migration and rollback

Every V2 migration must be named with a V2 prefix.

```txt
YYYYMMDDHHMM_v2_<short_description>
```

Example:

```txt
202606071530_v2_add_lead_assignment.sql
```

No ambiguous migration names.

Rollback rehearsal must happen before staging/prod schema work.

## 17. Error/degraded states

Define before UI implementation:

```txt
upload failed
mapping failed
invalid rows threshold exceeded
identity no match
identity multiple match
AI quota reached
AI provider failed
score timeout
activity recap abandoned mid-flow
export failed
permission denied
stale local/AI assessment
```

Each state needs:

```txt
what happened
what data was saved
safe retry or not
next action
manager review requirement if any
```

## 18. Revised build order

### 2026-06-08 ICP scoring implementation hold

As of 2026-06-08, V2.5, V2.6, V2.7, V2.8, V2.INGEST, V2.A0, V2.A0.1, V2.A0.2, and V2.A1 have been completed or treated as completed according to `SESSION_LOG`.

However, weak ICP benchmark and external logic review exposed that ICP scoring runtime is under-specified.

Implementation is frozen before V2.A2.

Next allowed phases:

```txt
V2.ICP0R - docs-only ICP scoring runtime spec repair
V2.ICP-BENCH0R - docs-only ICP benchmark + canonical registry repair
V2.ICP1R - later pure TypeScript rule schema/evaluation harness only after human approval
```

V2.A2 is paused. Do not start Manager Review flow until ICP0R + BENCH0R are reviewed. Do not start UI until scoring/review contracts are stable.

Inserted phases before V2.A2:

| Phase | Goal | Runtime code? | Schema? | Exit gate |
| --- | --- | ---: | ---: | --- |
| V2.ICP0R | ICP scoring runtime spec repair | No | No | confidence, qualification, required evidence, explanation contracts locked |
| V2.ICP-BENCH0R | Benchmark + canonical ICP registry repair | No | No | mapped/unmapped policy and benchmark truth hierarchy locked |
| V2.ICP1R | Pure TypeScript ICP rule schema/evaluation harness | Yes, pure only | No | requires separate approval |

```txt
V2.1C - docs placement + guardrails only
V2.2 - shared type contracts: ICP rules, identity, ingestion, scoring
V2.3A - pure scoring normalize/data-quality/evidence collection
V2.3B - hard gates/type/fit score
V2.3C - confidence/qualification/explanation
V2.4 - V1/V2 parity benchmark
V2.5 - enterprise DB foundation
V2.6 - product tree schema
V2.7 - identity foundation schema
V2.8 - scoring persistence + feedback schema
V2.INGEST - unified ingestion schema/skeleton
V2.A0 - CanonicalActivityRow contracts
V2.A1 - activity match confidence resolver
V2.A2 - manager review flow for recap issues
V2.9 - pilot app shell with reduced routes
V2.10 - company/lead review drawer
V2.SEND0 - manual-send dry-run
V2.SEND1 - manual single send
STOP & SHIP - measure pilot metrics
V2.THEME1 - lightweight controlled ThemeProfile by default after Stop & Ship
V2.P1 / V2.E1-E5 - pipeline and full outreach later
```

### Post-V2.8 roadmap reconciliation

Implemented history has superseded the older V2.7A/V2.7B labels in this plan:

```txt
V2.7 identity foundation schema is complete.
V2.8 scoring persistence + feedback schema is complete.
V2.7A / V2.7B must not be used as forward implementation labels.
Do not call the next phase V2.7A-backfill.
```

The canonical next implementation phase after V2.8 is **V2.INGEST**.

Canonical forward sequence:

```txt
V2.INGEST
-> V2.A0
-> V2.A1
-> V2.A2
-> V2.9
-> V2.10
-> V2.SEND0
-> V2.SEND1
-> Stop & Ship
```

V2.INGEST boundary:

- Add unified ingestion schema/skeleton only.
- Do not implement identity resolver runtime unless explicitly scoped later.
- Do not implement scoring execution.
- Do not implement AI provider calls, queues, or runtime.
- Do not implement full UI.
- Do not seed, backfill, or import V1 data.
- Do not dynamically join live V1 runtime tables.
- Do not mutate V1 models or runtime.

V2.9 app shell option:

- V2.9 may happen only as a navigation/layout-only phase if explicitly scoped.
- V2.9 shell must have zero business logic, zero scoring runtime, zero ingestion runtime, zero identity resolver runtime, and zero real-data route guards.
- V2.9 shell must not distract from V2.INGEST.
- If choosing between them, V2.INGEST comes first because it enables real data flow and demo validation.

## 19. Agent model

### Codex

Pinned phase executor. Schema/migrations/server/scoring owner in future phases. One phase per session.

### OpenCode

In-editor helper only. Only active allowed files. No phase expansion.

### Antigravity

UI/component generation from V2.9+. Forbidden from scoring/server/schema/migrations/V1.

## 20. Final instruction

Do not optimize for impressive architecture at the cost of pilot usefulness. Every phase should answer:

```txt
Does this help SDRs qualify, review, recap, or act faster and more reliably?
```

If not, defer it.
