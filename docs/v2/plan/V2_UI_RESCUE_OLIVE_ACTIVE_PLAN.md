# V2 UI Rescue + Interactive Workflow + O-LIVE Active Plan

Status: approved for implementation on 2026-06-18. Build in small sessions; commit and push after each completed
phase/session.

## 1. Source Of Truth

- Design contract: `docs/v2/plan/design/V2_UI_MOCKUP_AGENT_PACK.md`
- Entry prompt: `docs/v2/plan/design/CODEX_CLAUDE_ENTRY_PROMPT.md`
- Mockups: `docs/v2/plan/design/mockups/**`
- Outreach live plan: `docs/v2/plan/V2_OUTREACH_LIVE_BUILD_PLAN.md`

The mockups are an implementation contract, not inspiration. V2 must read as a dense enterprise SaaS operating
system: light slate background, white surfaces, compact tables, filter panels, right drawers, blue primary actions,
and no marketing-page composition.

## 2. Non-Negotiables

- `LeadAssignment` is the scoring unit; never create or render a global company score.
- Qualification and `workflowStatus` stay separate.
- `NOT_SCORED` is derived UI/read-model state only.
- Do not use canonical `UNCERTAIN`; use `NEEDS_REVIEW`.
- AI is advisory-only.
- Outreach send controls must sit behind suppression and sender-health checks.
- Do not touch V1 business/runtime code.
- Do not change schema/migrations/Auth0/tenant resolver/scoring semantics unless a later session stops for explicit
  approval.

## 3. Current Visual Gap Audit

- Shell/topbar/sidebar: `AppShell`, `SideNav`, and `TopBar` exist, but the current shell is still MVP-grade. Topbar
  lacks global search, workspace selector, upload action, AI action, notification/avatar density, and the sidebar
  still carries legacy V1 affordances that weaken the V2 operating-system feel.
- Tables/cards: `DataTableShell`, `PanelCard`, `DrawerSection`, and badges exist, but pages still hand-roll many cells
  and look generic rather than like the mockup pack's compact CRM surfaces.
- Drawers: Lead, Company, Contact, and Review drawers exist in some form, but detail density and hierarchy are uneven.
  Company intelligence currently renders raw fact/evidence tokens instead of readable business wording.
- Route structure: `/v2/leads`, `/v2/companies`, `/v2/contacts`, `/v2/reviews`, `/v2/uploads`, and
  `/v2/ingestion/[jobId]` are the critical "lazy SDR" workflow surfaces. Outreach routes are still the largest gap.

## 4. Phase A - UI Kit Foundation

Goal: make the reusable kit match the mockup language before more route polish.

Edit/refactor:

- `app/v2/layout.tsx`
- `components/shared/AppShell.tsx`
- `components/shared/SideNav.tsx`
- `components/shared/TopBar.tsx`
- `components/shared/PageHeader.tsx`
- `components/shared/DataTableShell.tsx`
- `components/shared/PanelCard.tsx`
- `components/shared/DrawerSection.tsx`
- `components/shared/statusBadges.tsx`
- `components/shared/ScoreRing.tsx`
- `components/shared/EvidenceCard.tsx`
- `app/globals.css` only for scoped `.v2-theme` token gaps

Create only if missing or if reuse needs a named primitive:

- `V2DetailDrawer`
- `V2FilterPanel`
- `V2ActionButton`
- `V2Tabs`
- `V2Stepper`
- `V2Timeline`
- `V2AuditSnapshotCard`
- `V2SequenceNode`
- `V2SuppressionGateCard`
- `V2SenderHealthCard`

Acceptance:

- fixed sidebar + operational topbar
- light mode only
- compact enterprise table/card/drawer defaults
- lucide/SVG icons only
- no V1 legacy nav in the V2 shell

Commit: `feat(v2): rebuild ui foundation`

## 5. Phase B - LeadAssignment + Ingestion Cockpit

Goal: `/v2/leads` becomes the primary SDR cockpit and `/v2/ingestion/[jobId]` explains the load-to-score pipeline.

Implement:

- `/v2/leads`: metrics, context, dense filters, saved views/bulk actions, export, compact LeadAssignment table.
- `LeadDrawer`: full mockup-style detail drawer with Overview, Why Score, Contacts, Activity, Feedback, Data Log.
- Upload/multi-ICP flow: stepper, mapping preview, ICP selector, run history.
- Ingestion job detail: row inspector with raw row, normalized fields, identity confidence, resolver decision, linked
  records, scoring status, and error trace.

