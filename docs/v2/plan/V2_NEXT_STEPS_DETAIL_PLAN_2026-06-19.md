# V2 Next-Steps Detail Plan — 2026-06-19

Status: drafted 2026-06-19 after the T-pillar + M-pillar merge and the premium-UI / O-LIVE pull.
Owner hand-off plan. Build in small sessions; `lint + typecheck + build` + the relevant smoke, then commit + push after **each** session. One change-kind per session (V2 INVARIANT 12). Do not advance a macro-phase without the SEE-IT browser pass.

This plan is the concrete sequencing layer under the approved `docs/v2/plan/V2_UI_RESCUE_OLIVE_ACTIVE_PLAN.md` (Phases A–E). It reflects the **actual repo state at HEAD**, not the idealized plan.

---

## 1. Where we actually are (HEAD audit, 2026-06-19)

Backend pillars (runtime + smokes) — DONE and on `origin/feature/shared-types`:

- **T pillar** (activity tracking): T1 contract → T2 `V2ActivityRecord` migration → T3 `ACTIVITY_APPLY` handler → T4 `queryLeadTimeline` → T5 recaps page + lead-drawer timeline.
- **M pillar** (CRM loops): M1 review resolution route + UI → M2 review→rescore bridge → M3 feedback capture `/v2/feedback` → M4 export source-of-truth (`EXPORT_GENERATE` + `/v2/exports/[exportId]` download).
- **O pillar runtime**: `lib/v2/outreach/**` is fully built (activities, credentials, inbound, limits, providers, senderPool, sequences, suppression, reporting, worker). `EMAIL_SEND` + `SEQUENCE_STEP_EXECUTE` handlers are wired in `lib/v2/jobs/handlers.ts`. Smokes: `check-v2-outreach-*`, `check-v2-suppression-gate`, `check-v2-sequences`, `check-v2-warmup`, `check-v2-provider-abstraction`, `check-v2-settings-readiness`, plus `scripts/v2-job-worker.mjs`.

UI shell — premium rebuild in progress (Phases A–C partially landed):

- `AppShell` + `SideNav` (Operate / Plan / Operations groups, v2-only) + `TopBar` + `ContextBar`.
- Premium leads workspace (UD1) + lead drawer cockpit (UD2, 6 tabs), company filter drawer, contact detail drawer, company cross-ICP drawer, "explain company intelligence" presenter, review-queue resolution drawer.

### 1a. FIXED this session

- **Duplicated app shell** (the "duplicated tree"): root `app/layout.tsx` already wraps every route in `<AppShell>`; `app/v2/layout.tsx` wrapped its children in a **second** `<AppShell>`, rendering two SideNavs + two TopBars under `/v2/*`. Fixed: `app/v2/layout.tsx` now only injects the `ContextBar` (flush under the TopBar via negative margins) above page content. Commit `fix(v2): remove duplicated app shell` (`bec7206`). Verified `typecheck` + `build` clean.

### 1b. Open gaps found in the audit (drive the sequencing below)

1. **Dead nav links (P0 UX bug).** `SideNav` links to `/v2/outreach`, `/v2/ai-insights`, `/v2/admin`, but:
   - `/v2/outreach` has only `app/v2/outreach/drain/route.ts` — **no `page.tsx`** → 404.
   - `/v2/ai-insights` — directory absent → 404.
   - `/v2/admin` — directory absent → 404.
2. **Outreach has runtime but no UI hub.** `lib/v2/outreach/**` is complete; there is no `app/v2/outreach/page.tsx` and no `components/v2/outreach/**`. This is Phase D / OL5.
3. **My M/T pages predate the premium kit.** `/v2/feedback` (M3) and `/v2/activity-recaps` (T5) were built with `WorkspaceFrame` + `PageHeader` + hand-rolled tables. They render fine inside the single shell but do not yet use the premium `DataTableShell` / `PanelCard` / drawer language. Phase E polish.
4. **O-LIVE not cut over.** OL1–OL7 (real SMTP/IMAP transport, inbound apply, IMAP poller, sender management UI, live cutover) are not done; `nodemailer` / `imapflow` / `mailparser` not yet wired. Live send stays gated (Invariants 9/10).

