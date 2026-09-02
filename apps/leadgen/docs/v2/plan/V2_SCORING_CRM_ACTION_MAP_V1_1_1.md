# V2 Scoring + CRM — Action Map & Roadmap V1.1.1

> Supersedes the session list in `V2_BUILD_ROADMAP_phase1_scoring_phase2_crm.md`.
> Reconciled after two external review passes (7 merges in V1.1, 5 patches in V1.1.1) plus a final
> wording fix (S0A clarified as a planning gate, exempt from SEE-IT). **Approved as planning source-of-truth.**
> Still a **planning map** — NOT a Codex execution prompt. Implementation begins only after a scoped
> single-session prompt is written and (for S0B) only after S0A's diff is human-approved.

---

## Workflow Linkage Update

Future implementation prompts must also follow
`docs/v2/plan/V2_WORKFLOW_LINKAGE_CONTRACTS.md`. That contract requires each
session to name upstream objects consumed, objects created or updated,
downstream consumers, idempotency key, tenant boundary, user-visible proof, and
automated linkage proof.

## 0. Standing rules (read once, apply to every session)

**R1 — SEE-IT pairing.** A session may be backend-only ONLY if it is the first half of a pair whose
second half is a SEE-IT browser surface. No next macro-phase may start before the SEE-IT half passes.
A backend-only session must never sit un-surfaced across a phase boundary.
*Exemption:* a **planning-only gate** (no runtime/schema/UI change, e.g. P1.S0A) has NO SEE-IT requirement —
it makes nothing to see. It must directly precede its implementation sessions and cannot be used to start a
different macro-phase.

**R2 — Seeded ≠ real, and seeded must still be clickable.** A "seeded" milestone (data created by a dev
helper, not a real upload) only counts as SEE-IT if the seed is triggered by a **button on a dev-only browser
surface**, not by a terminal script. Running a job from the CLI is NOT SEE-IT.

**R3 — Audit before identity.** Any session touching identity matching or lead upsert requires the
confirmed facts in §1 first. No guessing enum names, field names, index names, or handler names.

**R4 — Never combine UI with backend in one session.** A narrow **schema + mapper + read-model** change MAY
travel together as a single *backend pair* (a bare migration that adds a column nothing writes to is useless and
un-surfaceable, which would violate R1). What is forbidden is folding **UI** into that same session, or adding
unrelated change-kinds (e.g. backfill of historical data) without their own scope. Backend pair → its UI surface
is the NEXT session. (Consistent with your MR0/MR1/MR2 and CORE1-PLAN discipline.)

**R5 — Human review gate between every session.** Unchanged from your current workflow.

**R6 - Workflow linkage proof.** Every implementation session must include a `WORKFLOW LINKAGE`
block before coding:

```txt
Workflow stage:
Upstream objects consumed:
Objects created or updated:
Downstream consumers:
Idempotency key:
Tenant boundary:
User-visible proof:
Automated linkage proof:
```

If a session cannot name concrete upstream objects, downstream consumers, idempotency behavior, and
tenant boundary from the current repo, stop and report the scope gap instead of coding.

The canonical production spine is:

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

---

## 1. Action map: what is ALREADY verified vs what must be CONFIRMED

Staleness note: this table records the historical V1.1.1 audit baseline. Later sessions have
implemented additional workflow stages, including `IDENTITY_MATCH`, `LEAD_ASSIGNMENT_UPSERT`, and
`COMPANY_ENRICHMENT` handlers. Before coding from any row below, refresh against the repo and the
workflow contracts document.

This replaces the proposed "P13 audit" + "S0A audit" + "S2A audit" sessions with one table.
Left column = verified directly against the repo zip (no re-discovery needed).
Right column = the only things a planning session must still confirm before code.

