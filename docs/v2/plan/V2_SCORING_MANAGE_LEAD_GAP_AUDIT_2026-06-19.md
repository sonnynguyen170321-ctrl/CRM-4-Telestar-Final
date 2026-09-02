# Scoring + Manage + Using-Lead — Gap Audit vs TLS OS FAQ — 2026-06-19

Benchmarks the **TLS OS Workflow FAQ** (product expectation map, ~60% accurate per its author) against the actual codebase, scoped to the three areas asked: **scoring**, **manage** (manager review + assignment + learning), and **using-lead** (lead workspace + drawer). Grounded in code with file refs. Outreach is out of scope (covered by the Campaign Launch contract).

Legend: **GAP** = real missing capability · **SURFACING** = data exists, UI doesn't show it · **DIVERGENCE** = FAQ differs from our (correct) design, not a gap.

---

## 0. What is already strong (do NOT rebuild)

- **Scoring engine (rules-v2)** `lib/v2/scoring/rules/deriveQualification.ts` already emits everything FAQ §5.2 asks and more: `qualification` (QUALIFIED / COMPANY_QUALIFIED_NEEDS_CONTACT / NEEDS_REVIEW / UNQUALIFIED), `fitScore`, `confidenceScore` + `confidenceBand`, `accountPreRank` + `accountFitScore`, per-dimension `subScores` (geo/industry/companyType/size/persona/signals), `gates.hits` (hard disqualifiers), `missingEvidence[]`, `requiredEvidenceMissing[]`, `reasonCodes[]`. Fit/confidence/evidence/persona-readiness/account-prerank/final-qualification are cleanly separated (V2 Invariant) — this **exceeds** the FAQ's "score = one number + confidence".
- **`explainAssessment.ts`** produces structured `positiveEvidence` / `negativeEvidence` / `hardGates` / `companyType` / `dataQuality` sections.
- **Lead drawer** (`components/v2/leads/LeadDrawer.tsx`) surfaces it well: Why-score, Score components, **gate** hits, **missingEvidence**, **assessmentHistory** (prior assessments), evidence snapshot, Qualification vs Workflow vs Confidence split, workflow update form, timeline (T5), contacts, company intelligence. FAQ §6 drawer expectations are largely **met here**.
- Qualification (immutable) vs workflowStatus (mutable) correctly separated (Invariant 3). Assessments immutable + history kept (Invariant 4).

The engine and the SDR lead drawer are solid. The gaps are concentrated in **management surfaces** (review detail, ownership, learning) and a few **scoring features** (multi-ICP, recommended action).

---

## 1. SCORING gaps

| # | Sev | FAQ | Reality | Gap |
|---|---|---|---|---|
| S1 | **GAP (med)** | §2.4 + §5: compare one company against **multiple ICPs** → best-matching ICP, score per ICP, why each matched/failed, recommended next action | We score per chosen `icpVersionId` (one `V2LeadAssignment` = Company×Project×ICPVersion). `queryCompanyCrossIcpLeadAssignments` only *shows* whatever assignments already exist. | No **auto fan-out** that scores a company against ALL of a project's published ICPs + a **best-match presenter** ("ICP B is the best fit, here's why A/C failed"). Data model supports it (N LeadAssignments/company); missing = the fan-out enqueue + best-match read model. |
| S2 | GAP (low) | §5.2 + §6: explicit **Recommended action** ("what SDR/manager does next") | Assessment has `qualification` + `reasonCodes` (derivable) but no first-class `recommendedAction`. | Add a derived recommended-action (presenter, not schema) + a "Next action" column/chip. |
| S3 | DIVERGENCE/SURFACING (low) | §5.3: hard disqualifiers must be **human-readable, visible** | Lead drawer shows gate hits but as `reasonCodes`/gate-ids (e.g. `blocked_public_email_domain`). | Lead drawer = acceptable; a label map → human text is polish. (The real disqualifier-visibility gap is in **manager review**, see M3.) |
| S4 | OK (verify) | §5.1: score only **after enrichment + required evidence** | Pipeline chains `COMPANY_ENRICHMENT → ICP_SCORE`; engine routes missing required evidence to NEEDS_REVIEW / COMPANY_QUALIFIED_NEEDS_CONTACT instead of false-approving. | No gap in logic. Optional: a visible "scored before enrichment finished" guard if a manual rescore can outrun enrichment. |

## 2. MANAGE gaps (review + assignment + learning)

