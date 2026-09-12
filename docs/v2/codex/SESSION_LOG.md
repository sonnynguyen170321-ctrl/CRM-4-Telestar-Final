# Codex session log

## 2026-09-10 ? Phase 5: Manager Lead Filter

- Scope: manager-only Lead Filter page, tenant/campaign-scoped read API, persisted score explanation presenter, navigation, and focused tests.
- Invariants: #2 CampaignProspect is the campaign-specific unit; #3 engagement stays separate from ICP qualification; #5 tenant and visible-campaign scope are server-derived; #7 no placeholder assessments; #12 Phase 5 only; #13 focused automated checks added; #15 no commit, deploy, migration, or next phase.
- Files changed: `.agent/generated/route-map.json`, `app/api/lead-filter/route.ts`, `app/lead-filter/page.tsx`, `components/lead-filter/LeadFilterWorkspace.tsx`, `components/Sidebar.tsx`, `lib/leadFilter/classification.ts`, `lib/leadFilter/readModel.ts`, `packages/core-scoring/src/scoreExplanation.ts`, `tests/lead-filter-phase-5.test.ts`, `tests/research-phase-2-access.test.ts`, and this log.
- Runtime changed: yes ? new read-only manager surface and API.
- Schema/migrations changed: no.
- V1 touched: no.
- Verification: focused tests 14/14; `npx tsc --noEmit`; lint; production build; project-truth check all passed.
- Full suite: 219/237 files and 3145/3233 tests passed. Existing environment/baseline failures remain: unapplied CampaignProspect migration/RLS policy, database connection exhaustion, RLS inventory drift from earlier work, and Windows rollback-script assertions. No Phase 5 focused failure.
- Open: apply the already-created CampaignProspect migration in an approved deployment session before live data validation. Browser validation with real manager data follows only after that database gate.

## 2026-09-12 ? Open Research to SDR

- User journey: as an SDR, I can open Research, create/run research within the contributor cap, inspect candidates, and promote selected candidates into a campaign visible to me.
- Scope: access policy, SDR navigation, and access regression tests only.
- Authorization: SDR gains `read`, `run`, and `promote`; `manage` remains Director/Floor Manager/Leadgen Manager only. API keys still require `research:read`/`research:write` scopes.
- Spend boundary: SDR remains capped at 100 queries per run, enforced by the server route; a direct request for 1000 returns HTTP 400.
- RED: `npm test -- tests/research-phase-2-access.test.ts` ? 3 intended failures for SDR policy, SDR API-key permission, and missing navigation wiring.
- GREEN: `npm test -- tests/research-phase-2-access.test.ts tests/research-phase-3-workspace.test.ts tests/research-phase-4-promotion.test.ts` ? 23/23 passed.
- Files changed: `lib/research/access.ts`, `components/Sidebar.tsx`, `tests/research-phase-2-access.test.ts`, and this log.
- Runtime changed: yes. Schema/migrations changed: no. V1 touched: no.
- Invariants: #5 tenant/campaign visibility remains server-scoped; #12 one authorization change-kind; #13 access tests updated; #15 no commit/deploy/next phase.
- Open: live browser validation still waits for the existing CampaignProspect migration/RLS deployment gate.