| Area | VERIFIED in code (✅) | Must CONFIRM before coding (▶) |
|------|----------------------|-------------------------------|
| Job types | `V2_JOB_TYPES`: INGESTION_PARSE, INGESTION_NORMALIZE, IDENTITY_MATCH, LEAD_ASSIGNMENT_UPSERT, ICP_SCORE, ACTIVITY_APPLY, EXPORT_GENERATE, AI_INSIGHT_GENERATE, EMAIL_SEND, SEQUENCE_STEP_EXECUTE | — |
| Handler registry | Only PARSE, NORMALIZE, ICP_SCORE are real in `lib/v2/jobs/handlers.ts`; rest = `stubV2JobHandler` | — |
| Chain stop | NORMALIZE sets row status `NORMALIZED` then STOPS (no enqueue of IDENTITY_MATCH) | — |
| Ingestion row | `V2IngestionRow` has `matchedCompanyId`, `matchedContactId`, `rawRowJson`, `normalizedRowJson`, `validationErrorsJson`; `V2IngestionRowStatus` = RAW, NORMALIZED, MATCHED, APPLIED, ERROR | — |
| Lead model | `V2LeadAssignment`: org/company/contact?/project/icpVersion, `assignmentLevel` (COMPANY default), `workflowStatus` (NEW default), `latestHardRuleAssessmentId`, `status` (ACTIVE) | exact CORE1 partial-unique index NAMES |
| Assessment | `V2HardRuleAssessment` has `fitScore`, `confidence`, `qualification`, 4 JSON snapshot blobs, `previousAssessmentId` chain | — |
| Qualification enum | `V2Qualification` = QUALIFIED, NEEDS_REVIEW, UNQUALIFIED, **UNCERTAIN** (ghost) | final decision: deprecate vs drop UNCERTAIN |
| ICP1R output | `accountPreRank` enum = **STRONG_ACCOUNT_FIT, POSSIBLE_ACCOUNT_FIT, WEAK_FIT, CLEAR_MISMATCH**; qualification = 3 states; full `inputSnapshot`+`rulesSnapshot` returned | — |
| Persistence | `mapIcpAssessmentToPersistence.ts` puts accountPreRank/missingEvidence/reviewFlags **inside JSON blobs**, not columns | — |
| Review producer | `createReviewItem` (MR2) is REAL (not just schema); `queryReviewQueue.ts:353` coerces `null → UNCERTAIN` | confirm `createReviewItem` signature for ambiguous-row call |
| Permissions | Defined: `crm.read`, `score.enqueue`, `workflow.update`, `manager_review.decide`, `ingestion.apply` | — |
| API routes (V2) | Only `app/v2/leads/[leadAssignmentId]/workflow/route.ts` exists | — |
| Design system | shadcn (radix-nova), Tailwind v4 `@theme` tokens, rich `components/ui/*` + `components/shared/*`; deps `@tanstack/react-table`, `react-hook-form`, `papaparse`, `zod`, `lucide` installed; **no recharts** | — |
| Identity resolver | NONE for ingestion (A1 resolver is activity-only) | reusable contract for company + activity |

**Implication:** the only genuine "audit/plan" work left is the three remaining ▶ items (CORE1 index names,
the UNCERTAIN deprecate-vs-drop decision, the `createReviewItem` signature). They fit in ONE short
planning session (P1.S0A), not three.

---

## 2. Corrections merged from review (the 7)

1. **Split P1.S0** into S0A (confirm the 4 ▶ items + exact migration diff), S0B (schema + mapper + read-model),
   S0C (leads UI semantic patch). S0A is light, not a long audit.
2. **One combined action map** = §1 of this doc. No separate P13 / S0A-audit / S2A-audit sessions.
3. **Backend-only paired rule** = R1 above.
4. **Manager Review wording**: Phase 1 = create + read-only `V2ManagerReviewItem` producers only.
   Phase 2 = interactive assign / resolve / reject / link / create actions.
5. **Seeded vs real milestones** renamed (and bound by R2): S2 seeded row visibility → S3 seeded pipeline
   closes into `/v2/leads` → S4 real browser upload closes loop. Seed triggered by a dev button, not CLI.
6. **Activity Recap guardrail**: the identity resolver MUST be reusable by company upload AND activity recap;
   do not break `V2.A0`/`V2.A1` contracts; no second resolver later.
7. **Exact enum names** everywhere: STRONG_ACCOUNT_FIT, POSSIBLE_ACCOUNT_FIT, WEAK_FIT, CLEAR_MISMATCH.