| # | Sev | FAQ | Reality | Gap |
|---|---|---|---|---|
| **M1** | **GAP (HIGH)** | §5.5 "Assign to SDR"; §6 "Assigned SDR" column; §11 assignment-change audit | `V2LeadAssignment` has **no owner/assigned-user field** (only `deletedByUserId`). Manager-review *items* can be assigned (`assignedToUserId`), but the **lead itself cannot be owned**. | **Lead ownership** is missing end-to-end. Needs: schema add `ownerUserId` (+ `assignedAt`/`assignedByUserId`), assign action (+ audit event), and surfacing as a column/filter/drawer field. **Structural; approval-gated migration.** This is the single biggest management gap. |
| M3 | **SURFACING (med)** | §5.5: review shows company/website/country/contact, matched ICP, score, confidence, **positive/negative/missing evidence, hard disqualifiers, original imported row, prior assessments, suggested decision** | `components/v2/reviews/ReviewQueueWorkspace.tsx` detail shows reasonCode, status, priority, confidence, source, linked company/contact/project/icp/workflow + latest fitScore/qualification. It does **not** show missing/required evidence, gate hits, assessment **history**, the original ingestion row, or a suggested decision. | The reviewer sees **less than the SDR lead drawer**. Reuse the lead-drawer why-score (gates + missing evidence + history) inside the review detail; add the source ingestion row + a suggested decision from `suggestedAction`/reasonCode. Data already exists. |
| M2 | GAP (med) | §5.5 review actions: approve / reject / **request more research** / **assign to SDR** / **mark duplicate** / **suppress** | M1 resolution types: APPROVE_CONFIRM, REJECT_DISMISS, REQUEST_CHANGES, LINK_EXISTING, CREATE_MISSING_ENTITY_LATER, NO_ACTION_NON_ACTIONABLE, CONVERT_TO_FEEDBACK_LATER, UPDATE_WORKFLOW_STATUS_LATER. | Missing review→action wiring for: **request research** (re-enqueue `COMPANY_ENRICHMENT`/rescore), **mark duplicate** (link + suppress dup outreach), **suppress** (create `V2SuppressionEntry`), **assign to SDR** (needs M1 ownership). REQUEST_CHANGES exists but isn't wired to re-enrichment. |
| M4 | GAP (med) | §10 learning loop: mark **false positive / false negative**, save reason, link to ICP rule/evidence gap, **reopen/re-score**, aggregate "which rule too strict/loose" | M3 feedback (`lib/v2/feedback`) captures predicted-vs-final + `approvedForLearning` + `datasetSplit`. No FP/FN classification, no reopen/rescore *from feedback* (M2 rescore fires from review resolution only), no rule-level aggregation. | Add FP/FN label on feedback, a feedback→rescore bridge, and a per-ICP-rule aggregate surface for the ICP authoring loop (R5). Closes §10. |

## 3. USING-LEAD gaps (workspace + drawer)

| # | Sev | FAQ | Reality | Gap |
|---|---|---|---|---|
| U1 | **GAP (HIGH)** | §6.1 "Assigned SDR" column + filter | No lead owner (= M1). | Same root as M1 — once `ownerUserId` exists, add the column + an "owner" facet (mirrors the W2 company facet). |
| U2 | GAP (low) | §6.1 "Next action" column | Not surfaced (= S2). | Derived recommended-action chip in the table + drawer. |
| U3 | DIVERGENCE (low) | §6.2 one status enum incl. IMPORTED/ENRICHING/SCORED/READY_FOR_OUTREACH… | We correctly **split**: pre-score pipeline stage lives on the **ingestion row** status; `V2LeadWorkflowStatus` is the operational SDR status (NEW…ARCHIVED); qualification is separate. | Not a gap — FAQ over-merges. Optional: a single derived "pipeline stage" chip on the lead that unifies ingestion-stage + scored + workflow for at-a-glance reading. |
| U4 | SURFACING (low) | §6.1 drawer shows "suppression result" | Compose checks suppression; the **lead drawer** does not show a per-lead suppression status. | Add a suppression badge to the lead drawer (reuse the compose `isSuppressed` check) so an SDR sees "do-not-contact" before acting. |

## 4. FAQ divergences (the ~40% where FAQ ≠ our correct design)

- FAQ uses **APPROVED/REJECTED**; we use **QUALIFIED / NEEDS_REVIEW / UNQUALIFIED / COMPANY_QUALIFIED_NEEDS_CONTACT** (richer, correct). Don't rename.
- FAQ §5.2 "score = a number"; we separate **fitScore + confidenceScore + accountPreRank** — keep ours.
- FAQ §6.2 collapses pipeline-stage + workflow-status + qualification into one enum; we correctly keep three axes (ingestion stage / workflowStatus / qualification). Keep the split.
- FAQ §10 "reopen/re-score from feedback"; we rescore from **review resolution** (M2). Either is valid; M4 just adds the feedback path.

---

## 5. Prioritized fix list (scoring + manage + using-lead)

1. **M1/U1 — Lead ownership** (HIGH, schema-gated). `ownerUserId` on `V2LeadAssignment` + assign action + audit + column/filter/drawer. Unblocks "Assign to SDR", routing, and per-SDR workload — the biggest management gap. *Approval-gated migration.*
2. **M3 — Manager-review detail parity** (med, UI only). Reuse the lead-drawer why-score (gates + missing evidence + assessment history + ingestion row + suggested decision) inside review detail. No backend change.
3. **M2 — Review action coverage** (med). Wire request-research (re-enrich/rescore), mark-duplicate, suppress, assign-to-SDR resolution paths to existing runtimes.
4. **S1 — Multi-ICP best-match** (med). Fan-out scoring across a project's published ICPs + best-match presenter on the company.
5. **M4 — Learning loop FP/FN** (med). FP/FN label + feedback→rescore + per-rule aggregation (feeds ICP authoring).
6. **S2/U2 — Recommended next action** (low). Derived presenter + column/chip.
7. **U4 — Lead-drawer suppression badge** (low). Surface do-not-contact at the lead level.

**Headline:** the scoring engine and SDR lead drawer are solid — **do not rebuild**. The real gaps are: (a) **no lead ownership** (M1/U1, structural), (b) **manager-review sees less than the SDR** (M3, pure surfacing), (c) **thin review actions + learning loop** (M2/M4), and (d) **no multi-ICP best-match** (S1). Most are UI/wiring on existing data; only M1 needs a (small, additive) migration.
