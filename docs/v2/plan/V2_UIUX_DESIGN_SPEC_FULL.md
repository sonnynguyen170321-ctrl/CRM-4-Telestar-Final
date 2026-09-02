# V2 — Full UI/UX Design Spec (Phase 1 + 2 + 3)

> Supersedes `V2_UIUX_DESIGN_SPEC.md` (Phase-1-only). Your `ui-ux-pro-max` skill generates UI **code**
> (Next.js/shadcn) from a design system, not a `.fig`. So this IS the deliverable: a `design-system/MASTER.md`
> + per-screen specs the skill consumes via its Master+Overrides pattern. Every screen is bound to the verified
> backend (read models, models, permissions). Build screens only when their backend read model exists
> (follow the phase order).

---

## 0. Product classification (tell the skill)
- **Type:** B2B SaaS — multi-tenant SDR/lead-gen OS. Use **Sales Intelligence / Data-Dense Dashboard** rules.
- **Style:** Minimalism & Swiss (enterprise dashboard) + light Soft-UI on cards. Calm, dense, fast.
- **Anti-patterns (hard avoid):** AI purple/pink gradients, neon, emojis-as-icons (use lucide), dark-only, heavy motion.
- **A11y:** WCAG AA; contrast ≥4.5:1; visible focus; prefers-reduced-motion.
- **Breakpoints:** desktop-first 1440/1024; usable 768.

---

## 1. MASTER design system (→ `design-system/MASTER.md`)

### Color — neutral base + FIXED semantic tokens (meaning never changes)
| Token | Meaning |
|-------|---------|
| `--qual-qualified` | QUALIFIED (green) |
| `--qual-needs-contact` | COMPANY_QUALIFIED_NEEDS_CONTACT (amber) |
| `--qual-needs-review` | NEEDS_REVIEW (blue) |
| `--qual-unqualified` | UNQUALIFIED (slate) |
| `--qual-not-scored` | derived/no assessment (slate-300, dashed) |
| `--wf-*` | 13 workflow statuses — distinct family from qualification |
| `--review-*` | review status/severity |
| `--send-*` | email send/event states (queued/sent/delivered/opened/bounced/replied) |
| `--processing` / `--failed` | job states |
One calm primary accent (blue/indigo). Light mode first. `statusBadges.tsx` is the single state→token mapper.

### Typography
`Inter` UI; tabular numerals for score/metric columns; dense table line-height, comfortable drawer reading.

### Spacing / density
Compact rows (~36–40px); 4/8/12/16/24/32 scale only; no arbitrary values.

### Component vocabulary (reuse → extend)
Reuse `components/ui/*` + `components/shared/*` (AppShell, SideNav, DataTableShell, FilterBar, EmptyState,
ErrorState, LoadingSkeleton, MetricCard, PageHeader, statusBadges). Add (one per session, reviewed):
ContextBar, FileDropzone, MappingTable, ProgressPanel, ScoreRangeSlider, ReasonBreakdown, MultiIcpCrossView
(P1); ReviewDetailPanel, ResolutionActionBar, WorkflowStatusControl, FeedbackForm, IcpRuleEditor (P2);
TemplateEditor, SenderConnectCard, EmailPreview, OutreachTaskCard, SequenceBuilder, ActivityTimeline,
SuppressionBadge, LinkedInImportPanel (P3).

### Pre-delivery checklist (every screen)
no emoji-icons · cursor-pointer on clickables · hover 150–300ms · contrast ≥4.5:1 · visible focus ·
reduced-motion · loading/error/empty present · token-only colors (no raw hex / `style={{}}`).

---

## 2. Information architecture (full)

```
[Context Bar: Account ▸ Project ▸ ICP Version]   (global, persistent)
Sidebar:
  Home            (dashboard)              P1/P2
  Leads           (workspace)              P1   ← core
  Uploads         (ingestion)              P1
  Reviews         (manager review)         P1 read → P2 interactive
  Outreach        (tasks/sequences)        P3
  Templates       (message templates)      P3
  Senders         (sender accounts)        P3
  ICP Library     (authoring)              P1 read → P2 editor
  Reports         (CRM dashboards)         P2
  Feedback        (history)                P2
  Settings        (org/user)               P2
```
Almost every screen is a lens scoped by the Context Bar. Gate score-dependent screens on a full context selection.

---

## 3. Per-screen specs (Reads · States · Actions+RBAC · Multi-ICP logic · Components)

### PHASE 1 screens

**3.1 Context Bar** — Reads: account→project→ICP options. States: none/partial/full. Actions: cascade select.
Multi-ICP: makes scores contextual; gate workspace until full. Components: 3 cascading Selects.