### V1.1.1 patch set (second review pass)

8. **R4 rewritten** so it no longer contradicts the schema+read-model pairing in S0B (forbid combining UI,
   not forbid schema traveling with its mapper/read-model).
9. **S0B `NOT_SCORED` resolved to Option A**: `NOT_SCORED` is read-model/UI-derived when `latestHardRuleAssessmentId
   IS NULL`. It is NOT added to the DB enum. Creating placeholder/fake `V2HardRuleAssessment` rows is FORBIDDEN.
10. **S2A kind fixed** from `plan` to `pure-runtime` (module + fixtures, no Prisma/DB/handler).
11. **Phase 1 end-state wording fixed**: P1 only creates read-only review items; resolution is P2.
12. **Route segment corrected** to the verified `app/v2/leads/[leadAssignmentId]/workflow/route.ts`
    (was wrongly written `[id]`). `V2IngestionRowStatus` also confirmed (RAW/NORMALIZED/MATCHED/APPLIED/ERROR).

---

## 3. PHASE 1 — Full Scoring (reconciled session list)

End state: log in → pick Account/Project/ICP → upload company CSV → watch progress → see companies scored
**by that ICP** with a "why" drawer → ambiguous rows **create review items that are visible (read-only)** →
export. Looks like the mock. (Interactive review resolution is Phase 2, not Phase 1.)

| # | Session | Kind | Backend | SEE-IT (browser) |
|---|---------|------|---------|------------------|
| 0 | **P1.S0A** | planning gate | Confirm the 3 remaining ▶ items + the NOT_SCORED decision; produce exact enum/column/index/migration diff. No code. | (none — planning gate, exempt from SEE-IT per R1; must directly precede S0B→S0C) |
| 1 | **P1.S0B** | schema+read-model pair | Add `accountPreRank` column+index; add `COMPANY_QUALIFIED_NEEDS_CONTACT` to `V2Qualification`; deprecate `UNCERTAIN` (stop writing). Update `mapIcpAssessmentToPersistence` to write `accountPreRank` column + emit 4th qual value. Read model selects new column and **derives `NOT_SCORED` when `latestHardRuleAssessmentId IS NULL`** (NOT a DB enum; NEVER create a placeholder/fake `V2HardRuleAssessment` row to show NOT_SCORED). Replace `null→UNCERTAIN` coercion with the derived `NOT_SCORED`. | (paired — surfaced in S0C) |
| 2 | **P1.S0C** | UI | Update lead table / AssessmentSummaryCard / filters to show 4th state + accountPreRank band; remove ghost UNCERTAIN; NOT_SCORED styling. | `/v2/leads` shows correct states on seeded data |
| 3 | **P1.S1** | UI-first | Read fn for Account→Project→ICP options. | Tokens locked + AppShell + **Context Bar**; switching context refilters `/v2/leads` live |
| 4 | **P1.S2A** | pure-runtime | Pure identity resolver module + fixtures (canonical domain → name-in-context → fuzzy=candidate → none). Reusable for company + activity (R guardrail). **No Prisma, no DB mutation, no job handler.** | (paired with S2B) |
| 5 | **P1.S2B** | runtime+UI | `IDENTITY_MATCH` handler writes matchedCompanyId/Contact + row status; NORMALIZE enqueues IDENTITY_MATCH. Dev "Run seeded ingestion" button. | `/v2/ingestion/[jobId]` shows rows matched/ambiguous/none (seeded, via button per R2) |
| 6 | **P1.S3** | runtime+UI | `LEAD_ASSIGNMENT_UPSERT` (company vs contact level, nullable rules, idempotent); ambiguous → `createReviewItem` (read-only producer); chain → auto-enqueue ICP_SCORE. | **Seeded pipeline populates `/v2/leads`, auto-scored ⭐ loop closes** |
| 7 | **P1.S4** | API+UI | Routes: create ingestion job + file intake; confirm mapping; job status (perm `ingestion.apply`). | **Real browser upload → map → run** (no more seed) |
| 8 | **P1.S5** | API+UI | Progress aggregate over `V2Job`. | `/v2/ingestion/[jobId]` live progress + counts |
| 9 | **P1.S6** | UI | Read model exposes accountPreRank/missingEvidence (columns from S0B) + same-company-cross-ICP query. | Results table to mock parity (TanStack) + "why" drawer + multi-ICP cross-view |
| 10 | **P1.S7** | runtime+UI | `EXPORT_GENERATE` handler + export routes. [keep unless explicitly cut] | One-click export of qualified list |
| 11 | **P1.S8** | API+UI | Context-scoped aggregate counts. | `/v2/home` dashboard (counts, recent uploads, CTA) |
| 12 | **P1.S9** | UI+audit | Styling pass; every screen 4 states; correctness/tenant/idempotency audit on 20k stress seed. | **Ship Phase 1** |

