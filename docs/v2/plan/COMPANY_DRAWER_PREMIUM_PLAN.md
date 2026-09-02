# Plan — Premium Company Drawer + Intelligence (match the mockup)

## Goal

The company-intelligence DATA is correct and loads. The DRAWER layout is plain
(single-column scroll, flat cards). Elevate it to the premium mockup: a tabbed,
two-column drawer with a Company Snapshot, Best-ICP-fit ring, a health/signals
panel, quick actions, and a Recent-Lead-Assignments table — **using only real
persisted data** (Invariant 7: no fabricated rows/fields; CINT rule: invent nothing).

## Hard rule for this work

Every premium element maps to a REAL field we persist, or it is omitted / shown as
"Not recorded". We do NOT invent employee counts, cities, Crunchbase links,
web-traffic trends, or a company owner just to match the mockup pixel-for-pixel.
Where the mockup shows data we don't have, the plan says "omit" or "derive from X".

## Data inventory (what we can actually show)

Source: `getCompanyDetail` (readModel) + `presentCompanyIntelligence` (IntelligenceView)
+ `CompanyIcpBestMatch` (bestMatch) + cross-ICP rows.

| Mockup element | Real data source | Verdict |
|---|---|---|
| Company name, domain, website | `company.name/canonicalDomain/websiteUrl` | ✅ have |
| LinkedIn link | `V2Company.linkedinUrl` (exists in schema, NOT yet selected by readModel) | ✅ add to select |
| Status pill ("Healthy") | `latestResearchStatus` + `latestProfileStatus` + intel confidence | ✅ derive |
| Employees, City | not stored | ❌ omit |
| Crunchbase / BuiltWith links | not stored | ❌ omit (keep Website + LinkedIn) |
| Country | `company.country` | ✅ have |
| Company ID / Created / Last enriched / Source | `company.id`, `createdAt`, `lastEnrichedAt`, intel `debug.providerUsed` | ✅ have |
| Owner | company has no owner; only lead-level owner | ❌ omit (or "per-assignment") |
| Tech tags (Cloud Native/Kubernetes…) | fact tokens (`offering.*`/`industry.*`/`category.*`) | ✅ derive |
| Best ICP Fit ring (92 High Fit) | `bestMatch` (existing CompanyIcpBestMatch) | ✅ have |
| Company Health rows (Technographics/Funding/News/Hiring/Web Traffic) | intel `maturity` + `growth` (hiring real, funding, signals) | ✅ partial — Web Traffic omitted |
| Key Signals — Positive | intel `growth.signals` + `maturity` (funding/hiring/partnerships/customers) | ✅ derive |
| Key Signals — Watch Outs | research status (JS_RENDER_REQUIRED/BLOCKED/TIMEOUT), LOW confidence, `risk.*` tokens, no-contact | ✅ derive |
| Quick Actions | Lead Assignments (have), Contacts (link), Start Outreach (compose), Suppression (link), Open in new tab | ✅ real links; drop actions with no backend (Add to Account List) |
| Recent Lead Assignments table | cross-ICP rows (icp/score/qualification/workflow/lastScored) | ✅ have (owner per-row if present) |
| Contacts (14) tab | `queryContacts`-style by company | ✅ phase 2 |
| Activity tab | `V2OutreachActivity` / timeline by company | ✅ phase 2 |
| Data & History tab | research snapshots + assessment history | ✅ phase 2 |

## Redesign — layout