**3.2 Home/Dashboard** — Reads: context-scoped counts (qualified/needs_contact/needs_review/unqualified/derived
not_scored) + recent uploads. States: loading/empty/populated. Actions: CTA Upload; count→Leads pre-filtered.
Multi-ICP: numbers are per current context. Components: MetricCard grid, SVG bars.

**3.3 Leads workspace (core)** — Reads: `queryLeadWorkspace`→LeadWorkspaceRow[] (companyName, fitScore,
confidenceBand, qualification, workflowStatus, assignmentLevel, accountPreRank). States: loading/empty/error/
populated (virtualized 20k). Actions: filter (qualification incl. needs_contact, workflowStatus, score range,
type/country, scored); open drawer. RBAC `crm.read`. Multi-ICP: score is for the selected ICP; needs_contact is
a first-class amber filterable state; not_scored dashed. Components: TanStack DataTable, FilterBar, ScoreRangeSlider.

**3.4 Lead drawer — "why" + cross-view** — Reads: LeadWorkspaceDetail (assessment + JSON snapshots) +
same-company-other-ICP query. States: loading/loaded/not_scored. Actions: view evidence (P1 read). Multi-ICP
(the differentiator): reason ("strong account fit for {ICP} but needs {missing}"), hard-rule flags, matched/missed,
evidence, raw input snapshot, THEN cross-view ("Acme: Proj B/ICP2→UNQUALIFIED; Proj C/ICP1→QUALIFIED").
Components: Sheet, ReasonBreakdown, MultiIcpCrossView.

**3.5 Upload** — Reads: none; requires full Context. States: idle/file-selected/uploading/error. Actions: drop CSV
→ create ingestion job. RBAC `ingestion.apply`. Multi-ICP: upload INTO the chosen Project/ICP — show target loudly.
Components: FileDropzone.

**3.6 Column mapping** — Reads: parsed headers + sample rows. States: auto-mapped/needs-attention/confirmed.
Actions: map/override → confirm → normalize. RBAC `ingestion.apply`. Multi-ICP: map to canonical fields the
identity resolver expects. Components: MappingTable (react-hook-form), preview.

**3.7 Scoring progress** — Reads: V2Job aggregate. States: queued/running/done/failed. Actions: leave/return.
Multi-ICP: counts by qualification incl. needs_contact + not_scored. Components: ProgressPanel, ui/progress.

**3.8 Reviews (read-only in P1)** — Reads: queryReviewQueue. States: empty/populated. Actions: view only.
Multi-ICP: each item carries (project, ICP) + candidates. Components: DataTableShell, statusBadges.

**3.9 ICP Library (read in P1)** — Reads: ICP versions per account/project. States: list/detail. Multi-ICP:
published versions immutable; show version + status. Components: existing icp-library components.

**3.10 Export** — Actions: create export job (scope full/qualified/needs_contact), download signed URL. RBAC
`crm.read`. Multi-ICP: project-scoped, never global dump.

### PHASE 2 screens

**3.11 Workflow status control (in drawer)** — Reads: lead workflowStatus + transition matrix. States: per current
status. Actions: change to an ALLOWED next status (matrix-validated) + audit. RBAC `workflow.update`. Multi-ICP:
status is per LeadAssignment (per ICP). Components: WorkflowStatusControl (dropdown of valid next states only).

**3.12 Reviews interactive + detail** — Reads: queryReviewQueue + queryReviewItem (candidates, sourceRef, reason).
States: empty/list/detail/resolving. Actions: start/assign/resolve/reject/snooze + bulk. RBAC `manager_review.decide`.
Multi-ICP: resolve in the item's (project, ICP) context. Components: ReviewDetailPanel, ResolutionActionBar, bulk bar.

**3.13 Resolution actions** — surfaces the S3 outcomes: approve/link existing, create missing entity, update
workflow status (matrix), convert to feedback, no-action. Each shows what it will create/link before confirm.
Components: ResolutionActionBar + confirm dialogs.

**3.14 Feedback capture + history** — Reads: V2FeedbackExample history. States: empty/list. Actions: submit
correction from the lead drawer (append-only). RBAC manager/SDR. Multi-ICP: feedback tied to the LeadAssignment.
Components: FeedbackForm, history list. (Never implies auto rule change.)

**3.15 ICP editor / publish** — Reads: draft/published ICP versions (status, versionNumber, OCC version).
States: viewing/editing-draft/publishing/conflict(OCC). Actions: edit draft, publish (→ new version), OCC-guarded
save. RBAC manager. Multi-ICP: each published version is what scoring uses; immutable. Components: IcpRuleEditor
(react-hook-form + zod), version badge.