Files:

- `app/v2/leads/**`
- `components/v2/leads/**`
- `app/v2/uploads/**`
- `components/v2/uploads/**`
- `app/v2/ingestion/**`
- `components/v2/ingestion/**`

Commit: `feat(v2): polish leadassignment cockpit`

## 6. Phase C - Companies + Contacts Rescue

Goal: Companies and Contacts become usable workspaces, not static reports.

Company intelligence:

- Add a pure presenter for `CompanyIntelligenceProfileSummary`.
- Convert neutral fact tokens into readable wording such as what the company appears to do, why we think so, signal
  categories, evidence quality, and conflicts.
- Deduplicate evidence by `family + token + sourceUrl + evidenceText`.
- Collapse noisy repeated URLs; show source count and expandable evidence.
- Never infer a global company verdict.

Companies:

- Add a real filter drawer.
- Filters: scored project, ICP, qualification, workflow, research status, country, industry/vertical/offer/fact tokens.
- Keep drawer URL state as `companyId`; use a separate filter drawer state such as `filters=open`.

Contacts:

- Extend `queryContacts` with search, pagination, seniority, department, email status, linked company, linked
  project/ICP, qualification, workflow, and activity filters.
- Drawer shows identity/email quality, linked LeadAssignments, activity, and jumps into LeadDrawer why-score.
- No contact-level scoring.

Files:

- `app/v2/companies/**`
- `components/v2/companies/**`
- `lib/v2/company-intelligence/**`
- `lib/v2/crm/queryCompanies*`
- `app/v2/contacts/**`
- `components/v2/contacts/**`
- `lib/v2/crm/queryContacts.ts`

Commits:

- `feat(v2): explain company intelligence`
- `feat(v2): add company filter drawer`
- `feat(v2): make contacts workspace live`

## 7. Phase D - O-LIVE Runtime + Outreach UI

Goal: finish the real outreach loop: verified sender sends, suppression gate blocks unsafe sends, IMAP inbound applies
reply/bounce/unsubscribe effects, and SDR sees the result on timeline/reporting surfaces.

Approved dependency direction:

- `nodemailer`
- `imapflow`
- `mailparser`
- `@types/nodemailer`

Sessions:

- OL1 SMTP transport behind existing `SmtpAdapter`.
- OL2 inbound APPLY runtime with idempotent tenant-scoped DB effects.
- OL3 IMAP poller with UID watermark processing.
- OL4 sender management and readiness UI.
- OL5 outreach hub: Compose, Sequences, Monitor, Templates, Suppression, Senders, Analytics.
- OL6 seeded outreach integration smoke.
- OL7 controlled live cutover only after env keys, sender credentials, DNS readiness, and worker secret exist.

Files:

- `lib/v2/outreach/**`
- `app/v2/outreach/**`
- `components/v2/outreach/**`
- `scripts/check-v2-outreach-integration.mjs`
- `scripts/v2-imap-poller.mjs`
- `package.json`

Commits:

- `feat(v2): add smtp outreach transport`
- `feat(v2): apply inbound outreach events`
- `feat(v2): add imap outreach poller`
- `feat(v2): manage outreach senders`
- `feat(v2): add outreach compose workspace`
- `feat(v2): add outreach integration smoke`

## 8. Phase E - Remaining Premium Routes

One route or one drawer per commit:

- `/v2/reviews`: manager review queue + resolution drawer.
- `/v2/icp-library`: builder/detail/version diff/publish affordances.
- `/v2/feedback`: learning-loop table + drawer.
- `/v2/accounts` and `/v2/projects`: portfolio/workspace drawers and hubs.
- `/v2/reports`, `/v2/jobs`, `/v2/settings`: density, empty states, action affordances.

## 9. Verification For Every Committed Session

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- Grep guards:
  - no canonical `UNCERTAIN`
  - no global company score
  - no V1 business imports in new V2 UI/read-model/runtime code
  - no plaintext secrets or credential logs
- SEE-IT/browser pass after major UI phases:
  - shell consistency
  - table density
  - drawer detail
  - LeadAssignment semantics
  - outreach suppression gate before send
  - company/contact routes actually usable
