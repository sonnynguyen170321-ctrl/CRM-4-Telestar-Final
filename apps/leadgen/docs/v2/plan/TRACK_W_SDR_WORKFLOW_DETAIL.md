# Track W — SDR Workflow continuity (detailed, grounded in current code)

Parent: `RUNTIME_WORKFLOW_REVIEW_AND_BLINDSPOTS.md` (Phase W). Phase 0 is done; this is
the workflow track — mostly UI + read-model, low runtime risk, high daily SDR value. It
makes a rep move Contact → Lead → Score → Compose/Campaign without page-level friction.

Grounded in a fresh read of the CURRENT code (the original SDR audit predates the
contact-first refactor + campaigns + my /v2/leads selection infra), so the plan reuses
what exists and fixes what's actually broken.

---

## 0. Current-state findings (verified, not from the stale audit)

1. **`/v2/contacts` table is a UI mockup with FABRICATED data + dead controls**
   (`components/v2/contacts/ContactWorkspaceTable.tsx`):
   - Owner column is hardcoded **"Taylor M." on every row** — a real Invariant-7 violation
     (fabricated data shown to users).
   - Pagination is fake (hardcoded buttons 1–5…21, "Show 20" wired to nothing).
   - Header checkbox is `disabled`; row checkboxes have no selection state.
   - Actions column is a lone `MoreHorizontal` button that does nothing.
   - "Linked Projects" and "Linked ICPs" both render the same `leadAssignmentCount`.
   - Dead helpers: `getCountryEmoji`, `ConfidenceBadge`, `StatusText` (unused).
   → This is the #1 bottleneck AND a correctness bug: the contacts surface dead-ends and
   lies. It must be made real + actionable.

2. **Campaign lead source is global top-200** (`queryCampaignWizardLeads`):
   `take: 200` of ALL active assignments org-wide, ordered by `updatedAt` — NOT scoped to
   the selected/filtered leads, project, ICP, owner, or qualification. So "filter 50 leads
   → add to campaign" is impossible; the wizard shows a global slice. (audit #5, confirmed.)

3. **Reusable infra already exists** (build once, in /v2/leads): `LeadSelectionProvider`
   + row/select-all checkboxes (`LeadSelection.tsx`), `LeadBulkActionBar`,
   `EnrollSequenceDialog` (single + batch), `POST /v2/leads/enroll` (batchEnroll), and the
   contact→company join. Track W should REUSE these on Contacts, not rebuild (DRY).

4. **Route language is inconsistent**: /v2/leads uses `?selectedLeadId=`, compose uses
   `?leadAssignmentId=`, contacts uses `?contactId=`. No shared "act on this lead" contract.

---

## W1 — Cross-page route + action contract (small, enabling; do first)

### Goal
One LeadAssignment-centered link language so every surface can hand off without guessing.

### Contract
```
/v2/leads?selectedLeadId=<id>                      open lead drawer
/v2/leads?companyId=<id>                            leads filtered to a company (exists)
/v2/leads?ownerUserId=<id>&qualification=QUALIFIED  filtered workbench (exists)
/v2/outreach/compose?leadAssignmentId=<id>          one-off compose (exists)
/v2/outreach/campaigns/new?source=selected&leadIds=a,b,c
/v2/outreach/campaigns/new?source=filter&projectId=<id>&icpVersionId=<id>&qualification=QUALIFIED
/v2/outreach/inbox/<leadAssignmentId>               thread (exists)
```

### Build
- A tiny helper `lib/v2/crm/leadRoutes.ts` (pure): `leadDrawerHref`, `composeHref`,
  `campaignFromSelectionHref`, `campaignFromFilterHref`, `inboxThreadHref`. Single source
  of truth for these links; every component imports it instead of string-building.

### Acceptance
From any contact/lead row or drawer, the "next action" links are built by one helper and
all resolve to a working surface. No bespoke string concatenation of these routes remains.

---

## W2 — Contacts as a real SDR workbench (the #1 fix)

### Goal
Replace the mockup with real data + real actions, reusing the /v2/leads selection +
enroll infra. An SDR can go Contact → Lead → Compose/Sequence from the list.

### Current vs target
- Remove fabricated Owner ("Taylor M."), fake pagination, dead checkboxes/actions, and
  the dead helpers.
- Each contact resolves to its **primary LeadAssignment** (most-recent active) so row
  actions can target a real lead.

### Read model
- Extend `queryContacts` (or a focused `queryContactWorkbench`) to return, per contact:
  primary `leadAssignmentId`, primary company, real `ownerName`/`ownerUserId` (from the
  lead), `qualification` + `fitScore` (latest assessment), `hasEmail`, `activeEnrollmentCount`,
  `lastTouchAt`. All real joins (LeadAssignment → assessment/owner/company). Tenant-scoped.
- Real pagination (page/pageSize/total) like `queryContactLeads` already does for /v2/leads.