---

## 4. PHASE 2 — Full CRM (reconciled)

Still NO outreach/send/sequence.

| # | Session | Phase-1 dependency | SEE-IT |
|---|---------|--------------------|--------|
| 1 | **P2.S1** Workflow transition matrix | replaces any→any in workflow route | controlled, audited status changes |
| 2 | **P2.S2** Manager Review resolution (routes + interactive UI) | consumes P1.S3 producers | working resolvable review queue |
| 3 | **P2.S3** Resolution actions → outcomes | approve/create/link/update/convert | resolving creates/links/updates real records |
| 4 | **P2.S4** Feedback capture + history | convert_to_feedback | corrections logged + `/v2/feedback` |
| 5 | **P2.S5** Activity Recaps (ACTIVITY0) | reuses identity resolver (guardrail) | activity per lead + recap dashboard |
| 6 | **P2.S6** ICP authoring (OCC version) | — | managers author/publish ICP versions |
| 7 | **P2.S7** CRM dashboards + reporting | — | management overview |
| 8 | **P2.S8** Settings, org selector, RBAC polish, styling, acceptance | — | **Ship Phase 2 (pre-outreach)** |

---

## 5. First 3 recommended sessions (decision point for you)

The reconciled order gives two valid entry points; pick based on what hurts more:

- **If `/v2/leads` currently shows wrong/fake states** (UNCERTAIN ghost is misleading you) → start
  **S0A → S0B → S0C** (fix the semantic truth of the existing surface first).
- **If the existing leads view is "good enough to look at" and your real pain is no ICP context switching** →
  start **S1 (Context Bar) → then S0A → S0B**.

### First session if you choose P1.S0A (planning gate)

> Pairing note: **S0A is a planning gate, not a backend-only half.** It has no SEE-IT requirement because it
> makes no runtime change. The actual pair is **S0B (backend/schema/read-model half) → S0C (SEE-IT UI half)**,
> and no macro-phase may start between S0B and S0C.

**ALLOWED:** read `prisma/schema.prisma`, `lib/v2/scoring/**`, `lib/v2/crm/**`, `lib/v2/manager-review/**`;
produce a written diff: exact enum addition (`COMPANY_QUALIFIED_NEEDS_CONTACT`), `accountPreRank` column +
index name, migration outline, mapper change list, read-model change list, `createReviewItem` call signature,
the 3 remaining ▶ items (CORE1 index names, UNCERTAIN deprecate-vs-drop, createReviewItem signature), and a
confirmed decision that **`NOT_SCORED` is read-model-derived only** (not a DB enum, no fake assessment rows).
Confirm exact route segments from the repo (`[leadAssignmentId]`, not `[id]`) before any later prompt.
Append SESSION_LOG.
**FORBIDDEN:** any edit to schema/migrations/runtime/UI/package; any Codex implementation; touching V1;
inventing names not confirmed from code; adding `NOT_SCORED` to the DB enum.
**EXIT GATE:** human approves the diff → then (and only then) write the S0B implementation prompt.

---

## 6. Go / No-Go

**GO:** this V1.1 action map as the planning source of truth.
**NO-GO:** Codex implementing migration/UI/handler directly from it. First write a scoped prompt for ONE
chosen session (S0A or S1), with allowed/forbidden/verification/SEE-IT exit gate, per your phase discipline.
