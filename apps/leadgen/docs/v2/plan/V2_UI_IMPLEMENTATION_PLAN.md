# V2 UI Implementation Plan (PLAN ONLY — stop for approval before coding)

Status: the §6b "plan-only-first" deliverable for the full-UI phase. Per the design pack entry-prompt and master
plan §6b, **no UI files are edited until this is approved.** Sources synthesized: the project design pack
(`docs/v2/plan/design/V2_UI_MOCKUP_AGENT_PACK.md` — the implementation CONTRACT: tokens, density, 17 surfaces,
component kit, mockups), the §4e component-kit registry + §4e UI↔workflow linkage, the ui-ux-pro-max professional
rules (SVG icons not emoji, `cursor-pointer` on interactives, ≥4.5:1 contrast, 150–300ms transitions, floating
spacing, a11y, responsive at 320/768/1024/1440), and software-architecture quality (server/client split, compose
the kit, one source of truth). Python was unavailable so the ui-ux-pro-max search DB was not queried; its embedded
rules + the project pack govern.

## 1. Existing UI file inventory

Routes (16): `/v2/{home❌, accounts(+id), projects(+id), offers(+id), icp-library, ingestion/[jobId], leads,
reviews, companies, feedback, activity-recaps, uploads, login, logout}`. Missing vs pack: **home, contacts,
outreach(+sequences/suppression/senders), settings/ai, audit, icp-library/[id]/test**.

Shared kit (`components/shared/*`, 20): AppShell, SideNav, TopBar, PageHeader, PageToolbar, StatCard, MetricCard,
WorkspaceFrame, WorkspaceMetricGrid, DataTableShell, FilterBar, FilterChipBar, DrawerSection, PanelCard,
StickyActionBar, statusBadges, EmptyState, ErrorState, ErrorBanner, LoadingSkeleton, EntityAvatar.

Feature components (`components/v2/*`): leads (LeadDrawer, LeadWorkspaceTable, LeadWorkspaceFilters,
AssessmentSummaryCard, WorkflowStatusForm), plus accounts/projects/offers/icp-library/ingestion/reviews/feedback/
uploads/shell.

## 2. Missing component inventory (vs §4e registry — add to `components/shared`, register in §4e)

| Primitive | Why | Notes |
|---|---|---|
| `ScoreRing` | fit score on lead rows/drawer | SVG ring, canonical colors, sizes sm/md |
| `Stepper` | upload + multi-ICP flow | horizontal, current/done/upcoming |
| `Timeline` | promote the T5 lead-drawer timeline to a reusable primitive | one renderer for `queryLeadTimeline` |
| `UploadDropzone` | upload + activity recaps | drag/drop + choose-file, a11y |
| `EvidenceCard` | why-drawer + data-log | label + value + source link |
| `AuditSnapshotCard` | data-log / audit | before/after snapshot |
| `Tabs` (if not present) | every drawer | accessible roving tabs |
| `SequenceCanvasNode`, `SuppressionGateCard`, `SenderHealthCard` | OUTREACH only — **gated behind O-LIVE** | build with that phase |

No new AppShell/SideNav/TopBar/table/badge — reuse the kit (§4e rule).

## 3. Route-by-route plan (each = one §6b session, named mockup + bound read-model)

`✅` backend ready (build now) · `⚠️` partial · `❌` gated.

| Route | Mockup slice | Read-model (UPSTREAM) | Action (DOWNSTREAM) | Build |
|---|---|---|---|---|
| `/v2/leads` (cockpit + drawer) | leadassignment 01-07 | `queryLeadWorkspace`, `queryLeadTimeline`, `buildScoreExplanation` | workflow update, rescore, export, start-outreach(gated) | ✅ ALIGN existing |
| `/v2/ingestion/[jobId]` | ingestion 01-09 | progress route + auto-drain | run-until-idle | ✅ deepen row inspector |
| `/v2/reviews` | review 01-02 | `queryReviewQueue` + `queryReviewItem` | resolveReviewItem | ✅ ALIGN existing |
| `/v2/icp-library` | core 04 | `queryIcpLibrary` | clone/upgrade-to-v2/publish | ✅ ALIGN existing |
| `/v2/feedback` | governance 17 | `queryFeedbackLog` | createFeedbackExample | ✅ ALIGN existing |
| `/v2/home` | core 01 | `queryHomeOverview` (R1) | read-only + nav | ✅ NEW route |
| `/v2/contacts` | crm 12 | `shapeContactsWorkspace` (R4) | read-only + drawer | ✅ NEW route |
| `/v2/jobs` | (ops) | `summarizeJobs` (R3) | retry/cancel | ✅ NEW route |
| `/v2/settings` | governance (AI/readiness) | `buildProviderReadiness` (R7) | read-only | ✅ NEW route |
| `/v2/reports` | (reports) | `buildOutreachReport` (O8) + funnel | read-only | ⚠️ funnel read-model TBD |
| `/v2/companies` | crm 11 | company cross-ICP read-model | drawer (NOT company-scoring) | ⚠️ ALIGN existing |
| `/v2/accounts`, `/v2/projects` | core 02-03 | `queryProductTree` | hubs | ✅ ALIGN existing |
| `/v2/outreach(+sequences/suppression/senders)` | outreach 01-02, governance 15 | sender pool / suppression / O8 | send/sequence/suppress | ❌ GATED behind O-LIVE (no send UI before O2 gate is live) |
| `/v2/audit` | governance audit | `V2AuditEvent` read-model | read-only | ⚠️ read-model TBD |

