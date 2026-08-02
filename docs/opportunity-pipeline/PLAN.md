# Opportunity / Deal Pipeline — Implementation Plan

Source: `C:\Users\admin\Downloads\opportunity-deal-pipeline-implementation.md` (Priority item 2)
Repo: `clone-CRM-4-U-migration-main` (Telestar SDR CRM)

## Status

Phases 1–6 **implemented** (2026-08-02). Lint + typecheck clean; `tests/opportunities.test.ts` 14/14 green. Remaining: manual smoke via `next dev`/`build` (dev server intentionally stopped during Phase 1 — engine DLL lock), optional RLS table-array append.

- Phase 1 (DB): enums + `Opportunity` + `OpportunityActivity` in `prisma/schema.prisma`; manual migration `20260802000000_add_opportunity_pipeline` applied via `migrate deploy` (`meetingId` FK column included, FK constraint omitted — Meeting table is outside migration history, created via `db push`; `Opportunity_meetingId_key` unique index matches schema `@unique`). `prisma generate` done.
- Phase 2 (lib): `access.ts`, `service.ts`, `lifecycle.ts`, `metrics.ts` (incl. `toNumber`) + validation schemas. Sequential awaits only (no interactive txn). Idempotency via pre-create `findFirst`.
- Phase 3 (API): 6 new routes + extended outcome route (auto-convert) + `app/api/opportunities/metrics/route.ts` (`groupBy=sdr|client|campaign`).
- Phase 4 (UI): `MeetingOutcomeModal` — conditional create-opportunity section.
- Phase 5 (UI): `Opportunities` nav item (after Meetings); `app/opportunities/page.tsx` (Board/Table/Client Review/Forecast tabs); `components/opportunities/*` (table, board, stage badge, value card, detail panel, create + client-acceptance + lost-reason modals).
- Phase 6 (tests): `tests/opportunities.test.ts` — service idempotency/seed, manual create, moveStage won + lost-guard, handoff accepted/rejected/needs-more-info (+ task only when lead exists), metrics, access, validation. 14/14 pass.
- Verification: `tsc --noEmit` clean; `eslint` clean; full suite 249 pass / 3 pre-existing failures (admin Redis health + sequence-execute mock gaps — unrelated).
- Deviation notes: `Task.leadId` required → follow-up task only when opportunity has a lead; POST manual create is `requireManager()`-only (no `OpportunitySetting`, v1.1).

---

## 0. Codebase state (verified 2026-08-02)

Item 1 (Meeting Booking + Meeting Outcome) is **already built**:

- `model Meeting` + `MeetingStatus` / `MeetingOutcome` enums — `prisma/schema.prisma:122-139, 850-897`
- `bookMeeting()` / `logMeetingOutcome()` — `lib/meetings/meetingLifecycle.ts`
- `canAccessMeeting()` — `lib/meetings/meetingAccess.ts`
- `POST /api/meetings/[id]/outcome` — `app/api/meetings/[id]/outcome/route.ts`
- `MeetingOutcomeModal` (outcome = `qualified_opportunity` → UI option exists) — `components/meetings/MeetingOutcomeModal.tsx`
- `Meeting` already carries `painPoints`, `nextStep`, `clientOwnerName/Email` — directly reusable as opportunity seed data.

Auth/access primitives the plan reuses (all exist in `lib/auth.ts`):
`requireAuth`, `requireManager`, `canAccessLead`, `getVisibleUserIds`, `getVisibleCampaignIds`, `getLeadWhereScope`, `SessionUser`.

Validation atoms (`lib/validation/core.ts`): `id`, `isoDate`, `shortText`, `longText`, `nullableShortText`, `nullableLongText`, `nullableText`, `parseBody`, `capLimit`. All exist.

`LeadStage` already has `won` / `lost` (`schema.prisma:21-28`) — won/lost opportunity → lead stage sync is possible with no schema change.

