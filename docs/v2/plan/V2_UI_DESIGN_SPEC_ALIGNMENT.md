# V2 UI Design-Spec Alignment Plan (UD) — tsx specs → production routes

Status: PLAN ONLY (§6b plan-only-first). Build sessions UD1+ tonight, one surface per session, commit each.

## Source
Codex dropped a **code-first design-spec pack** at `E:\telestar_v2_design_specs_tsx_pack` (6 surfaces, mock data,
self-contained mock kit `V2MockComponents.tsx`). These are the **visual contract** — the same role the PNG mockups
play in `V2_UI_MOCKUP_AGENT_PACK.md`. They are NOT data truth: production routes bind the real tenant-scoped
read-models and never render mock rows (Invariant 7 — no fake rows; Invariant 2 — LeadAssignment unit; no UNCERTAIN).

Specs covered: `leads`, `lead-drawer`, `ingestion`, `outreach`, `sequence-builder`, `manager-review`.

## Spec ↔ production route ↔ read-model ↔ status

| Spec route (tsx pack) | Prod route | Read-model (exists?) | Action(s) | Build status |
|---|---|---|---|---|
| `design-specs/leads` | `/v2/leads` | `queryLeadWorkspace` ✅ + `listLeadWorkspaceFilterOptions` ✅ + **`queryLeadWorkspaceMetrics` ❌ NEW** | export ✅, rescore ✅, bulk (NEW), run-multi-ICP (NEW) | **UD1** build now |
| `design-specs/lead-drawer` | `/v2/leads?selectedLeadId=` | `getLeadWorkspaceDetail` ✅ + `queryLeadTimeline` ✅ + `buildScoreExplanation` ✅ + `queryCompanyCrossIcpLeadAssignments` ✅ | rescore ✅, start-outreach (gated) | **UD2** build now |
| `design-specs/ingestion` | `/v2/ingestion/[jobId]` | progress route ✅ + auto-drain ✅ (row-inspector read-model ⚠️ partial) | run-until-idle ✅ | **UD3** build now (deepen) |
| `design-specs/manager-review` | `/v2/reviews` | `queryReviewQueue` ✅ + `queryReviewItem` ✅ | resolveReviewItem ✅ | **UD4** align (A2 resolution depth gated — read/align only) |
| `design-specs/outreach` | `/v2/outreach` | sender pool / suppression / `buildOutreachReport` ✅ | send/sequence | **GATED → O-LIVE OL5** |
| `design-specs/sequence-builder` | `/v2/outreach/sequences/[id]` | sequence policy ✅ | publish/enroll | **GATED → O-LIVE OL5** |

The two gated specs are now the **authoritative visual contract for O-LIVE OL5** — see `V2_OUTREACH_LIVE_BUILD_PLAN.md`.
Do not build a send/compose/sequence UI before the O2 suppression gate + sender-health are live (Invariant 10).

## UD0 (optional, recommended first) — vendor the pack as an internal reference route
Copy `app/v2/design-specs/**` + `components/v2/design-specs/**` into the repo **verbatim** (the `@/` alias is
supported; pure presentational, no backend). Purpose: a live `/v2/design-specs` index to screenshot-compare while
building. Guardrails: **never link it from the production `SideNav`**, never treat its mock rows as truth, keep it
clearly labeled "design spec / mock data". It is reference scaffolding, not a product surface. (If you prefer zero
mock code in the repo, skip UD0 and compare against the pack folder directly.)

## Per-surface delta (production = real data; spec = layout target)

### UD1 — `/v2/leads` workspace  [UI + 1 read-model]
Current: 2-col `[280px filters | table]`, Export CSV in header, drawer wired. Spec target adds three things:
1. **Metric strip** — 7 `StatCard`s: Total / Qualified / Needs Review / **Needs Contact** (COMPANY_QUALIFIED_NEEDS_CONTACT) / Unqualified / **Not Scored** (derived, `latestHardRuleAssessmentId IS NULL`) / Meeting Booked. → **NEW read-model `lib/v2/crm/queryLeadWorkspaceMetrics.ts`**: tenant-scoped counts grouped by qualification + workflowStatus, respecting the SAME filter contract as `queryLeadWorkspace` (counts must equal the filtered table, like M4 export-truth). Smoke `check-v2-lead-metrics-truth` (counts sum to filtered total; NOT_SCORED derived, never a stored row).
2. **ContextBar** — Account / Project / Offer / ICP / Due-range chips from the active filter context (read-only breadcrumbs). Reuse `FilterChipBar`.
3. **Layout → 3-col** `[280px filters | table | 300px rail]`. Right rail: **Bulk Actions** (Re-score selected, Export filtered, Start outreach[gated], Convert to feedback — requires row-selection state in `LeadWorkspaceTable`, a client island) + **Saved Views** (defer persistence; render the canonical view presets as filter links) + a muted "Design note" (ICP column stays; qualification ≠ workflow; no UNCERTAIN).
4. Header action **Run Multi-ICP Scoring** = batch enqueue ICP_SCORE over the filtered set (reuse the rescore route logic over selection); keep Export CSV.
Files: `app/v2/leads/page.tsx`, `components/v2/leads/LeadWorkspaceTable.tsx` (+ selection), new `components/v2/leads/LeadMetricStrip.tsx` + `LeadBulkActionsRail.tsx`, `lib/v2/crm/queryLeadWorkspaceMetrics.ts` (+ `index.ts` export). Verify: tsc+build; metric counts = filtered total; ScoreRing/badges already canonical.