## 4. Component reuse plan

- Page scaffold: `AppShell` (SideNav + TopBar) → `WorkspaceFrame` → `PageHeader`/`PageToolbar` → body.
- Metrics: `WorkspaceMetricGrid` of `MetricCard`/`StatCard`.
- Tables: `DataTableShell` + per-surface column defs; filters via `FilterBar`/`FilterChipBar`.
- Drawers: `DrawerSection` + `PanelCard` + `Tabs`; status via `statusBadges` (canonical tokens only — **no UNCERTAIN**).
- New primitives (§2) go in `components/shared` once, reused everywhere.
- Server components fetch read-models; client components only for interactivity (filters, drawers, actions).

## 5. Exact files (phase by phase — each phase a separate approved session)

- **U0 design-system pass** (`components/shared/*`, `app/globals.css` tokens only): confirm tokens match the pack
  (#0F5BF4 primary, #F8FAFC bg, #E5EAF2 border, #0F172A text, #64748B muted); add `ScoreRing`, `Stepper`,
  `Timeline`, `UploadDropzone`, `EvidenceCard`, `AuditSnapshotCard`, `Tabs`; register in §4e.
- **U1 align existing** (`app/v2/leads/*`, `components/v2/leads/*`; then reviews, icp-library, feedback,
  ingestion): match mockup density/drawers; bind the existing read-models; no backend change.
- **U2 new routes** (`app/v2/{home,contacts,jobs,settings,reports}/*`, `components/v2/{home,contacts,jobs,settings,
  reports}/*`): each binds its R-pillar read-model; add the nav entries in `SideNav`.
- **U3 outreach UI** (`app/v2/outreach/*`, `components/v2/outreach/*`): ONLY after O-LIVE; suppression/senders/
  sequence-builder; the compose page must show the suppression gate + sender health before any send control.

## 6. Visual risks (where exact pixel-match may not be possible)

- Score rings + funnel: SVG approximations of the mockup; exact gradients/animation may differ.
- The mockups show sample data (CloudScale, etc.); real data shape may not fill every column — empty states via
  `EmptyState`, never fake rows (Invariant 7).
- Dense tables at 320px: horizontal scroll within the table frame (not the page); prioritize key columns on mobile.
- Sequence canvas (U3) is a custom node graph — highest visual-fidelity risk; isolate to its own session.
- Light-mode contrast: enforce the ui-ux-pro-max rules (no `white/10` glass, slate-900 text, visible borders).

## 7. Verification checklist (per surface)

- `npm run lint && npm run typecheck && npm run build` green.
- Binds a REAL read-model; every control triggers a REAL action (or read-only) — no mock-as-truth.
- Product non-negotiables: LeadAssignment-level (ICP column on lead surfaces; qualification ≠ workflowStatus;
  NOT_SCORED derived; **no UNCERTAIN**); suppression gate visible before any send (U3); AI advisory-only.
- ui-ux-pro-max: SVG icons (lucide) not emoji; `cursor-pointer` on interactives; 150–300ms transitions; ≥4.5:1
  contrast; floating spacing; responsive 320/768/1024/1440; `prefers-reduced-motion`; focus states; alt text.
- Extend the `check-v2-ui-*` guard (plan §7 S-UI) for the surface (no UNCERTAIN; canonical badges; LeadAssignment-
  level leads; no send-before-gate).

## Recommended first session (on approval)

**U0 design-system pass** (confirm tokens + add the missing shared primitives), then **U1: `/v2/leads` cockpit +
drawer** aligned to `mockups/slices/leadassignment/*` (backend-✅: `queryLeadWorkspace` + `queryLeadTimeline` +
`buildScoreExplanation` + workflow/rescore/export actions all exist). Outreach UI (U3) stays gated behind O-LIVE.

STOP — awaiting approval to start U0 (or a re-prioritization).

---

## Phase progress + next sessions (live build log)

DONE (committed):
- U0 design system: `.v2-theme` scoped palette (#0F5BF4 / #F8FAFC; V1 untouched) + Tabs / ScoreRing / EvidenceCard (2a20807).
- U2 new routes bound to real read-models: /v2/home (9032692), /v2/settings (3cc7013), /v2/jobs + retry/cancel (4b447d3), /v2/contacts (cca43f2), /v2/reports (f768575).
- U1 premium LeadDrawer: ScoreRing header + Next Best Action + tabs (Overview / Why score / History) + **working Re-score** (POST /v2/leads/[id]/rescore enqueues ICP_SCORE + drains inline); Start outreach gated (cb55f9d). ScoreRing in the leads table (34f68ff). SideNav cleaned into Workspace / Targeting / Operations + muted Legacy (V1) (41958da).

NEXT (the SDR must see the FULL workflow + each page live with drawers, like the mock). Each is one §6b session, bound to an EXISTING read-model, tsc+build, commit:

### U4 — Export from leads (so a scored lead can go enrich)
- `app/v2/leads/export/route.ts` (GET): read the filter from searchParams → `collectLeadWorkspaceExportRows` + `serializeLeadWorkspaceCsv` (M4, exists in `lib/v2/crm/exportLeadWorkspace.ts`) → stream `text/csv` one-click (no 2-step job). Gate `crm.read`.
- Add an **Export CSV** button in the `/v2/leads` `PageHeader actions` (link to the route carrying the current filter querystring).
- Columns = `LEAD_EXPORT_COLUMNS` (leadAssignmentId + company/domain + contact + ICP + qualification + fitScore + workflow + assessment identity) — enough to feed an enrich tool. (Confirm whether to surface email/website/country more prominently.)

### U5 — Companies page premium + cross-ICP scoring drawer
- `components/v2/companies/CompanyDrawer.tsx` (opened via a URL param like the leads drawer): company summary + **`queryCompanyCrossIcpLeadAssignments`** (exists) — one row per ICP with a ScoreRing + qualification + workflow + "View assignment" link into the lead drawer's Why-score tab. This is the "see why this company scored this way across ICPs" surface (Invariant 2: a company scores per ICP, never globally).
- Premium-align the companies table; bind the drawer. (No `components/v2/companies/` dir yet — create it.)

### U6 — Contacts drawer (make contacts live)
- `components/v2/contacts/ContactDrawer.tsx`: contact detail (seniority from the shared dictionary, email identifier, **linked LeadAssignments**, recent activity). Bind from the `/v2/contacts` rows.

### U7 — Polish remaining pages toward the mock (live + drawers)
- /v2/reviews (resolution drawer exists — align), /v2/icp-library (authoring exists — align), /v2/feedback, /v2/accounts, /v2/projects: match mock density/drawers; every control triggers a real action or is a clear read-only/gated state. No mock-as-truth, no UNCERTAIN, no dead buttons.

### U3 — Outreach UI — still GATED behind O-LIVE (no send UI before the suppression gate is live).

Workflow-visibility check (the user's goal): after U4+U5 the SDR can walk load → score → **LeadAssignment** (drawer: why-score + Re-score) → **Export** (to enrich) → (later) outreach — end-to-end, each step a real action.

---

## DESIGN-SPEC ALIGNMENT (UD) — supersedes the U4–U7 ordering

Codex delivered a code-first tsx design-spec pack (`E:\telestar_v2_design_specs_tsx_pack`, 6 surfaces). The full
spec→production gap analysis + buildable sessions live in **`V2_UI_DESIGN_SPEC_ALIGNMENT.md`**. Tonight's order:

- **UD1 `/v2/leads`** — metric strip (7 StatCards) + ContextBar + 3-col bulk-actions rail + Run Multi-ICP; needs ONE new read-model `queryLeadWorkspaceMetrics` (counts = filtered total, NOT_SCORED derived) + `check-v2-lead-metrics-truth`.
- **UD2 lead drawer** — 620px cockpit, 6 tabs (Overview/Why Score/Contacts/Activity/Feedback/Data Log) bound to read-models already loaded on the page; Start-Outreach stays gated.
- **UD3 ingestion** — row inspector + 10-step stepper + 8-stat funnel against real job data (EmptyState where unpersisted).
- **UD4 manager-review** — align density/drawer only (A2 resolution semantics stay on hold).
- **OL5 outreach + sequence-builder UI** — the two gated specs are the visual contract for O-LIVE OL5 (`V2_OUTREACH_LIVE_BUILD_PLAN.md`); no send UI before the suppression gate.

U4 export already shipped (Export CSV via `buildLeadWorkspaceExportHref`); U5 companies cross-ICP drawer + U6 contacts drawer follow UD1–UD4.
