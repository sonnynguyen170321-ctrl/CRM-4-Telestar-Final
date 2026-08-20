# Telestar CRM — Master RLS Bypass & Raw Query Inventory

**Program**: Zero-Assumption Production Certification  
**Candidate SHA**: see `certification.config.json` — this document does not restate it.
> A second copy of the candidate SHA is a second thing to keep in step, and the previous one
> named `cf23182`, a candidate superseded twice over.  
**Requirement Ref**: `SEC-001`  
**Last Updated**: 2026-08-19T22:58:00+07:00  

---

## 1. Executive Summary

Telestar CRM enforces multi-tenant isolation through two defense-in-depth layers:
1. **Prisma Client Client-Side Tenant Scoping Extension (`lib/prisma.ts`)**: Injects `where: { tenantId }` into every read/write unless running within an explicit `tenantStorage.run({ tenantId: 'system', bypassRls: true })` context.
2. **Postgres Row Level Security (RLS)**: Enforces database-level isolation policies on Postgres tables.

This document provides a 100% comprehensive, line-by-line audit of every single location in application code, workers, and administrative scripts where RLS or tenant filtering is bypassed or handled via raw SQL.

---

## 2. Inventory by Category

### Category A: `tenantStorage.run({ bypassRls: true })` in Application & Worker Code

| File | Line(s) | Scope / Context | Architectural Rationale & Safety Justification | Safety Invariant |
|---|---|---|---|---|
| `lib/auth.ts` | 52, 73, 108 | `tenantId: 'system'` | Resolves API keys and authenticates user during NextAuth credential login before a session tenant is established. | Safe: Looks up by unique API key hash or email. Returns user identity to construct authenticated session. |
| `lib/bullmq/enqueue.ts` | 46 | `tenantId: tenantId` | Upserts `JobRun` record in BullMQ mirror. | Safe: Explicitly passes the payload's `tenantId` to store in `JobRun.tenantId`. |
| `lib/bullmq/ensureJob.ts` | 90, 120 | `tenantId: opts.tenantId` | Idempotent BullMQ job creation and lookup. | Safe: Scoped to the specific tenant ID associated with the job. |
| `lib/bullmq/workerUtils.ts` | 40 | `tenantId: tenantId` | Worker job runner execution wrapper. | Safe: Runs the worker handler within the exact tenant context declared on the job payload. |
| `lib/bullmq/rescheduleSequenceTask.ts` | 101 | `tenantId: input.tenantId` | Task scheduler rescheduling sequence execution. | Safe: Scoped to `input.tenantId`. |
| `lib/workflows/importInline.ts` | 37 | `tenantId: payload.tenantId` | Inline fallback parser when Redis is unavailable. | Safe: Scoped to `payload.tenantId`. |
| `app/api/cron/sequence-engine/route.ts` | 112, 213 | `tenantId: 'system'` | System cron scanning across all active tenant sequences for due steps. | Safe: Iterates tenants and processes each sequence within its respective tenant boundary. |
| `app/api/cron/maintenance/route.ts` | 66 | `tenantId: 'system'` | System cron triggering background maintenance jobs across tenants. | Safe: Cron endpoint protected by `CRON_SECRET` bearer token. |
| `app/api/cron/email-health/route.ts` | 32 | `tenantId: 'system'` | System cron computing email health scores across tenants. | Safe: Cron endpoint protected by `CRON_SECRET` bearer token. |
| `app/api/cron/inbox-sync/route.ts` | 21 | `tenantId: 'system'` | System cron triggering email inbox sync workers. | Safe: Cron endpoint protected by `CRON_SECRET` bearer token. |
| `app/api/unsubscribe/route.ts` | 20 | `tenantId: tenantId` | Public one-click unsubscribe endpoint with verified HMAC token. | Safe: Token cryptographically verifies `tenantId`, `email`, `leadId`. |
| `app/api/leads/recalculate-scores/route.ts` | 22 | `tenantId: tenantId` | Recomputes lead priority scores for user's tenant. | Safe: `tenantId` extracted directly from verified `SessionUser`. |

---

### Category B: Bare `new PrismaClient()` Instances

| File | Line | Purpose | Safety Invariant |
|---|---|---|---|
| `lib/client-reports/shareLinks.ts` | 33 | `publicShareDb`: Unauthenticated public client report viewer. | Safe: Looks up single row by unguessable cryptographic token `publicShareToken`, selects only `tenantId`, then uses tenant-scoped client for data. |
| `scripts/demo-seed.ts` | 28 | Standalone CLI demo seed script. | Safe: Explicitly writes to `tenantId: 'demo-telestar'`. Guarded by `lib/seed-guard.ts` in production. |
| `scripts/create-admin.ts` | 17 | Production admin bootstrapping CLI. | Safe: Interactive CLI utility executed by system operator. |
| `scripts/create-user.ts` | 17 | Production user creation CLI. | Safe: Interactive CLI utility executed by system operator. |
| `scripts/verify-rls.mjs` | 57, 179 | Test runner verifying RLS policies. | Safe: Verification script only. |

---

### Category C: Raw SQL Queries (`$queryRaw` / `$executeRaw`)

| File | Line | Query / Operation | Safety Invariant |
|---|---|---|---|
| `app/api/health/route.ts` | 23 | `SELECT 1` | DB liveness check. Zero tenant data accessed. |
| `app/api/admin/worker-health/route.ts` | 33 | `SELECT 1` | DB liveness check. Zero tenant data accessed. |
| `workers/healthcheck.ts` | 17 | `SELECT 1` | DB liveness check. Zero tenant data accessed. |
| `lib/db/migrationStatus.ts` | 67 | `SELECT migration_name FROM _prisma_migrations` | Schema migration check. Zero tenant data accessed. |
| `lib/search/accentSearch.ts` | 48 | Accent-insensitive unaccent search. | Parameterized with `tenantId` filter explicitly in WHERE clause. |
| `lib/leadgen/qualification.ts` | 376-398 | Window function aggregations for lead pool qualification. | Parameterized with `tenantId` filter explicitly in WHERE clause. |
| `workers/email.ts` | 89 | `UPDATE "EmailAccount" SET sentTodayCount = ... WHERE id = $1` | Atomic quota increment using raw SQL for CAS. |

---

## 3. Verification Conclusion
All instances of `bypassRls`, bare `PrismaClient`, and raw SQL queries are accounted for, justified by architecture, and strictly bounded to prevent cross-tenant data leakage.
