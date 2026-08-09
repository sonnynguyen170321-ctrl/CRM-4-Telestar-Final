# Playwright Deep Audit — Inventory

Built from source on 2026-08-09 at `main` = `06d3f79`, audit branch `test/playwright-deep-audit`.
Everything here was read out of the code, not out of a README. Where a doc claim and the code
disagree, the code wins and the disagreement is recorded.

Repository: `sonnynguyen170321-ctrl/CRM-4-Telestar-Final`.

---

## 1. Pages — 31 routes

Enumerated from `app/**/page.tsx`.

| Route | File | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Task dashboard (Today / Yesterday / Overdue) |
| `/login` | `app/login/page.tsx` | Outside the proxy matcher |
| `/leads` | `app/leads/page.tsx` | Kanban + list on one route; lead detail is a slide-over, **no `/leads/[id]`** |
| `/meetings` | `app/meetings/page.tsx` | |
| `/opportunities` | `app/opportunities/page.tsx` | Kanban pipeline |
| `/sequences` | `app/sequences/page.tsx` | |
| `/sequences/performance` | `app/sequences/performance/page.tsx` | |
| `/templates` | `app/templates/page.tsx` | |
| `/inbox` | `app/inbox/page.tsx` | |
| `/email-health` | `app/email-health/page.tsx` | |
| `/automation` | `app/automation/page.tsx` | |
| `/team` | `app/team/page.tsx` | client-side role guard |
| `/director` | `app/director/page.tsx` | client-side role guard |
| `/settings` | `app/settings/page.tsx` | |
| `/leadgen` | `app/leadgen/page.tsx` | leadgen member workspace |
| `/leadgen-manager` | `app/leadgen-manager/page.tsx` | one route, **7 `?tab=` values** |
| `/client-reports` | `app/client-reports/page.tsx` | |
| `/client-reports/[id]` | `app/client-reports/[id]/page.tsx` | |
| `/client-reports/public/[token]` | `.../public/[token]/page.tsx` | **unauthenticated by design** — excluded from the proxy |
| `/admin` | `app/admin/page.tsx` | edge-gated |
| `/admin/users` | | edge-gated |
| `/admin/teams` | | edge-gated |
| `/admin/campaigns` | | edge-gated |
| `/admin/campaigns/[id]/members` | | edge-gated |
| `/admin/clients` | | edge-gated |
| `/admin/transfer-work` | | edge-gated |
| `/admin/audit` | | edge-gated |
| `/admin/jobs` | | edge-gated |
| `/admin/outbound` | | edge-gated |
| `/admin/imports` | | edge-gated |
| `/admin/worker-health` | | edge-gated |

`/leadgen-manager` tabs (`app/leadgen-manager/page.tsx:25-33`):
`overview · pool · qualify · routing · export · team · sources`.

---

## 2. API routes — 131 handlers

Full list is in [`API-ROUTES.md`](./API-ROUTES.md). Grouped summary and the guard each
one actually uses:

| Group | Count | Guard pattern |
|---|---|---|
| `/api/admin/*` | 12 | `requireRole('floor_manager')` **plus** the edge gate in `proxy.ts` |
| `/api/leads*`, `/api/tasks*`, `/api/notes*`, `/api/reminders*` | 15 | `requireAuth` + per-record `canAccessLead` / `canAccessUser` |
| `/api/leadgen*`, `/api/leadgen-pool/*` | 14 | `requirePoolUser` / `requirePoolManager` (`app/api/leadgen-pool/guard.ts`) |
| `/api/sequences/*` | 13 | `requireAuth`; bulk-action uses `requireRole` |
| `/api/email/*`, `/api/email-health/*` | 24 | `requireAuth` + in-handler role checks |
| `/api/meetings/*`, `/api/opportunities/*` | 11 | `requireAuth` + `canAccessOpportunity` / `canApproveClientHandoff` |
| `/api/client-reports/*` | 9 | `requireAuth`; `public/[token]` is unauthenticated |
| `/api/campaigns/*`, `/api/clients/*`, `/api/team/*` | 13 | mix of `requireRole` and `requireManager` |
| `/api/cron/*` | 4 | **outside the proxy** — `Bearer CRON_SECRET` or a manager session, re-checked per route |
| `/api/health`, `/api/csp-report` | 2 | **outside the proxy**, unauthenticated by design |
| `/api/ai/*`, `/api/dialer/config`, `/api/automation/*`, `/api/settings*`, `/api/users*`, `/api/activities`, `/api/notifications*`, `/api/booking-links*`, `/api/templates*`, `/api/seed` | rest | `requireAuth` (+ `requireRole` on `/api/seed`) |

**Gap found while inventorying, to verify in Batch 2:** `app/api/automation/accounts/[id]/cap/route.ts`
did not appear in the `requireAuth|requireRole|requireManager|getSessionUser` sweep across
`app/api`. Either it guards by another route, or it is unguarded. Treat as a candidate P0/P1
until proven otherwise.

---

## 3. Roles