Zod is v4.4.3. Verified `z.ZodIssueCode.custom` still works — the impl doc's `handoffDecisionSchema` `.superRefine` compiles unchanged.

## 1. Required deviations from the source doc

These are mandatory; do not copy the doc verbatim.

1. **No interactive transactions.** `lib/prisma.ts` uses Neon HTTP driver (`DATABASE_URL`) which has no interactive `$transaction`. The doc's `createOpportunityFromQualifiedMeeting` uses `prisma.$transaction(async (tx) => …)` — **must be rewritten** to sequential awaited calls (exact same pattern as `bookMeeting`/`logMeetingOutcome` in `lib/meetings/meetingLifecycle.ts`). Keep the pre-existing-opportunity check before create; log the `OpportunityActivity` and lead `Activity` *after* the create succeeds.
2. **Meeting model exists** — the doc left the `meetingId` relation commented out. Enable it: `meetingId String? @unique` on `Opportunity` + `opportunity Opportunity?` back-relation on `Meeting`. Add `@@index([meetingId])`.
3. **Tenant injection is automatic** — `MODELS_WITH_TENANT` is derived from Prisma DMMF (`lib/prisma.ts:18-23`), so new models get tenant auto-injection for free after `prisma generate`. Still pass explicit `tenantId` in service writes (consistent with `meetingLifecycle.ts`).
4. **`Decimal` value serializes as a string** over JSON (`Prisma.Decimal`). Client components must `Number(opp.value)` / format explicitly.
5. **`supabase/rls.sql` is already stale** — its hardcoded table array is missing `Meeting`, `Contact`, `Account`, `InboundMessage`, etc. Best-effort: append `Opportunity`, `OpportunityActivity` to the array when editing. Not a blocker (DB_RLS_ENFORCED is off; app-layer is the isolation).
6. **Activity feed** — `ActivityType` enum has no opportunity-specific values. Reuse `stage_changed` / `note_added` for v1 (matches existing lead activity feed). New `OpportunityActivity` model carries the opportunity-specific audit trail; do **not** add ActivityType enum values in v1 (extra migration churn for no consumer).
7. **`getVisibleUserIds` import** in the doc's `access.ts` is unused — drop it.

## 2. Phases

### Phase 1 — Database (`prisma/schema.prisma`)

Files: `prisma/schema.prisma`, new migration, `supabase/rls.sql`.

1. Add enums near the existing enum block:
   `OpportunityStage`, `OpportunityStatus`, `HandoffStatus`, `OpportunitySource`, `LostReason`, `OpportunityActivityType` (copy exactly from doc §"Prisma schema patch").
2. Add `Opportunity` model (doc version) with these changes:
   - Uncomment the `meetingId` relation (see deviation 2): `meetingId String? @unique`, `meeting Meeting? @relation(fields: [meetingId], references: [id], onDelete: SetNull)`.
   - Keep all indexes from the doc (`@@index([meetingId])` added).
3. Add `OpportunityActivity` model (doc version, verbatim).
4. Add back-relations:
   - `User`: `ownedOpportunities`, `createdOpportunities`, `opportunityActivities`
   - `Client` / `Campaign` / `Lead` / `Account` / `Contact`: `opportunities Opportunity[]`
   - `Meeting`: `opportunity Opportunity?`
   - `Tenant`: `opportunities Opportunity[]`, `opportunityActivities OpportunityActivity[]`
5. Run `npx prisma migrate dev --name add_opportunity_pipeline` (or `db:push` for scratch envs). Run `npm run db:generate` so `MODELS_WITH_TENANT` picks up new models.
6. Append `'Opportunity', 'OpportunityActivity'` to `supabase/rls.sql` table array (idempotent; note it is already behind by several tables).

Done criteria: `prisma.studio` shows both models; `@prisma/client` types resolve `prisma.opportunity.*`.

### Phase 2 — Service layer (`lib/opportunities/`)

New files:

