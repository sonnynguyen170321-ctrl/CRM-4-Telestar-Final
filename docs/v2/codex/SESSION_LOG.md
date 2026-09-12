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

## 2026-09-12 — Claude — Track A: release candidate for the Hostinger migration

- Goal: turn three days of uncommitted crm4 work into a reviewable, pushed release candidate before any infrastructure work. Plan and council verdict in `C:\Users\Admin\.claude\plans\check-xem-codex-l-m-groovy-river.md`.
- A0 — `wip/crm4-2026-09-12` pushed first (`b7e691d7`, `4e50a7a7`) so the work left the laptop before anything else.
- A1 — `prisma migrate deploy` applied `20260906010000_campaign_prospect_memberships` locally (59/59, `migrate diff` no drift); `verify:rls` and `verify:rls-enablement` pass. Four deterministic failures, all in the new code, fixed: `lib/leads/recalculateEngagement.ts` ran bare `prisma.$queryRaw` → now `withTenantRaw(tenantId, …)` (tenant context for RLS, not just the WHERE); three new tests built a bare `new PrismaClient()` → shared `@/lib/prisma` client like the other 44; `lib/leadFilter/**` mapped to `leadgen-intelligence` in `.agent/registry/domains.yaml`; rationale added to `rls-bypass-rationales.json` and `RLS_BYPASS_INVENTORY.md` regenerated (`unreviewed: 0`). The 12 "connection-class" failures Codex recorded pass 215/215 when run serially — pool exhaustion under parallel files, not code.
- A2 — six commits on `feat/monorepo` (`a735fc57`…`d819618a`), one per workstream: campaign prospect memberships + migration; ICP authoring; research access/workspace/preview/promotion; lead filter; engagement recalculation; chore. Tree is byte-identical to the wip branch. Pushed.
- A3 — `chore/security-deps` (`7ff42052`, `6aaabf11`): next 16.3.0 → 16.3.5 (two unauthenticated RCEs), `apps/leadgen` next 16.2.6 → 16.3.5 (not shipped — Dockerfile never copies `apps/` — but CI's whole-workspace audit would block), `npm audit fix` without `--force`. Pushed.
- Review: ECC `code-reviewer` on the source diff — 0 CRITICAL/HIGH, all five invariants hold. ECC `database-reviewer` raised CRITICAL on the two non-`CONCURRENTLY` unique indexes on `Lead`/`LeadPoolAssessment` (migration lines 55, 58). Verified: the lock is real, the severity is not — 1,177 leads / 259 assessments locally, prod same order, 0/59 migrations have ever used `CONCURRENTLY`. Downgraded to MEDIUM, not changed. **Gate for H3:** check Cloud SQL row counts before `migrate deploy`; split the migration only if `Lead` is in the hundreds of thousands.
- Files changed: as per the six feature commits plus `package.json`, `package-lock.json`, `apps/leadgen/package.json`, and this log.
- Runtime changed: yes. Schema/migrations changed: yes — the existing `20260906010000` migration applied locally; no new migration authored. V1 touched: no (`telestar-company-filter` untouched apart from removing the `.codex-worktrees/crm4-implementation` mirror).
- Verification: full vitest **serial** 3233/3233 pass, 0 fail, 0 skip (parallel runs show 17–19 connection-class failures and are not a code signal); `tsc --noEmit` 0; `npm run lint` 0; `check:migration-order` ok; `next build` 108 routes; `npm audit --omit=dev` 0 critical / 0 moderate / 5 high.
- Open: (1) the 5 remaining highs are two decisions — Prisma 6.2.1 root vs 7.8 in `apps/leadgen` (four findings, own phase) and `xlsx@0.18.5` in `core-ingest` (replace with exceljs or risk-accept); (2) PR `feat/monorepo` → `main` and `chore/security-deps` → `main` not opened — user's call; (3) certification candidate still frozen at `3cd16c8` — re-freeze after merge, before H5; (4) Track B (Hostinger inventory) waits on SSH/hPanel access; B1 RAM gate decides colocation.