Six roles, from `SessionUser['role']` in `lib/auth.ts:13`:

```
director · floor_manager · team_lead · sdr · leadgen_manager · leadgen
```

`requireRole` hierarchy (`lib/auth.ts:108`) — note the ordering, it is not the org chart:

```
sdr < leadgen < leadgen_manager < team_lead < floor_manager < director
```

So `requireRole('floor_manager')` admits floor managers and directors only, and
`requireRole('team_lead')` admits a `leadgen_manager`'s *superiors* but not the manager.

### Scoping rules, as implemented

| Function | Behaviour |
|---|---|
| `getVisibleUserIds` | director → `null` (unrestricted) · sdr → `[self]` · others → BFS down `managerId` |
| `buildRoleScope` | director/FM → `{}` · TL/leadgen/leadgen_manager → `{}` (scoping applied per query) · sdr → `{assignedToId: self}` |
| `getLeadWhereScope` | leadgen_manager → all leads · leadgen member → `campaignId in assigned` · TL/FM → **union** of pod users **and** their campaigns · sdr → own only |
| `canAccessLead` | user axis (only when `assignedToId` is set) OR account axis — account axis is **manager/leadgen only**, never widens an SDR |
| `canImportExport` | director, floor_manager, leadgen_manager, leadgen, sdr — **Team Lead deliberately excluded** |
| `canAccessPool` | director, floor_manager, leadgen_manager, leadgen |
| `requirePoolManager` | director, floor_manager, leadgen_manager |
| `canApproveClientHandoff` | director, floor_manager, team_lead — **an SDR cannot approve their own handoff** |
| `proxy.ts` `ADMIN_ROLES` | director, floor_manager only — everything under `/admin` and `/api/admin` |

### Session revalidation — the property most worth testing

`getSessionUser` (`lib/auth.ts:51`) re-reads the user row on **every protected request** and
returns `null` when the user is deleted, deactivated, tenant-moved, or when the token's
`authVersion` no longer matches the row. Authorization uses the **database** role, never the
token's. This is the mechanism behind §6 "Session invalidation" and Journey G, and it is
already pinned by `tests/session-revocation.test.ts`.

---

## 4. Background jobs — 5 queues, 17 job types

From `lib/bullmq/types.ts`. Queue routing is `jobQueue()` at `types.ts:173`.

| Queue | Job types |
|---|---|
| `sequence` | `sequence.enroll` · `advance` · `pause` · `unenroll` · `rebuild` · `execute-task` |
| `email` | `email.send` |
| `sync` | `email.sync` · `email.apply-reply` · `email.apply-bounce` · `reminder.due` · `digest.daily` |
| `import` | `import.parse` · `import.chunk` · `import.commit` |
| `maintenance` | `maintenance.healthcheck` · `maintenance.repair` |

Workers: `workers/{sequence,email,import,sync,notification,maintenance,healthcheck}.ts`,
registered in `workers/index.ts`.

Maintenance repair types (`MaintenanceRepairPayload`):
`orphan-tasks · stale-sending · outbound-reconcile · stuck-running · missing-delayed ·
reassignment-drift · audit-prune`.

### Which UI/API action creates which job

| Trigger | Job |
|---|---|
| `POST /api/sequences/[id]/enroll` | `sequence.enroll` |
| a sequence step reaching its due date | delayed `sequence.execute-task` (`lib/sequences/engine.ts`) |
| `POST /api/tasks/[id]/run-now` | immediate `sequence.execute-task`, `delay: 0` |
| `POST /api/email/send`, sequence send, inbox reply | `email.send` via `OutboundMessage` |
| `POST /api/leads/import` | `import.parse` → N × `import.chunk` → `import.commit`; **returns 202** |
| `GET /api/cron/inbox-sync` | `email.sync` → `email.apply-reply` / `email.apply-bounce` |
| `GET /api/cron/maintenance` | `maintenance.repair` |
| `npm run worker:healthcheck` | `maintenance.healthcheck` |

---

## 5. Data models — 41 Prisma models

```
Tenant · User · Client · Campaign · CampaignSdr · Account · Contact · Lead
Sequence · SequenceStep · SequenceEnrollment · Task · Template · AbTestVariant
Note · Reminder · Activity · Notification · AuditLog · JobRun · Attachment
EmailAccount · OutboundMessage · InboundMessage · SuppressionEntry
EmailHealthSnapshot · EmailDomainHealth · EmailHealthAlert
ImportBatch · ImportRow · BookingLink · Meeting · Opportunity · OpportunityActivity
ClientReport · ClientReportRecipient · ClientReportExport · ClientReportShareLink
LeadPoolItem · CampaignLeadRequirement · LeadgenActivity · AiMemory
```

All 41 carry `tenantId`; `supabase/rls.sql` derives its table list from the catalog.
**DB-level RLS is not enabled anywhere** (`DB_RLS_ENFORCED` unset) — the app-layer injection
in `lib/prisma.ts` / `lib/tenant-inject.ts` is the only isolation today. That makes §9
(tenant isolation) a test of application code, not of Postgres.

