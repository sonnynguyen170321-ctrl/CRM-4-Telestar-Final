---
classification: CURRENT_CANONICAL
---

# Telestar CRM — tenant bypass and raw-SQL inventory

> **Generated** by `scripts/certification/render-rls-bypass-inventory.mjs` from the code it
> describes. Never hand-edited: the previous hand-maintained version called itself a "100%
> comprehensive, line-by-line audit" while omitting sixteen files, two of which carried
> TEL-P0-013 — a cross-tenant read through exactly the mechanism this document tracks.
>
> Completeness comes from the scan. The reason each site is safe comes from
> `rls-bypass-rationales.json`, which a human writes. A site with no rationale renders as
> **UNREVIEWED** and turns this generator red.

## What actually enforces tenant isolation

**One layer, not two.** Tenant isolation is enforced by the Prisma client extension in
`lib/prisma.ts`, which injects `where: { tenantId }` into model operations and stamps
`tenantId` onto writes.

Database-level row-level security is **built and proven but not applied**: `supabase/rls.sql`
and `supabase/roles.sql` exist, `scripts/verify-rls*.mjs` show the policies isolating tenants
and every application path surviving them, and `lib/prisma.ts` already sets
`app.current_tenant_id` per transaction. No deploy path applies them, `DB_RLS_ENFORCED` is set
in no environment or compose file, and the production database carries no policies. That is
TEL-P1-038, and it is open.

Any statement that this system enforces isolation at the database layer today is wrong.

---

## Category A — Deliberate tenant-scoping bypass (`bypassRls: true`)

The Prisma extension in `lib/prisma.ts` injects `where: { tenantId }` into every model operation. Inside one of these scopes it does not, so the query is only as tenant-correct as it was written to be. On a database with no RLS policies this is the entire boundary.

**16 file(s), 20 site(s).**

| File | Line(s) | Why this is safe |
|---|---|---|
| `app/api/ai/attention/route.ts` | 21 | Session tenant from `requireAuth`. The scope wraps `getWhatNeedsAttention`, which filters every query in `lib/ai/engine/attention-engine.ts` by `tenantId` explicitly — overdue leads, unassigned leads and paused mailboxes all carry it. |
| `app/api/ai/daily-briefing/route.ts` | 44 | Session tenant from `requireAuth`. All three reads inside the scope — `task.findMany`, `lead.findMany`, `activity.findMany` — name `tenantId` in their `where` explicitly. |
| `app/api/ai/nba/route.ts` | 28 | Session tenant from `requireAuth`. The scope wraps `calculateNextBestAction`, which reads `lead.findFirst({ where: { id: leadId, tenantId } })` — the id is paired with the tenant, so a foreign id resolves to nothing. |
| `app/api/cron/email-health/route.ts` | 32 | System context (`tenantId: 'system'`), and deliberately cross-tenant: the job computes email health across every tenant. Reachable only with the `CRON_SECRET` bearer token, never from a user session. |
| `app/api/cron/inbox-sync/route.ts` | 21 | System context, deliberately cross-tenant: it sweeps active mailboxes across tenants to enqueue per-account sync jobs. `CRON_SECRET` bearer token only. |
| `app/api/cron/maintenance/route.ts` | 66 | System context, deliberately cross-tenant: it iterates tenants to schedule per-tenant maintenance. `CRON_SECRET` bearer token only. |
| `app/api/cron/sequence-engine/route.ts` | 112, 213 | System context, deliberately cross-tenant: it scans due sequence steps for every tenant and processes each within its own tenant boundary. Task claims use a conditional `updateMany` on `id + status + lockedAt`, so two runners cannot both take a task. `CRON_SECRET` bearer token only. |
| `app/api/leads/recalculate-scores/route.ts` | 22 | Session tenant from the verified `SessionUser`. The `lead.update` calls inside the scope address ids drawn from a preceding tenant-scoped read, so no caller-supplied id reaches the database. |
| `app/api/unsubscribe/route.ts` | 20 | Public by necessity — an unsubscribe link is followed without a session. The tenant is not taken from the request but recovered from an HMAC-verified token that binds `tenantId`, `email` and `leadId`; a forged or edited token fails verification before any query runs. |
| `lib/auth.ts` | 51, 75, 112 | Runs before a tenant is known, which is the reason the bypass exists. API keys are resolved by unique `keyHash` and users by the id inside an already-verified token; both are identity lookups whose whole purpose is to establish the tenant that later queries are scoped by. |
| `lib/bullmq/enqueue.ts` | 46 | Scoped to the payload's own `tenantId`, not to 'system'. The bypass exists so the `JobRun` mirror row can be written with the tenant stamped on it. |
| `lib/bullmq/ensureJob.ts` | 90, 120 | Idempotent job creation. The `jobRun.findUnique({ where: { dedupeKey } })` lookup runs before the tenant is known — a dedupe key is global by construction, because its job is to notice a duplicate whoever enqueued it. The row it finds carries its own `tenantId`, which scopes everything after. |
| `lib/bullmq/rescheduleSequenceTask.ts` | 101 | Scoped to `input.tenantId`. The `jobRun` lookup by `dedupeKey` is the same pre-tenant identity lookup as `ensureJob`. |
| `lib/bullmq/workerUtils.ts` | 40 | Scoped to the tenant declared on the job payload. `jobRun.update` calls address the row by its own id, obtained from the job being executed. |
| `lib/prisma.ts` | 49 | The extension itself — this is the file that implements tenant scoping, so it necessarily names the flag it honours and runs the `set_config` statements that carry tenant context into the database. Its own `$queryRaw`/`$executeRaw` calls are the GUC statements and the maintenance sweep, not data access. |
| `lib/workflows/importInline.ts` | 37 | Scoped to `payload.tenantId`. The inline fallback runs when Redis is unavailable; its `importRow.count` calls are filtered by `batchId`, which belongs to the batch being imported. |