---

## 2. Non-negotiables (carry every session)

- `LeadAssignment` is the scoring unit; never render a global company score (Invariant 2).
- Qualification ≠ `workflowStatus` (Invariant 3). Assessments immutable (Invariant 4).
- Tenant isolation from session `organizationId`, never a client param (Invariant 5). Idempotency on jobs/upserts (Invariant 6).
- `NOT_SCORED` is derived UI state; never write canonical `UNCERTAIN` (Invariant 7). Soft-delete respected (Invariant 8).
- Secrets encrypted + never logged; webhooks/inbound signature-verified (Invariant 9). **Suppression is the last synchronous gate before any send** (Invariant 10).
- Do not modify V1 business/runtime. Do not touch schema/migrations/Auth0/tenant resolver/scoring semantics without stopping for explicit approval.
- One phase / one change-kind per session (Invariant 12). Tests are part of the exit gate (Invariant 13). Backend session → SEE-IT pairing (Invariant 14). Never commit/advance without review (Invariant 15) — except this hand-off explicitly authorized autonomous commit+push per session.

---

## 3. Sequenced sessions

Ordered by user impact. Each session: implement → `lint && typecheck && build` → smoke/guard → SEE-IT (if UI) → commit → push → append `docs/v2/codex/SESSION_LOG.md`.

### NS1 — Kill the dead nav links (P0)

Problem: three sidebar items 404. Either ship the real surface or a tenant-scoped placeholder, but the nav must never point at a 404.

- **NS1a `/v2/outreach` hub shell.** Add `app/v2/outreach/page.tsx` (+ `loading.tsx`, `error.tsx`) gated on `crm.read`. First cut = read-only Monitor: recent `V2OutreachActivity` + sender-health + suppression summary from the existing `lib/v2/outreach/reporting` + `senderPool` read models (no new query if a read model exists). No send controls yet (those are NS4 behind the suppression gate).
- **NS1b `/v2/ai-insights`.** Add `app/v2/ai-insights/page.tsx` — advisory-only read surface (AI is advisory, never canonical). If no read model exists yet, ship an explicit "AI advisory, imported/human-filled only" empty-state rather than a 404.
- **NS1c `/v2/admin`.** Add `app/v2/admin/page.tsx` — org/members/roles read view from the tenant layer; no mutations in this cut.

Files: `app/v2/outreach/**`, `app/v2/ai-insights/**`, `app/v2/admin/**`, optionally `components/v2/outreach/**`.
Acceptance: every `SideNav` link resolves to a real page; each gated by permission; tenant-scoped; light enterprise density; no dead routes.
Verify: `npm run lint && npm run typecheck && npm run build`; SEE-IT click every sidebar item, confirm no 404 and single shell (no duplicate tree).
Commit: `feat(v2): add outreach/ai-insights/admin route shells` (split per route if large).

### NS2 — Premium-align the M/T pages

Bring `/v2/feedback` and `/v2/activity-recaps` up to the premium kit so the workspace reads consistently.

- Replace hand-rolled tables with `DataTableShell` / `PanelCard` / shared badges; keep the existing read models (`queryFeedbackLog`, `queryActivityRecapStats`) and routes unchanged (no backend change).
- `/v2/feedback`: move the capture form into the premium drawer language; keep the deep-link `?leadAssignmentId=` prefill. Optional follow-up: embed the feedback form in the Lead drawer "Feedback" tab (UD2 already defines that tab) — this finally closes the "feedback in lead drawer" deferral from M3.
- `/v2/activity-recaps`: align stat strip + recent-records table to the premium table.

Files: `app/v2/feedback/**`, `components/v2/feedback/**`, `app/v2/activity-recaps/**`, optionally `components/v2/leads/LeadDrawer*` (only if embedding the feedback tab — separate session if so).
Acceptance: both pages match the mockup language; no backend/runtime change; M3/T5 smokes still green.
Verify: lint/typecheck/build; `node scripts/check-v2-feedback-capture.mjs`; SEE-IT both pages.
Commit: `feat(v2): premium-align feedback + activity-recaps`.