### Header (premium)
- Square logo tile (initials or favicon from domain via `https://www.google.com/s2/favicons?domain=` — purely cosmetic, domain-derived, not invented data) + name.
- One status pill derived from research+profile+confidence: `Healthy` (EXTRACTED + HIGH/MEDIUM), `Partial` (PARTIAL/JS_RENDER_REQUIRED), `Needs research` (NOT_RUN), `Issue` (BLOCKED/TIMEOUT).
- Sub-line with icons: domain link · country · LeadAssignments count. (No employees/city — omit, don't fake.)
- Social row: Website + LinkedIn (only the two we store).
- Close button top-right.

### Tabs (match mockup)
`Overview` · `Lead Assignments (n)` · `Contacts (n)` · `Activity` · `Data & History`
- Phase 1 ships **Overview** + **Lead Assignments** fully; the other three are
  scaffolded tabs that read real data in phase 2 (no dead tabs — each shows real
  rows or a clean empty state).

### Overview tab — two columns
**Left (main):**
1. **Company Snapshot** card — summary (intel `companySummary`), Company ID, Created,
   Last enriched, Source (provider), tech tags (fact tokens). Social links inline.
2. **Company intelligence** — the restyled `CompanyIntelligencePanel` (see below).
3. **Key Signals** — two columns: Positive Signals (green ✓) | Watch Outs (amber ⚠),
   both derived from intel + research status.

**Right (rail, ~300px):**
1. **Best ICP Fit (Across Projects)** — big `ScoreRing` from `bestMatch` + ICP label +
   "View ICP match". (Reuse/upgrade CompanyIcpBestMatch.)
2. **Company Health** — rows: Hiring Intent (growth.hiringReal→High/—), Funding
   (maturity.funding→Healthy/—), Momentum (growth.signals count→Active/Quiet),
   Partnerships (maturity.partnerships→Strong/—), Customer proof (maturity.customers).
   Web Traffic / Technographics depth = omitted (no data).
3. **Quick Actions** — View Lead Assignments, Search Contacts, Start Outreach,
   Add to Suppression, Open in new tab. (Real links only.)

### Lead Assignments tab
- Promote the existing cross-ICP list into a clean table: ICP · Score · Qualification ·
  Workflow · Last scored · View. Keep "Score against all ICPs" action.

## Intelligence panel — premium restyle (`CompanyIntelligencePanel`)

Keep the same `IntelligenceView` data; restyle only:
- Category/vertical/confidence as a clean header strip with a confidence meter (not raw pill).
- "What they sell" as solid chips; Model/Channels as a labeled 2-col mini-grid.
- Likely buyers as avatar-less role chips.
- Growth signals with check icons + truncation tooltips.
- Partners as logo-less tags (we have names only).
- Maturity as a compact 4-dot strip.
- Evidence + Debug stay collapsed (`<details>`), restyled.
- Stays server-component-safe (no hooks), so it still drops into every surface
  (Company/Lead/Review/Compose) unchanged — the single-presenter contract holds.

## Files

**Read model (small, tenant-scoped — allowed):**
- `lib/v2/company-intelligence/readModel.ts` — add `linkedinUrl` to the company SELECT
  in `getCompanyDetail` + the `CompanyDirectoryRow` shape. (Phase 2: add contacts +
  activity + history loaders for the new tabs.)

**Presenter helpers (pure):**
- `lib/v2/company-intelligence/presentIntelligence.ts` — add a derived `health` +
  `keySignals` (positive/watchOuts) block to `IntelligenceView` so every surface can
  reuse them (no per-component logic). Pure; backed by existing fields.

**Components:**
- `components/v2/companies/CompanyDrawer.tsx` — rebuild: header + tabs + two-column Overview.
- `components/v2/companies/CompanyIntelligencePanel.tsx` — premium restyle (shared).
- `components/v2/companies/CompanyHealthRail.tsx` (new) — health + quick actions rail.
- `components/v2/companies/CompanyKeySignals.tsx` (new) — positive / watch-outs.
- Reuse `CompanyIcpBestMatch` (upgrade visuals).
- A small server-safe `Tabs` (reuse `components/shared/Tabs`).

**No schema / no migration.** All data already persisted; only `linkedinUrl` is newly
selected (column already exists).

## Phasing

1. **P1 — Overview premium** (highest value): header, tabs shell, two-column Overview
   (Snapshot + restyled intelligence + Key Signals + Best-ICP rail + Health + Quick
   Actions), Lead Assignments tab table. Ship + SEE-IT.
2. **P2 — remaining tabs**: Contacts (by company), Activity (outreach/timeline by
   company), Data & History (research snapshots + assessment history). Each real data.
3. **P3 — list page polish** (optional, mockup img 3): right sidebar on `/v2/companies`
   (health donut, top industries/countries, recent activity) — only if the aggregates
   are cheap to compute tenant-scoped; otherwise defer.

## Invariants
- 2 (company is never globally qualified — keep "per-ICP, no global company qualification"
  language on the Lead Assignments tab).
- 5 (every new read tenant-scoped from session).
- 7 (no fabricated fields — omit what we don't store; derive health/signals from real intel).
- 12 (UI phase + a read-only `linkedinUrl`/derived-helpers read-model touch is in scope).
- 14 (SEE-IT the drawer after P1).

## Out of scope
- Inventing employees/city/Crunchbase/web-traffic/company-owner data.
- New enrichment sources (ZoomInfo etc.).
- List-page premium beyond P3.