- `lib/opportunities/access.ts` — `canAccessOpportunity(viewer, opp)` + `canApproveClientHandoff(viewer)`. Use doc snippet, minus the unused `getVisibleUserIds` import. Extend the opp shape type to include `ownerId`, `createdById`, `campaignId`, `meetingId`, optional `lead {assignedToId, campaignId}`.
- `lib/opportunities/service.ts` — `createOpportunityFromQualifiedMeeting({...})`. Rewrite the doc function **without interactive transactions** (deviation 1):
  1. `prisma.lead.findUnique` (include campaign.client, account, contact, assignedTo).
  2. idempotency: `findFirst` where `tenantId + leadId + meetingId (if given) + status in {open, won}` → return existing.
  3. `prisma.opportunity.create` (seed fields from lead, exactly per doc; add `meetingId`; `ownerId: lead.assignedToId`).
  4. `prisma.opportunityActivity.create` (type `created`, metadata: leadId + meetingId).
  5. `prisma.activity.create` (type `stage_changed` on lead).
  6. Return the created opportunity (include client/campaign/owner/meeting).
  Also export `createManualOpportunity` for the POST /api/opportunities path (manager-gated).
- `lib/opportunities/lifecycle.ts` — stage + handoff transitions (single source of truth for the stage/handoff routes):
  - `moveStage({oppId, user, stage, note, value, probability, expectedCloseDate})`:
    - writes `OpportunityActivity` (type `stage_changed`) with from/to in metadata
    - stage `won` → `status='won'`, `closedAt=now()`, update lead `stage='won'`, activity type `closed_won`
    - stage `lost` → require `lostReason`, `status='lost'`, `closedAt=now()`, update lead `stage='lost'`, activity type `closed_lost`
  - `decideHandoff({oppId, user, decision, clientFeedback, lostReason, lostReasonDetails})`:
    - `accepted` → `handoffStatus='accepted'`, `stage='accepted_by_client'`, `status='open'`, activity `client_accepted`
    - `rejected` → `handoffStatus='rejected'`, `stage='lost'`, `status='rejected'`, `lostReason` (default `client_rejected`), `closedAt=now()`, lead `stage='lost'`, activity `client_rejected`
    - `needs_more_info` → `handoffStatus='needs_more_info'`, stage stays `pending_client_review`, create follow-up task for SDR/owner, activity type `note_added`
  - Each transition written as sequential awaits, never interactive txn.
- `lib/opportunities/metrics.ts` — pure helpers (unit-testable):
  - `buildSummary(opps)` → `{totalOpen, pendingClientReview, acceptedByClient, won, lost, totalPipelineValue, weightedPipelineValue}` (weighted = Σ value×probability; total = Σ value where open).
  - `acceptanceRate(accepted, submitted)`.
  - `ageInStage(opp, now)`.
- Validation additions in `lib/validation/schemas.ts` (doc §"Validation schemas", verbatim): `opportunityStage`, `opportunityStatus`, `handoffStatus`, `opportunitySource`, `lostReason`, `createOpportunitySchema`, `updateOpportunitySchema`, `updateOpportunityStageSchema`, `handoffDecisionSchema`.
- Extend `logMeetingOutcomeSchema` (doc §"Meeting Outcome Modal changes"): add `createOpportunity: z.boolean().optional()`, `opportunityValue: z.coerce.number().min(0).nullish().optional()`, `opportunityCurrency: z.string().min(3).max(3).optional()`, `opportunityClientOwnerName/Email`, `qualificationSummary: nullableLongText.optional()`. Mark `qualificationSummary` required in the modal only when `createOpportunity` is on (client-side), not in the schema (keeps non-opportunity outcomes simple).

Done criteria: unit tests green (Phase 6); service/lifecycle idempotent (double-submit the same qualified meeting → one opportunity).

### Phase 3 — API routes

New routes:

