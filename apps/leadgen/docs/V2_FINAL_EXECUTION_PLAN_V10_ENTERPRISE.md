# V2 Final Execution Plan V10 Enterprise â€” SDR Workflow Audit & Live Cutover
Date: 2026-06-19

## Document Control
| Field | Value |
|---|---|
| Document version | V10 Enterprise (SDR Workflow Audit & Live Cutover) |
| Replaces | Updates V9 by incorporating the final SDR workflow audit, exposing missing UI connective tissue, UX blockers, and the root cause of the identity bug. |
| Canonical status | **Active source of truth for V2 execution planning.** |
| Current project state | Runtime solid (T/M/O pillars). UI exists but lacks "connective tissue" causing dead-ends. A major Contact Identity bug exists. |
| Strategic mode | Connective tissue, UX actionability, Bug crushing, and Live cutover. |
| Explicit hold | Do NOT live-send outreach without explicit gating/admin setup. Do NOT rebuild core architecture. |

## Executive Verdict
**The core architecture is solid and does not need a rebuild.** The `LeadAssignment`-centric approach, scoring per ICP, timeline, and outreach suppression gates are fundamentally correct.

However, an SDR stepping into the tool right now hits immediate brick walls. The system is "backend impressive, operator confusing". This plan links all previous plans together and adds the missing blind spots discovered during the SDR Workflow Audit.

---

## 1. The Blind Spots & Identified Bugs

We conducted a deep audit simulating the SDR workflow (Ingestion -> Leads -> Contacts -> Outreach). Here are the exact bugs that prevent this from being a usable product:

### 1.1 The Contact Identity Bug (P0 Data Integrity)
**The Bug:** The GPT review correctly spotted that Contact Identity is `company-scoped`. In `lib/v2/identity/resolveIdentity.ts`, the function `resolveExactContactForCompany` strictly filters candidates by `companyId`. However, `V2Contact` does not have a `companyId` in the schema; it relates to companies via `V2LeadAssignment`.
**The Impact:** The resolver only finds contacts *already linked* to a LeadAssignment for that company. If an existing contact is imported for a *new* company (e.g., job change) or isn't linked to a lead yet, the resolver misses them entirely and creates a duplicate `V2Contact`.
**The Fix:** Make identity resolution truly person-centric within the `organizationId`. Match purely on email/LinkedIn first, then link the existing `V2Contact` to the new `V2LeadAssignment`.

### 1.2 Lead Drawer Action Disconnect (P1 UX Blocker)
**The Bug:** In `LeadDrawer.tsx`, the "Next Best Action" text correctly tells the SDR: *"Company qualifies â€” find a target persona contact, then start outreach."* But there is **no inline CTA or button** to add a contact! The SDR is told what to do but given no tool to do it, resulting in a dead end.
**The Fix:** Add a "Find/Add Contact" CTA inside the Lead Drawer that opens a contact creation modal or links to an enrichment provider.

### 1.3 Contact Drawer "Blind Compose" (P1 UX Blocker)
**The Bug:** In `ContactDrawer.tsx` (line 55), the primary "Compose" button hardcodes the link to `detail.linkedLeadAssignments[0].leadAssignmentId`. If an SDR has a contact linked to *multiple* projects/ICPs, clicking the main Compose button skips their choice and forces them into the first lead.
**The Fix:** If `linkedLeadAssignments.length > 1`, the Compose button should open a dropdown to let the SDR choose the context (Project/ICP) for the email.

### 1.4 Ingestion Pipeline Freeze (P1 DX/UX Blocker)
**The Bug:** In `app/v2/ingestion/[jobId]/page.tsx`, the "Process pipeline" button triggers a server action (`processPipelineAction`) that loops 50 times synchronously to drain the background jobs. For a large CSV, this will timeout or freeze the Vercel edge function.
**The Fix:** Implement proper background async draining, or at least provide asynchronous polling UX so the UI doesn't freeze.