---

## Category B — Clients built outside the extension

A `PrismaClient` constructed directly carries no tenant extension at all. Everything it reads and writes is unscoped by construction.

**3 file(s), 8 site(s).**

| File | Line(s) | Why this is safe |
|---|---|---|
| `lib/client-reports/shareLinks.ts` | 34, 35 | A public share link is followed without a session, so the tenant cannot come from one. It is recovered by looking up an unguessable 32-byte token by hash, reading only `tenantId` off the row, and scoping every subsequent read to it. `createShareLink` derives a tenant from the report only when its caller omits one; the sole caller passes `user.tenantId` from a verified session, and that route has no bypass scope of its own. |
| `lib/db/adminClient.mjs` | 148, 155, 161, 171 | A deliberately unextended client for operator and test tooling that must reach across tenants — seeding, integrity checks, fixtures. Not imported by any request-path module. |
| `lib/prisma.ts` | 84, 298 | The extension itself — this is the file that implements tenant scoping, so it necessarily names the flag it honours and runs the `set_config` statements that carry tenant context into the database. Its own `$queryRaw`/`$executeRaw` calls are the GUC statements and the maintenance sweep, not data access. |

---

## Category C — Raw SQL (`$queryRaw` / `$executeRaw`)

Raw SQL is a ROOT client operation. The extension is registered as `query.$allModels` and cannot observe it, so no tenant filter is applied and no GUC is set unless the call goes through `withTenantRaw` or `withBypassRaw`.

**13 file(s), 41 site(s).**

| File | Line(s) | Why this is safe |
|---|---|---|
| `app/api/admin/worker-health/route.ts` | 33 | `SELECT 1` liveness probe. Touches no tenant-owned table. |
| `app/api/booking-links/[id]/route.ts` | 118 | Same advisory lock as the collection route, for the same read-decide-write on the default flag. |
| `app/api/booking-links/route.ts` | 136 | Raw SQL is a transaction-scoped advisory lock, taken so that clearing the previous default and setting the new one cannot interleave with a concurrent request. It reads no rows. |
| `app/api/health/route.ts` | 23 | `SELECT 1` liveness probe. Touches no tenant-owned table, and the file says so in a comment for the same reason it appears here. |
| `lib/ai/budget.ts` | 121, 146, 212, 226, 278, 283, 302, 312, 347, 354, 372, 381, 400, 403, 408, 409 | Every statement goes through `withTenantRaw`, which sets `app.current_tenant_id` on the connection the statement runs on, except the sweep of expired reservations and the test-only truncations, which are `withBypassRaw` and cross-tenant on purpose — an expiry sweep cannot name one tenant. |
| `lib/client-reports/shareLinks.ts` | 82 | A public share link is followed without a session, so the tenant cannot come from one. It is recovered by looking up an unguessable 32-byte token by hash, reading only `tenantId` off the row, and scoping every subsequent read to it. `createShareLink` derives a tenant from the report only when its caller omits one; the sole caller passes `user.tenantId` from a verified session, and that route has no bypass scope of its own. |
| `lib/db/migrationStatus.ts` | 67 | Reads `_prisma_migrations`, a schema table with no tenant column and no tenant data. |
| `lib/leadgen/qualification.ts` | 384, 390, 397, 406 | Window-function aggregations for pool qualification, all routed through `withTenantRaw` and additionally naming `tenantId` in the WHERE clause. |
| `lib/prisma.ts` | 138, 171, 172, 254, 255, 279, 313, 320, 321 | The extension itself — this is the file that implements tenant scoping, so it necessarily names the flag it honours and runs the `set_config` statements that carry tenant context into the database. Its own `$queryRaw`/`$executeRaw` calls are the GUC statements and the maintenance sweep, not data access. |
| `lib/research/cache.ts` | 175, 410 | Cache updates through `withTenantRaw`, so the statement carries tenant context on its own connection. |
| `lib/search/accentSearch.ts` | 83, 84 | Accent-insensitive search through `withTenantRaw`, with `tenantId` also named explicitly in the WHERE clause. |
| `workers/email.ts` | 82 | An atomic compare-and-set on `EmailAccount.sentTodayCount`, routed through `withTenantRaw` and addressing a single row by id. Raw SQL rather than a read-modify-write so two workers cannot both spend the last send of a quota. |
| `workers/healthcheck.ts` | 17 | `SELECT 1` liveness probe. Touches no tenant-owned table. |

---

## Totals

| | Count |
|---|---|
| Category A sites | 20 |
| Category B sites | 8 |
| Category C sites | 41 |
| All sites | 69 |
| Unreviewed | 0 |