### NS3 — Phase C finish: Contacts + Companies usability

Per active plan §6. Contacts page exists (224 lines) — verify it is live (filters/pagination/drawer) vs static, then close gaps:

- Contacts: extend `lib/v2/crm/queryContacts.ts` with search, pagination, seniority, department, email status, linked company/project/ICP, qualification, workflow, activity filters. Drawer shows identity/email quality + linked LeadAssignments + jump into Lead why-score. **No contact-level scoring.**
- Companies: ensure the filter drawer covers scored project, ICP, qualification, workflow, research status, country, industry/vertical/offer/fact tokens; keep `companyId` drawer state separate from `filters=open`. Company intelligence stays readable wording, deduped evidence, **no global company verdict**.

Files: `app/v2/contacts/**`, `components/v2/contacts/**`, `lib/v2/crm/queryContacts.ts`, `app/v2/companies/**`, `components/v2/companies/**`, `lib/v2/company-intelligence/**`.
Acceptance: contacts/companies are working filtered workspaces, not static reports.
Verify: lint/typecheck/build; relevant CRM read-model smoke; SEE-IT.
Commits: `feat(v2): make contacts workspace live`, `feat(v2): companies filter + intelligence polish`.

### NS4 — Phase D: Outreach UI on the existing runtime (NOT live cutover)

The outreach runtime + suppression gate already exist; build the operator surfaces on top, send controls **behind** the synchronous suppression + sender-health checks (Invariant 10). Still gated/dry — no real SMTP until OL7.

- OL5 outreach hub tabs: Compose, Sequences, Monitor, Templates, Suppression, Senders, Analytics — wired to the existing `lib/v2/outreach` read models. Compose's send button calls `EMAIL_SEND` enqueue which must pass `assertNotSuppressed` immediately before the provider call.
- OL4 sender management + readiness UI (`senderPool` + `credentials` + warmup policy), credentials displayed never-plaintext.

Files: `app/v2/outreach/**`, `components/v2/outreach/**`.
Acceptance: SEE-IT shows the suppression gate blocking an unsafe send; sender health visible; no plaintext secrets in UI or logs.
Verify: lint/typecheck/build; `node scripts/check-v2-suppression-gate.mjs`, `check-v2-outreach-send.mjs`, `check-v2-sequences.mjs`, `check-v2-settings-readiness.mjs`; SEE-IT.
Commits per tab, e.g. `feat(v2): add outreach compose workspace`, `feat(v2): manage outreach senders`.

### NS5 — Phase E: remaining route density

One route/drawer per commit: `/v2/reviews` (resolution drawer polish), `/v2/icp-library` (builder/diff/publish affordances), `/v2/accounts` + `/v2/projects` (portfolio/workspace drawers), `/v2/reports` + `/v2/jobs` + `/v2/settings` (density, empty states, action affordances).

### NS6 — O-LIVE cutover (GATED — explicit approval required)

OL1 SMTP transport (`nodemailer`), OL2 inbound APPLY runtime, OL3 IMAP poller (`imapflow` + `mailparser`, UID watermark), OL6 seeded integration smoke, OL7 controlled live cutover **only after** env keys + sender credentials + DNS readiness + worker secret exist. Adding `nodemailer`/`imapflow`/`mailparser` to `package.json` and any send-live step must STOP for explicit approval (Invariants 9/10; AGENTS dependency/secret rules).

---

## 4. Verification gate (every committed session)

- `npm run lint` · `npm run typecheck` · `npm run build`
- Relevant smoke(s) green; backend change adds/updates its smoke.
- Grep guards: no canonical `UNCERTAIN`; no global company score; no V1 business imports in new V2 code; no plaintext secrets / credential logs.
- SEE-IT browser pass after UI phases: single shell (no duplicate tree), table density, drawer detail, LeadAssignment semantics, suppression gate before send, every nav link resolves.

## 5. Immediate next action

Start **NS1a** (`/v2/outreach` page shell) — it removes the most visible remaining breakage (a sidebar link that 404s) and seeds the outreach UI surface that Phase D builds on. Then NS1b/NS1c, then NS2.