- `app/api/opportunities/route.ts`
  - `GET`: filters `clientId, campaignId, ownerId, stage, status, handoffStatus, from, until, search` + `limit` via `capLimit`. Scope query using `getVisibleUserIds` (ownerId/createdById in) **and** `getVisibleCampaignIds` (campaignId in) — director sees all. Return `{ opportunities, summary }` (summary from `metrics.ts`).
  - `POST`: manual create. Gate: `requireManager()` OR campaign `OpportunitySetting.allowSdrCreateManualOpportunity` (v1.1 — default deny). If `leadId` given, verify `canAccessLead`. Default `ownerId` = lead assignee.
- `app/api/opportunities/[id]/route.ts` — `GET` (with activities + relations) and `PUT` (`updateOpportunitySchema`). Notes/next-step editable by any allowed viewer; value/owner/stage/status/won-lost gated to manager roles via `canApproveClientHandoff`.
- `app/api/opportunities/[id]/stage/route.ts` — `POST`, `updateOpportunityStageSchema`, calls `moveStage`.
- `app/api/opportunities/[id]/handoff/route.ts` — `POST`, `handoffDecisionSchema`, `canApproveClientHandoff` guard, calls `decideHandoff`.
- `app/api/opportunities/[id]/activity/route.ts` — `GET` list activities; `POST` add note (type `note_added`).
- `app/api/meetings/[id]/convert-to-opportunity/route.ts` — `POST`, `canAccessMeeting` guard, calls `createOpportunityFromQualifiedMeeting` (manual re-trigger / recovery path for managers).

Modified route:

- `app/api/meetings/[id]/outcome/route.ts` — after `logMeetingOutcome` succeeds, if `body.outcome === 'qualified_opportunity'` (status completed) AND `body.createOpportunity !== false` → call `createOpportunityFromQualifiedMeeting` with meeting-derived fields; return `{ meeting, opportunity }`.

All routes: `handleApiError` wrapper, `requireAuth` first, pattern identical to `app/api/meetings/[id]/outcome/route.ts`.

Done criteria: curl/`next dev` smoke — qualified meeting outcome creates one opportunity; duplicate outcome log returns same opportunity id; rejected handoff without reason → 400; SDR manual create → 403.

### Phase 4 — Meeting outcome integration

Files: `components/meetings/MeetingOutcomeModal.tsx` only (route already extended in Phase 3).

- When `status === 'completed'` and outcome === `qualified_opportunity`: show "Create opportunity" section:
  - checkbox (default checked)
  - value (number), currency (default from campaign/client — read from a lightweight `GET /api/opportunities/options?campaignId=` or reuse booking-link settings; v1: text input default `USD`)
  - client owner name/email (optional)
  - qualification summary (required when checked)
  - next step (required when checked)
- Non-qualified / no-show / cancelled / rescheduled: no opportunity fields (unchanged behavior).
- Submit sends the new fields through the existing outcome payload.

### Phase 5 — UI

- `components/Sidebar.tsx` — add `{ name: 'Opportunities', href: '/opportunities', icon: Funnel }` (lucide `Funnel` or `HandCoins`). Doc order: `Leads, Meetings, Opportunities, Inbox, Sequences` → insert after `Meetings`, before `Inbox`.
- `app/opportunities/page.tsx` — client page mirroring `app/meetings/page.tsx` (KPI cards + filters + list + dynamic-imported panels). Tabs: `Board | Table | Client Review | Forecast`. **v1 scope: Table default + Board; Client Review = table pre-filtered to `pending_client_review`; Forecast = summary cards (pipeline value, weighted value).**
- `components/opportunities/`:
  - `OpportunityTable.tsx` — columns: Company, Contact, Client, Campaign, SDR, Value, Stage badge, Handoff status, Next step, Expected close, Age in stage. Row click → detail panel.
  - `OpportunityStageBadge.tsx` — color map per stage/status.
  - `OpportunityDetailPanel.tsx` — tabs Overview / Meeting Context / Handoff / Next Steps / Activity / Client Feedback. Manager-only actions: Accept / Reject / Needs More Info (client review), stage selector, edit value.
  - `OpportunityBoard.tsx` — kanban columns from doc §"Board columns" (v1.1 if time-box).
  - `CreateOpportunityModal.tsx` — manager manual create.
  - `ClientAcceptanceModal.tsx` + `LostReasonModal.tsx` — manager handoff decision + mandatory lost reason.
  - `OpportunityValueCard.tsx` — value + probability + weighted.