### 1.5 Outreach Sender Mystery & Missing Add (P2 UX)
**The Bug:** In `app/v2/outreach/page.tsx`, the "Sender readiness" panel displays `s.senderId.slice(0, 12)` (raw UUIDs). SDRs need to see `hao@telestar.com`. Furthermore, the UI says "Add one in the outreach build" but provides no "Add Sender" button.
**The Fix:** Join the sender email address for display. Add a direct "Add Sender" route/modal.

### 1.6 Contacts Workspace Filter Limitation (P2 UX)
**The Bug:** In `app/v2/contacts/page.tsx`, you can only filter by `search` and `seniority`. An SDR cannot filter by "Project" or "ICP". They cannot say "Show me all contacts for Project X".
**The Fix:** Add a Project/ICP facet to the Contacts filter.

---

## 2. Unified Execution Roadmap (Next 5 Sessions)

Execute these strictly in order. Do NOT mix backend runtime fixes with UI polish in the same session.

### Phase 1: Crush the Identity Bug (Backend - P0)
*   **Goal:** Fix `lib/v2/identity/resolveIdentity.ts` and `loadIdentityCandidates`.
*   **Scope:** Change the candidate loader to fetch all contacts for the tenant, regardless of `companyId`. Change the resolver to match primarily on Email/LinkedIn globally for the tenant. Add tests.

### Phase 2: Workflow Connective Tissue (UI/UX - P1)
*   **Goal:** Make the tool actionable for an SDR.
*   **Scope:**
    1. Fix the Contact Drawer Compose button (dropdown if multiple leads).
    2. Add "Add Contact" button in Lead Drawer.
    3. Fix the Ingestion "Process pipeline" synchronous loop timeout.
    4. Fix Outreach Sender UUID display and add an "Add Sender" stub.

### Phase 3: Route Shells & Outreach Live Path (Full Stack - P1)
*   **Goal:** Wire the actual sending capabilities.
*   **Scope:** Add shells for missing Nav links (`/v2/ai-insights` exists, but need to check others). Wire the O-pillar SMTP transport (`nodemailer`) + sender management UI behind the `outreach.admin` strict gate. Follow Invariant 10 (Suppression Gate).

### Phase 4: Continuous Improvement (UI Polish - P2)
*   **Goal:** Advanced SDR workflows.
*   **Scope:** Add Project/ICP filters to the Contacts Workspace. Add "Work an Account" mode (Group by Company view) in the Leads Workspace.

---

### Phase 5: Outreach Campaign Launch Parity (Session-gated - P1)
*   **Goal:** Make real campaign launch the next Outreach milestone: lead selection, sequence variants, sender pool, schedule, automated worker delivery, inbound outcomes, CTD tracking, and truthful analytics.
*   **Canonical detail:** `docs/v2/plan/V2_OUTREACH_INSTANTLY_PARITY_RESEARCH_2026-06-19.md`.
*   **Execution rule:** Follow that document's numbered session map. Start with contract/docs, then stop for review. Do not skip directly to schema, migration, OAuth, CTD, runtime, or UI implementation.
*   **Priority correction:** Campaign Launch precedes full Unibox. Unibox remains deferred until the launch acceptance loop passes.

## 3. Strict V2 Invariants (Reminders)
1. **Never use V1 business logic or V1 tables.** V2 must remain isolated.
2. **The Unit is LeadAssignment, not Company.**
3. **No Fake Rows.** `NOT_SCORED` is derived, not a row.
4. **Idempotency on all Upserts.** Idempotency keys must be respected.
5. **Suppression is the Last Gate.** No send goes out without a synchronous suppression check.

## 4. Document Hierarchy (Source of Truth)
1.  `V2_FINAL_EXECUTION_PLAN_V10_ENTERPRISE.md` (This document)
2.  `V2_FINAL_EXECUTION_PLAN_V9_ENTERPRISE.md` (Historical)
3.  `V2_FINAL_EXECUTION_PLAN_V8_ENTERPRISE.md` (Historical architecture baseline)
4.  `docs/v2/plan/*.md` (Historical drafts)


