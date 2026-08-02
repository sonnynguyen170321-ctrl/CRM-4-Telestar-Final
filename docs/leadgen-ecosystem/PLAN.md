# Leadgen Manager + Internal Lead Database — PLAN

Source: `C:\Users\admin\Downloads\leadgen-manager-ecosystem-implementation.md`

Goal: explicit `leadgen_manager` role + internal lead pool + campaign routing + audit trail. Implements the `2A. Leadgen Manager + Internal Lead Database` item of the working order (Opportunity Pipeline `2B` is already complete).

## Status

| Phase | Task | Status |
|-------|------|--------|
| 0 | Assessment + this plan | DONE |
| 1 | Role enum + LeadPoolItem / CampaignLeadRequirement / LeadgenActivity + ImportBatch/ImportRow tweaks + migration | DONE |
| 2 | Auth helpers + podScoping + call sites | DONE |
| 3 | lib/leadgen service layer | DONE |
| 4 | `/api/leadgen-pool` routes + worker pool-import branch | DONE |
| 5 | Sidebar / Topbar / login / settings / AppContext / redirects | DONE |
| 6 | `/leadgen-manager` console UI | DONE |
| 7 | Tests + lint + typecheck + build | DONE |

## Required deviations from source doc

1. **`canImportExport` keeps existing roles.** Doc removes `sdr`/`leadgen`. This repo's SDRs import/export leads via `CSVImportModal` + `app/api/leads/import` (existing tests assert sdr/leadgen → true). Deviation: `director | floor_manager | leadgen_manager | leadgen | sdr`; `team_lead` stays excluded.
2. **Explicit-role `getLeadgenScope` + data migration.** Doc replaces the reporting-structure heuristic. To preserve current behavior for existing DB users: users with `role='leadgen'` whose `manager.role === 'leadgen'` stay `leadgen` (members); all other `leadgen` users (their manager is director/FM/none — today's "manager" heuristic) are promoted to `leadgen_manager` in the migration.
3. **`ImportBatch.campaignId` becomes nullable + new `targetType` field** (`'lead' | 'pool'`, default `'lead'`) so the pool import reuses the existing BullMQ parse/chunk/commit pipeline. `ImportRow` gains optional `poolItemId`.
4. **Worker transactions allowed.** Neon HTTP driver has no interactive transactions, but workers run on the separate always-on host with `DIRECT_URL` — the existing `workers/import.ts` already uses `prisma.$transaction`. Pool import branch follows the same pattern.
5. **New `/leadgen-manager` console** (not tabs inside existing `/leadgen`). Existing `/leadgen` workspace stays for `leadgen` members; the console is a separate route for `leadgen_manager`.
6. **`requireManager` unchanged** — leadgen_manager is on the leadgen branch, not the sales-pipeline manager gate. `requireRole` hierarchy becomes `['sdr','leadgen','leadgen_manager','team_lead','floor_manager','director']` (leadgen_manager ≥ leadgen, below sales management).

## Permission model

- `leadgen_manager` (or director/floor_manager): view all pool records, import, export, qualify, assign to campaign, convert to SDR Lead, create campaign lead requirements, review team/source performance.
- `leadgen` (member): view assigned pool queue, enrich records, mark needs-research / suggest qualification. No export, no assignment.
- `sdr`: only converted `Lead` records assigned to them. No raw pool access.

## Schema additions (Phase 1)

- `enum Role`: add `leadgen_manager`.
- `enum LeadPoolStatus`, `LeadQualificationStatus`, `LeadQualityTier`, `LeadSourceType`.
- `model LeadPoolItem` per doc (account/contact optional relations, status/qualification/tier, source, scores, duplicateKey + duplicateOf self-relation, qualifiedBy/At, assignedCampaign/assignedSdr/convertedLead, tags, rawPayload, tenant).
- `enum CampaignLeadRequirementStatus` + `model CampaignLeadRequirement`.
- `enum LeadgenActivityType` + `model LeadgenActivity`.
- Back-relation arrays on `Account`, `Contact`, `Campaign`, `User`, `ImportBatch`, `Lead`.
- `ImportBatch.campaignId` nullable, `targetType` field; `ImportRow.poolItemId`.

## Phases

1. **Schema + migration** — edit `prisma/schema.prisma`; manual migration `2026080201…_add_leadgen_ecosystem` (drop NOT NULL on campaignId, add enums/models, promote legacy leadgen managers); `migrate deploy`; `prisma generate`.
2. **Auth** — `SessionUser` union, `requireRole` hierarchy, `getLeadgenScope` (explicit), `canImportExport`, new `isLeadgenManager`/`isLeadgenUser`; podScoping/call sites compile.
3. **lib/leadgen services** — pool queries, import-normalize, dedupe (normalizedEmail/Phone/LinkedIn/name+company), qualify/disqualify, assign campaign, assign SDR (single + round-robin), convert pool→Lead (reuse worker commit pattern), export CSV, requirements CRUD, activity log, metrics.
4. **API** — `app/api/leadgen-pool/{route,import,export,qualify,assign-campaign,convert-to-leads,requirements,duplicates,metrics}`; extend `ImportParsePayload`/`ImportChunkPayload` with `targetType`; worker pool branch.
5. **UI** — Sidebar leadgen console, Topbar switcher option, login demo account, settings role dropdowns, AppContext `UserRole`/`isManager`/`isLeadgenManager`, root redirect.
6. **Console** — `/leadgen-manager` page with tabs: Overview, Internal Database, Import Center, Qualification Queue, Campaign Routing, Export, Team Performance, Source Performance.
7. **Verification** — update `tests/leadgen.test.ts` (explicit roles + leadgen_manager), add pool service/API tests, `vitest run`, `tsc --noEmit`, `eslint`, `npm run build`.

## Acceptance (done criteria per doc §15)

- [x] `leadgen_manager` is a real role
- [x] Leadgen Manager manages leadgen members
- [x] Imported raw leads stored without campaign/SDR assignment (LeadPoolItem)
- [x] Pool dedupes + qualifies
- [x] Qualified leads assigned to campaign
- [x] Qualified leads converted into SDR-owned `Lead`
- [x] Qualified leads exported as CSV
- [x] Lead supply visible by campaign (requirements progress)
- [x] SDRs only see converted leads assigned to them
- [x] Leadgen activity logged