---

## 6. Existing Playwright coverage

| File | Size | What it actually asserts |
|---|---|---|
| `e2e/crm-journeys.spec.ts` | 10.7 KB | each of 6 personas reaches its permitted routes |
| `e2e/deep-smoke.spec.ts` | 10.6 KB | every permitted route renders for all 6 personas: no 5xx, no uncaught exception, no console error, no silent redirect; role gates; outbound-email safety guard |
| `e2e/user-flow-31step.spec.ts` | 16.5 KB | lead → meeting → opportunity → client report; rewritten under BUG-003 to poll the async import and assert real state |
| `e2e/qa/lane{A..G}.spec.ts` + `_helpers.ts` + `personas.ts` | ~190 KB | **explicitly labelled "throwaway QA scaffolding — not part of the committed e2e suite"** |

Config (`playwright.config.ts`): one `chromium` project, viewport **1280×800**, `workers: 1`,
`retries: 0`, `fullyParallel: false`, `trace: 'on-first-retry'` (so with 0 retries, **traces
are never captured**), no `storageState`, no auth setup project.

### Known-vacuous patterns already documented

`docs/post-migration/BUGS.md` BUG-003 records eight defects in the 31-step spec, including
`if (await x.isVisible())` wrappers that asserted nothing, fire-and-forget requests whose 404s
were invisible, and a green run over a meeting→opportunity chain that never executed. That is
the failure mode §48 asks us to hunt; assume more of it exists.

---

## 7. Coverage gaps against the audit brief

Nothing in the committed suite covers:

- per-role `storageState` (§3) — every spec logs in inline
- cross-user IDOR between two SDRs (§8)
- multi-tenant isolation (§9) — three tenants exist in the local DB and none is tested
- CSV import edge cases and re-import idempotency (§12)
- email idempotency / double-submit / retry dedup (§23, §46)
- suppression, bounce hard-vs-soft, email-health pause enforcement (§26–§28)
- reply processing run twice (§25)
- Run Now double-send guard (§20)
- BullMQ job completion — every current async assertion stops at the enqueue (§19)
- Redis recovery and delayed-job reconstruction (§38)
- maintenance repairs against controlled broken state (§39)
- report share-link token validity / revocation (§34)
- audit-log actor/entity/tenant verification (§36)
- desktop gate below 1024 px (§42)
- dialog accessibility and Escape/Tab behaviour (§41)
- pagination boundaries and filter combinations (§40)

---

## 8. Environment reality — what can and cannot be verified here

Checked on this machine, 2026-08-09.

| Dependency | State | Consequence |
|---|---|---|
| PostgreSQL 16 (`postgresql-x64-16`) | **running**, `telestar_crm` seeded | usable |
| Seeded roles | director 4 · floor_manager 4 · team_lead 11 · sdr 21 · leadgen 2 · leadgen_manager 13 | all six personas available |
| Tenants | **3** | §9 tenant isolation is testable locally |
| Leads / campaigns | 148 / 18 | enough for filters and pagination |
| Redis | **not running**, nothing on `:6379` | 🔴 §19, §37, §38, §39 cannot be genuinely verified |
| Docker | **not installed** | 🔴 §38 container-level failover, and the Docker gate in §55 |
| WSL | present, **no distribution installed** | Redis via WSL needs an install first |
| Playwright browsers | chromium, firefox, webkit installed | §4 secondary browsers are available |
| Dev server | not running | started per batch |
| `.env.local` | pins `SEQUENCE_AUTOSEND_ENABLED`, `EMAIL_SEND_DRY_RUN`, `EMAIL_HEALTH_AUTOPAUSE` | §1 safety values already in place — re-assert before each batch |

### The Redis blocker in one line

With Redis down, `POST /api/leads/import` falls back to the inline path
(`lib/workflows/importInline.ts`) instead of returning 202 and enqueueing — so an import test
would pass **without ever exercising the code path production uses**. Same class of problem as
BUG-003. §19 is unverifiable until Redis exists.

Three ways out, in order of preference:

1. **Memurai Developer** (Redis-compatible Windows service) — smallest change, gives a real
   `REDIS_URL` and lets `npm run worker:dev` run alongside `next dev`.
2. **WSL + `redis-server`** — `wsl --install -d Ubuntu`, then `apt install redis-server`.
3. **Test §19/§37–39 against the GCE box** (`http://34.142.236.46`), which does have Redis and
   a live worker — but see the credential warning below, and note the box's checkout is stale
   per `docs/DEPLOY.md` §8b.

### Credential constraint on the deployed box

§1 forbids reusing historically published demo passwords. `telestar2026` is published in this
repository and, per `docs/pre-domain-hardening/STATUS.md` item 2, **every non-Director account
on the live box still holds it**. The box is also plain HTTP. So if any batch runs against the
deployment it must use accounts created for the run with passwords supplied via
`E2E_PASSWORD`/env, never the seeded demo password, and must not run destructive batches
(import, transfer-work, deactivation, bulk operations) there.
