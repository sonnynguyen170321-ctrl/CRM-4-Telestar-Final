# V2 Final Execution Plan V9 Enterprise — Wiring & Live Cutover
Date: 2026-06-19

## Document Control
| Field | Value |
|---|---|
| Document version | V0.9 Enterprise (Wiring & Live Cutover) |
| Replaces | Updates V0.8 by shifting focus from "architecture/runtime build" to "UI wiring & live cutover" |
| Canonical status | Active source of truth for V2 execution planning |
| Current project state | Runtime largely done (T/M/O pillars). UI/glue missing. One identity bug identified. |
| Strategic mode | Connective tissue, UX actionability, and controlled live cutover |
| Immediate next phase | Contact Identity Fix (W6) -> Route Shells (NS1) -> Connective Tissue (W1) |
| Explicit hold | Do NOT live-send outreach without explicit gating/admin setup. Do NOT rebuild core pipelines. |

## Executive Verdict
**The core architecture is solid and does not need a rebuild.** The `LeadAssignment`-centric approach, scoring per ICP, timeline, and outreach suppression gates are fundamentally correct.
The current issue is not the runtime—it is the **glue between pages**, **UX actionability**, a **genuine data-model bug regarding contact identity**, and the final **live cutover steps**.

This plan synthesizes the [Next Steps Plan](file:///c:/projects/telestar-company-filter/docs/v2/plan/V2_NEXT_STEPS_DETAIL_PLAN_2026-06-19.md), [Wiring Audit](file:///c:/projects/telestar-company-filter/docs/v2/plan/V2_SDR_WORKFLOW_WIRING_AUDIT_2026-06-19.md), and [Outreach Live Plan](file:///c:/projects/telestar-company-filter/docs/v2/plan/V2_OUTREACH_LIVE_BUILD_PLAN.md) into one prioritized roadmap.

---

## 1. Current State (The Architectural Spine)
The backend pillars (T, M, and O) are largely complete at the runtime level:
*   **Data Model**: `V2Company` (domain-based), `V2Contact` (person-centric), and `V2LeadAssignment` (Company × Project × ICPVersion).
*   **Pipeline**: Upload → Map → Parse → Normalize → IdentityMatch → Upsert LeadAssignments → Score.
*   **Outreach (O-Pillar)**: `EMAIL_SEND` and `SEQUENCE_STEP_EXECUTE` are wired. The suppression gate is the last synchronous check before provider calls.
*   **Missing Piece**: The pages do not connect. The system feels like "backend impressive, operator confusing" because the happy paths are long, unguided, and empty states lead nowhere.

---

## 2. P0 Ship-Blockers & Critical Bugs

### 2.1 Contact Identity Company-Scoped Bug (W6)
**Issue:** `V2Contact` is intended to be person-centric, but the identity resolver currently matches contacts within the scope of a `companyId`. If a contact changes jobs, the system fails to reuse the contact and creates duplicates.
**Fix:** Modify the resolver (not the schema). Implement an email-first global contact match within the organization. If the email exactly matches an existing non-generic contact, reuse `V2Contact` and create a new `LeadAssignment` for the new company. Add fixtures for job-change and Vietnamese/Unicode normalization.
**Action:** Must be fixed first, but gated by review since it alters lead/contact creation semantics.

### 2.2 Dead Nav Links (NS1)
**Issue:** `/v2/outreach`, `/v2/ai-insights`, and `/v2/admin` exist in the SideNav but result in 404s because the pages are missing.
**Fix:** Add route shells. They can be permission-gated and have empty states, but they must not 404. Do not overbuild—just create the structural shells first.

### 2.3 Page-to-Page Glue (W1 & W3)
**Issue:** Leads, Contacts, and Outreach exist as isolated islands.
*   Lead/Contact drawers lack a direct "Compose" or "Enroll" path.
*   Ingestion uploads happen via background daemon, leaving the user with an unguided UI (no "Process pipeline" button).
*   Outreach hub lacks onboarding.
**Fix:** Wire the UI. Connect the Lead/Contact drawers to `/v2/outreach/compose?leadAssignmentId=...`. Add a synchronous "Process pipeline" button to Ingestion.

### 2.4 O-LIVE is not Live Yet (OL1/OL4/OL7)
**Issue:** The O-pillar runtime exists, but real execution (SMTP transport, IMAP poller, sender management UI) is not wired.
**Fix:** Follow the O-LIVE plan carefully. Wire real SMTP transports, inbound IMAP runtime, and sender management UI. **Do not flip `liveSendEnabled`** until a verified sender can successfully pass through the suppression gate, send an email, and handle a reply/bounce.

---

## 3. High-Risk Areas & Guardrails

> [!WARNING]
> **Adhere strictly to these guardrails to prevent regressions and security vulnerabilities.**

1.  **RBAC for Live Sending:** `liveSendEnabled` and kill switches must be gated behind `outreach.admin` (OWNER/ADMIN only), NOT `product_tree.write`.
2.  **Sequence Enrollment Reuse:** Sequence runtime already exists in the backend worker (`lib/v2/outreach/sequences/**`). Do not build duplicate enrollment logic or new schedulers. Wire the UI to the existing runtime.
3.  **ContextBar Scoping:** The `ContextBar` should only appear on routes requiring Account/Project/ICP context (e.g., `/v2/leads`, `/v2/ingestion`). Remove it from global `/v2/*` layouts that include Outreach or Settings.
4.  **No Fake Metrics:** Open rates, click rates, and AI insights must be disabled or marked clearly as advisory if the underlying data doesn't exist. Do not mock data in production.
5.  **QA / CI Minimums:** The lack of CI/CD is a major enterprise blind spot. At a minimum, ensure `lint`, `typecheck`, `build`, and existing smoke scripts run cleanly before any pilot.

---

## 4. Prioritized Execution Roadmap (Next 5 Sessions)

Execute these strictly in order. One phase / one change-kind per session. Commit after each.

### Session 1: W6 Contact Identity Review + Fix
*   **Why:** Resolves the most critical data bug. Duplicate contacts will corrupt outreach and reporting.
*   **Scope:** Resolver logic only (`lib/v2/identity/resolveIdentity.ts`). Add fixtures/smoke tests for job-changes and unicode normalization. No UI work.

### Session 2: NS1 Route Shell Cleanup
*   **Why:** Kills the most visible UX bug (404s in the sidebar).
*   **Scope:** Add basic, gated route shells for `/v2/outreach`, `/v2/ai-insights`, and `/v2/admin`. No send controls yet.

### Session 3: W1 Lead/Contact → Outreach Connective Tissue
*   **Why:** Makes the CRM actionable.
*   **Scope:** Add "Compose 1-off" and "Enroll in sequence" actions to the Lead and Contact drawers. Wire them directly to the outreach runtime. If backend support is missing, STOP and report.

### Session 4: W3 Guided Ingestion Run
*   **Why:** Transforms file uploads from "black-box daemon" to a visible, guided workflow.
*   **Scope:** Add a "Process pipeline" drain button on the ingestion job page. Show job progress and row inspector.

### Session 5: OL1 / OL4 / OL7 Gated Live Sender Path
*   **Why:** Enables actual email sending capabilities.
*   **Scope:** SMTP transport (`nodemailer`) + sender management UI. Conduct one internal live test only. Must be strictly gated by `outreach.admin`.

---

## 5. Continuous Improvement (P2 Product Polish)

These items should be addressed after the immediate Next 5 Sessions:

1.  **"Work an Account" Mode (W2):** SDRs work accounts, not just individuals. Add a `companyId` facet and group-by-company view to `/v2/leads` using `queryCompanyCrossIcpLeadAssignments`.
2.  **Contact Clarity (W4):** After fixing W6, enhance the Contacts page to display a primary email picker, clear linked Company/Project/ICP data, and direct Compose CTAs.
3.  **UI Design Spec Adherence:** Use the Design Spec as a *visual layout contract*, not as a data source. Every control must bind to real tenant-scoped read-models.
4.  **Security Hardening:** Implement rate limits for the worker drain endpoint, establish key rotation for `V2_OUTREACH_CREDENTIAL_KEY`, and audit-log the live-send and kill-switch toggles.

---

## 6. Document Hierarchy (Source of Truth)

If contradictions arise between historical documentation and the repo, **the repo wins**. When feeding context into sessions, prioritize documents in this order:

1.  `V2_FINAL_EXECUTION_PLAN_V9_ENTERPRISE.md` (This document)
2.  `V2_NEXT_STEPS_DETAIL_PLAN_2026-06-19.md`
3.  `V2_SDR_WORKFLOW_WIRING_AUDIT_2026-06-19.md`
4.  `V2_OUTREACH_LIVE_BUILD_PLAN.md`
5.  `V2_HARDENING_H1_H4.md`
6.  `V2_UI_DESIGN_SPEC_ALIGNMENT.md`
7.  Older Phase docs (only as historical invariants/references).