### UD2 — Lead drawer  [UI only]
Current drawer: tabs Overview / Why score / History + ScoreRing header + Next Best Action. Spec target = a **620px
visually-dominant cockpit**, tabs **Overview · Why Score · Contacts · Activity · Feedback · Data Log**, with a 2-col
MiniCard grid: Company Brief, Reason Breakdown (per-dimension `buildScoreExplanation`), Key Info, Signals, Score
Components (rule-based vs AI-research vs total — AI advisory-only), Next Best Action. Footer: **View Suggested Email**
(read-only preview, no send) + **Start Outreach** (gated until O-LIVE). Bind: Why-Score ← `buildScoreExplanation`;
Activity ← `queryLeadTimeline` (promote to the `Timeline` primitive); Contacts ← detail contacts; Feedback ←
`activeReviews`/feedback; Data Log ← `queryLeadTimeline` audit entries. All read-models already loaded in
`app/v2/leads/page.tsx`. Files: `components/v2/leads/LeadDrawer.tsx` (+ small Timeline primitive in `components/shared`).
Verify: every tab binds a real loader; no UNCERTAIN; Start-Outreach disabled with a gated tooltip.

### UD3 — Ingestion row inspector  [UI, deepen]
Spec target: Job-header KV grid, an 8-stat pipeline funnel (Uploaded / Parsed / Matched / Created / LeadAssignments /
Enriched / Scored / Errors), a 10-step `Stepper` (Upload→…→Done), per-row pipeline table (raw → identity-match →
company-upsert → LeadAssignment → score), and a **Row Inspector** with 6 tabs (Raw Row, Normalized, Identity,
Records, Scoring, Errors). Build against the EXISTING progress route + whatever per-row data the ingestion run already
persists; where a field isn't persisted yet, render an honest `EmptyState` (never fabricate). Files:
`app/v2/ingestion/[jobId]/page.tsx` + `components/v2/ingestion/*`. Verify: stepper/funnel reflect real job counts;
no fake row states.

### UD4 — Manager review align  [UI align — A2 depth gated]
Spec target: 5 stat cards, left `FilterPanel`, table, and a resolution drawer (tabs Details/Context/History/Audit;
Matched Records, Evidence, Recommended Next Action, append-only Resolution Form). `/v2/reviews` +
`queryReviewQueue`/`queryReviewItem` exist. Align the existing surface to the spec's density/drawer. **Do not expand
A2 manager-review resolution semantics** (still on hold per AGENTS.md) — UI/read alignment only; resolution actions
stay as-is. Files: `app/v2/reviews/page.tsx` + `components/v2/reviews/*`. Verify: drawer binds the real review item;
audit is append-only/read-only in UI.

## Component reconciliation (spec kit → real shared kit)
The pack's `V2MockComponents` (Badge, ScoreRing, StatCard, DataTable, DetailDrawer, FilterPanel, Stepper,
SequenceNode, Checklist, KeyValueList…) map onto the real shared kit — DO NOT introduce the mock kit into production:
- Badge→`statusBadges`, ScoreRing→`components/shared/ScoreRing` (exists), StatCard→`StatCard`/`MetricCard`,
  DataTable→`DataTableShell`, DetailDrawer→`DrawerSection`+`PanelCard`+`Tabs`, FilterPanel→`FilterBar`,
  Stepper→add `Stepper` (U0 list), Checklist→`SuppressionGateCard`/`SenderHealthCard` (O-LIVE), SequenceNode→
  `SequenceCanvasNode` (O-LIVE). Spec uses `rounded-2xl` cards / heavier density — adopt that density in the real kit
  where it doesn't break tokens (#0F5BF4 primary etc. unchanged).

## Build order (tonight)
```txt
UD0 (optional) vendor /v2/design-specs reference  ->  screenshot-compare baseline
UD1 /v2/leads (metric strip + 1 read-model + 3-col rail)   [highest SDR value]
UD2 lead drawer cockpit (6 tabs)
UD3 ingestion row inspector
UD4 manager-review align
(OL5 outreach + sequence-builder UI stay gated behind O-LIVE OL1–OL4)
```

## Verification (every UD session)
- `npm run lint && npm run typecheck && npm run build` green.
- Binds a REAL read-model; every control = a REAL action or an explicit read-only/gated state (no mock-as-truth, no dead buttons).
- Product non-negotiables: LeadAssignment unit + visible ICP column; qualification ≠ workflowStatus; NOT_SCORED derived; **no UNCERTAIN**; AI advisory-only; no send UI before the suppression gate.
- ui-ux-pro-max: lucide SVG icons (no emoji — the spec's `✦`/letter-glyphs become lucide in prod), `cursor-pointer`, 150–300ms transitions, ≥4.5:1 contrast, focus states, responsive 320/768/1024/1440, `prefers-reduced-motion`.
- Extend the `check-v2-ui-*` guard for the surface; add `check-v2-lead-metrics-truth` for UD1.

This plan supersedes the U4–U7 ordering in `V2_UI_IMPLEMENTATION_PLAN.md` with the spec-aligned UD1–UD4 (export from
UD1's rail already exists via `buildLeadWorkspaceExportHref`; companies/contacts drawers remain as U5/U6 after UD1–UD4).