### UI
- Rebuild `ContactWorkspaceTable` as a thin real-data table:
  - Real header/row checkboxes wired to `LeadSelectionProvider` (REUSE — the selection
    set holds the row's `leadAssignmentId`).
  - Columns: Contact · Title · Company · Qualification/Fit · Owner (real) · Email-ready ·
    Active sequences · Actions.
  - Row actions (real links via W1 helper): **Open lead** (`?selectedLeadId=`), **Compose**
    (`compose?leadAssignmentId=`), **Add to sequence** (REUSE `EnrollSequenceDialog`
    single), overflow menu for Re-score/Add-to-campaign.
  - Email-ready badge replaces the `mailto:` default: when the lead has a valid email →
    Compose link; else "No email".
- Reuse `LeadBulkActionBar` (Add to sequence / Score against ICP) on the contacts page by
  wrapping the table in `LeadSelectionProvider` and feeding `enrollOptions` + `icpVersions`.
- Real pagination footer (reuse the /v2/leads pattern; delete the fake one).

### Acceptance
- No hardcoded owner / fake pagination / dead control remains; `npm run build` + a grep
  show zero fabricated display data on the contacts surface.
- Select N contacts → bulk "Add to sequence" enrolls their leads (reusing /v2/leads/enroll).
- A contact with no LeadAssignment shows "Create/assign lead" instead of a dead action.

### Invariants
2 (act on the LeadAssignment, not the contact) · 5 (tenant-scoped) · 7 (no fabricated
data — this PHASE removes existing violations) · 12 (UI + a read-only read-model helper).

---

## W3 — Campaign lead source from selection / filter (audit #5)

### Goal
A campaign uses the leads the SDR actually selected or filtered — not a global top-200.

### Read model
- Replace `queryCampaignWizardLeads(org, campaignId)` with a source-aware
  `queryCampaignLeadSource(org, campaignId, source)` where `source` is one of:
  - `{ kind: "selected", leadAssignmentIds: string[] }`
  - `{ kind: "filter", projectId?, icpVersionId?, clientAccountId?, ownerUserId?,
       qualification?[], workflowStatus? }`
  - `{ kind: "recent" }` (the current top-N default, kept as a fallback)
  - Always applies `excludeAlreadyEnrolled` / `excludeSuppressed` / `excludeNoEmail`
    eligibility (the existing selectable/issue logic — reuse it).
- Keyset/limit guarded; no unbounded load.

### Wiring
- `/v2/leads` bulk bar gets an **"Add to campaign"** action → `campaigns/new?source=selected&leadIds=...`
  (or an existing campaign). REUSE `LeadSelection` ids.
- Campaign setup reads the `source` from the route and shows exactly those leads with the
  eligibility breakdown (selectable / already-enrolled / no-email / suppressed / needs-override).

### Acceptance
- From `/v2/leads`, filter + select rows → "Add to campaign" → the campaign shows EXACTLY
  those leads (minus ineligible, with reasons), not a global slice.
- Project+ICP source path works without a manual selection too.

### Invariants
2 · 5 · 6 (idempotent enrollment) · 10 (suppression still gates at send).

---

## W4 — Sandbox vs live send clarity (small, removes "did it actually send?")

### Goal
Make it unmistakable whether a send is sandbox/test or real live SMTP.

### Current
Compose computes `canSend` from lead+email+suppression+sender, but actual transport
depends on `sender.liveSendEnabled` + credential key + kill switch — a sender can be
"active" but sandbox, which is confusing.

### Build
- Compose + Senders show an explicit **Transport mode** per sender: `Live SMTP` vs
  `Sandbox` (derived from liveSendEnabled + credential key + kill switch — reuse the
  resolveSendProvider gate's inputs).
- Compose send control labels the outcome: "Send (sandbox)" vs "Send (live)" so the rep
  knows. The suppression gate remains the last check (Invariant 10) regardless.

### Acceptance
A rep can tell at a glance, before clicking, whether the email will go out live or to the
sandbox; the label matches what `resolveSendProvider` would actually do.

---

## W5 — Fast lead drawer (optional; defer unless review prioritizes)

### Goal
Drawer opens instantly client-side; deep sections hydrate via one read-model endpoint
instead of a full-page server navigation on every row click.

### Note
Higher effort + overlaps Track R (read-model). The current drawer works; this is a
perceived-speed upgrade, not a correctness fix. Schedule AFTER W1–W4 (and align with the
Track R read-model work so the drawer endpoint isn't built twice).

---

## Execution order + session shape
1. **W1** route/action contract (tiny, enabling) — commit.
2. **W2** Contacts real workbench (the #1 fix; reuses selection/enroll infra) — commit.
3. **W3** campaign lead source from selection/filter — commit (read-model + wiring).
4. **W4** sandbox-vs-live clarity — commit (small).
5. **W5** fast drawer — deferred / align with Track R.

Each independently committable. W2 is the highest-value, highest-correctness item (kills
fabricated data + the dead-end). Recommended first build after W1.

## Reuse ledger (DRY — don't rebuild)
`LeadSelectionProvider` + checkboxes · `LeadBulkActionBar` · `EnrollSequenceDialog`
(single + batch) · `POST /v2/leads/enroll` (batchEnroll) · `queryContactLeads` paging
pattern · the campaign eligibility (selectable/issue) logic · `presentCompanyIntelligence`
(if intel shown). New code only where a real gap exists (route helper, contact-workbench
read model, source-aware campaign query, transport-mode display).