**3.16 CRM dashboards / Reports** — Reads: aggregates (pipeline by workflowStatus, qualification mix, SDR activity,
trends), context-scoped. States: loading/empty/populated. Actions: drill into Leads. Components: charts (confirm
dep), MetricCard.

**3.17 Settings + Org selector** — Reads: user orgs, settings. Actions: switch org (re-scopes everything), edit
prefs. RBAC per role. Components: org switcher in shell, settings forms.

### PHASE 3 screens

**3.18 Templates** — Reads: V2MessageTemplate (versioned, org/project). States: list/editor/version-history.
Actions: create/edit (new version, OCC). RBAC manager. Multi-ICP: optional project scope. Components: TemplateEditor.

**3.19 Senders** — Reads: V2SenderAccount (status, limits, warmup). States: none/connecting/connected/error/revoked.
Actions: connect Gmail/Workspace (OAuth) or SMTP; pause/revoke. RBAC manager. Components: SenderConnectCard.
(Creds never shown; status only.)

**3.20 Email preview / dry-run (in drawer or task)** — Reads: rendered template + variables + **suppression result**.
States: rendering/clear/suppressed/missing-vars. Actions: preview (no send). Multi-ICP: variables resolved from the
LeadAssignment context. Components: EmailPreview, SuppressionBadge.

**3.21 Outreach task queue** — Reads: V2OutreachTask (channel, status, due). States: empty/list. Actions: create
from selected leads; open task → preview → send. RBAC `manager_review.decide`/SDR. Multi-ICP: tasks created from
project/ICP-filtered leads. Components: OutreachTaskCard, queue table.

**3.22 Send confirm (semi-auto)** — Reads: rendered draft + suppression result. States: ready/suppressed/sending/
sent/failed. Actions: SDR approves → send ONE → snapshot + activity. RBAC send permission. Multi-ICP: logs against
the LeadAssignment. Components: EmailPreview + SuppressionBadge + confirm. **Suppression shown as the final gate.**

**3.23 Sequences** — Reads: V2Sequence/Steps/Enrollments. States: builder/enrolled/running/stopped. Actions: build
steps, enroll project/ICP-filtered qualified leads, monitor. RBAC manager. Multi-ICP: enroll by context. Components:
SequenceBuilder, enrollment list, progress. (Execution is worker-driven; UI only orchestrates.)

**3.24 Activity timeline (in drawer)** — Reads: V2ActivityRecord (all channels: email/event/call/linkedin/note).
States: empty/loaded. Actions: add manual note; (outcomes suggest workflow). Multi-ICP: per LeadAssignment.
Components: ActivityTimeline.

**3.25 Call logging** — Reads/Actions: log a call (manual or dialer webhook) → ActivityRecord(channel=call) +
outcome → workflow suggestion. Components: call log form / click-to-call (if dialer).

**3.26 LinkedIn import** — Reads: ingestion job result. States: idle/uploading/processing/done. Actions: submit a
LinkedIn export (manual, consent) → resolver → activity/review. RBAC SDR. Multi-ICP: matched to LeadAssignment via
the shared resolver. Components: LinkedInImportPanel. (Extension auto-collection gated on compliance review.)

---

## 4. How to drive the skill (workflow)
1. Generate the master once:
   `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "sales intelligence dashboard B2B SaaS multi-tenant" --design-system --persist -p "TeleStar SDR OS"`
   then reconcile with §1 (lock the semantic state tokens; enforce anti-patterns).
2. Per screen, create a page override and paste that screen's Reads/States/Actions/Multi-ICP/Components:
   `... --design-system --persist -p "TeleStar SDR OS" --page "leads"` (then "lead-drawer", "uploads",
   "reviews", "icp-editor", "outreach", "templates", "senders", "sequences", "activity", ...).
3. When the agent builds a screen, point it at `design-system/MASTER.md` + `design-system/pages/[page].md` + the
   matching session in the phase execution-logic spec, so visuals bind to the real read model/states.
4. **Build-order gate:** never let the skill generate a screen whose backend read model/route doesn't exist yet
   (e.g. no "why" cross-view before P1.S6; no review actions before P2.S2/S3; no send before P3.B5).

---

## 5. Two pieces that make the UI *prove* the product
- **Context Bar** (P1): without it the app is a prettier company table, not multi-ICP.
- **Lead drawer multi-ICP cross-view** (P1.S6): visibly shows the same company scoring differently per ICP — the
  thesis made visible. Everything else (review, outreach, sequences) is a child of the LeadAssignment that these
  two screens establish.

## 6. One-line
One MASTER (Swiss-minimal, fixed semantic state tokens, lucide, no AI gradients) + ~26 per-screen specs bound to
real read models, built in phase order through the skill. Reuse `components/shared/*`; add new components one per
session; gate every screen on its backend existing.