- Currency/value display: `Intl.NumberFormat` + `Number(opp.value)` (deviation 4).

### Phase 6 — Reporting + tests + verification

- `GET /api/opportunities` summary already exposes pipeline/weighted/acceptance numbers (Phase 3). Add `GET /api/opportunities/metrics?groupBy=sdr|client|campaign` for item 3 reporting readiness (acceptance rate by SDR, pipeline by client, top rejection reasons, aging no-next-step).
- Tests — `tests/opportunities.test.ts` (vitest, follows `tests/meetings.test.ts`):
  - service: qualified meeting → opportunity created once (idempotency), fields seeded, activity logged, no interactive txn used
  - lifecycle: won/lost → status/closedAt + lead stage sync; handoff accepted/rejected/needs_more_info
  - metrics: summary + weighted value + acceptance rate
  - validation: `handoffDecisionSchema` rejects without lostReason; `updateOpportunityStageSchema` bounds probability
- Verification commands:
  - `npm run db:generate`
  - `npx prisma migrate dev --name add_opportunity_pipeline`
  - `npm run lint`
  - `npm test`
  - `npm run build`

## 3. Acceptance criteria (from doc "Done criteria", mapped)

| # | Criterion | Where proven |
|---|---|---|
| 1 | Qualified completed meeting → creates opportunity | Phase 3 route + Phase 2 service |
| 2 | No-show/cancelled/not-qualified → no opportunity | Phase 3/4 gating |
| 3 | Opportunity linked tenant/client/campaign/lead/account/contact/owner | Phase 1 schema + service |
| 4 | Starts `pending_client_review` | Phase 2 service default |
| 5 | Manager marks accepted/rejected/needs-more-info | Phase 3 handoff route + Phase 5 UI |
| 6 | Rejection requires reason | zod `handoffDecisionSchema` |
| 7 | Accepted → active pipeline | Phase 2 lifecycle |
| 8 | Moves through sales stages | Phase 3 stage route |
| 9 | Won/lost updates lead stage | Phase 2 lifecycle |
| 10 | Activity history logged | `OpportunityActivity` + lifecycle |
| 11 | Board/table view | Phase 5 |
| 12 | Pipeline + weighted value visible | Phase 3 summary + Phase 5 KPIs |
| 13 | Acceptance rate available for item 3 | Phase 6 metrics endpoint |

## 4. Explicitly out of scope (v1)

- `OpportunitySetting` model (client/campaign pipeline config) — keep for v1.1 per doc recommendation. Hard-code defaults in `service.ts` (currency `USD`, probability `10`, requireClientAcceptance `true`).
- `import` source path (`OpportunitySource.import`) — enum value exists, no import flow built.
- Client-facing report pages (item 3) — this plan only exposes the metrics endpoints they consume.
- Notifications to manager/client-owner on opportunity creation — add via `lib/notifications` after core lands (small follow-up).

## 5. Risks / notes

- **No interactive transactions** = partial-write window on multi-step transitions (e.g. stage won updates opp then fails updating lead). Mitigate: order writes so the lead sync is last, wrap each in try/catch, log `OpportunityActivity` for the failed remainder. Acceptable for this system (matches existing meetingLifecycle behavior).
- `value` is `Decimal` → JSON string. All UI formatting must coerce.
- Working tree is fully untracked (`git status` shows `./`); commit only the intended files when landing each phase (no stray submodule/other-folder changes).
- Sidebar reorder affects existing nav order — confirm no test asserts nav order (grep `getByText('Inbox')` etc. in `tests/render.test.ts`).
- Do not bump `@prisma/client`/`prisma` versions — schema-only change.
