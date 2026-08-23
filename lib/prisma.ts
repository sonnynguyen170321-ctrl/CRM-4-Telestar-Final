import { PrismaClient, Prisma } from '@prisma/client';
import { cache } from 'react';
import { auditExtension } from './audit';
import { tenantStorage } from './tenant-context';
import { applyScopedTenant, applyBypassTenant } from './tenant-inject';
import {
  RELATION_SCOPED_OPS,
  buildRelationMap,
  forceTenantIdOnRelations,
  scrubForeignRelations,
  stripForcedFields,
} from './tenant-includes';
export { tenantStorage };

// Whether Postgres-level Row-Level Security is actually enforced on the target DB
// (i.e. `supabase/rls.sql` has been applied). When false (single-tenant / standard
// Postgres), the app-layer `tenantId` arg injection below is the isolation layer, and we
// SKIP the per-query `set_config` transaction — saving ~3 round-trips on every query.
const DB_RLS_ENFORCED = process.env.DB_RLS_ENFORCED === 'true';

// Models that actually carry a `tenantId` column. The root `Tenant` model does not, so we
// must never inject a `tenantId` filter/value for it. Derived from the DMMF so it stays in
// sync with the schema automatically.
const MODELS_WITH_TENANT: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId'))
    .map((m) => m.name)
);

// Relations pointing at tenant-owned models, per model. Derived from the DMMF so it tracks the
// schema automatically, exactly like MODELS_WITH_TENANT above.
const RELATION_MAP = buildRelationMap(Prisma.dmmf.datamodel.models as any);

const globalForPrisma = globalThis as unknown as { prisma: any };

// Resolve the tenant from the session ONCE per request. `cache()` memoizes within a
// single request, so a handler making N queries decodes the session once, not N times.
const getTenantIdFromSession = cache(async function getTenantIdFromSession(): Promise<string | null> {
  try {
    // Run the auth() call in a context where RLS is bypassed to prevent recursive DB calls
    return await tenantStorage.run({ tenantId: 'default-tenant', bypassRls: true }, async () => {
      const { auth } = await import('@/auth');
      const session = await auth();
      return (session?.user as any)?.tenantId || null;
    });
  } catch (err) {
    // Only a missing request context (e.g. cookies()/headers() outside a request) is
    // expected here. Anything else — a broken auth provider, a module-resolution failure,
    // a DB error — must surface: returning null here would silently widen into a
    // cross-tenant read via the local bypass path, which is never acceptable.
    const message = err instanceof Error ? err.message : String(err);
    if (!/headers|cookies|outside of a request|request scope|draft mode|next\/server|ERR_MODULE_NOT_FOUND|Cannot find module/i.test(message)) {
      throw err;
    }
    return null;
  }
});

function createPrismaClient() {
  // Standard persistent pooled Postgres connection (works with any Postgres — local, RDS,
  // Supabase). Prisma keeps the pool warm, so there is no per-request cold-start latency.
  // Workers prefer DIRECT_URL (an unpooled connection) for multi-step transactional work.
  const isWorker = process.env.IS_WORKER === 'true';
  // A worker is cross-tenant by nature: it resolves a JobRun before it knows the tenant, and
  // sweeps expired rows across all of them. Since `supabase/rls.sql` made the policies
  // role-targeted, `app.bypass_rls` grants the application role nothing, so a worker on the
  // ordinary DSN would read zero rows — silently. When a maintenance DSN is configured it
  // connects as that role instead, which is the one holding the cross-tenant policy.
  // Unset, this is exactly the previous behaviour.
  const connectionString = isWorker
    ? (process.env.CRM_MAINTENANCE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL)
    : process.env.DATABASE_URL;

  const log: Prisma.LogLevel[] = process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'];

  const client = new PrismaClient({
    ...(connectionString ? { datasources: { db: { url: connectionString } } } : {}),
    log,
  });

  return client.$extends(auditExtension).$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: { model?: string; operation: string; args: any; query: (args: any) => Promise<any> }) {
          if (!model) {
            return query(args);
          }

          const hasTenantField = MODELS_WITH_TENANT.has(model);

          // 1. Resolve tenant context
          const store = tenantStorage.getStore();
          let tenantId: string | null | undefined = store?.tenantId;
          let bypassRls = store?.bypassRls;

          if (!store) {
            tenantId = await getTenantIdFromSession();
          }

          const isLocalOrScript =
            process.env.NODE_ENV !== 'production' || process.env.BYPASS_RLS === 'true';

          if (!tenantId && isLocalOrScript) {
            bypassRls = true;
          }

          // 2. Bypass-RLS path (workers, seed, scripts, or local-no-session).
          if (bypassRls || !tenantId) {
            if (!tenantId && !isLocalOrScript) {
              // Secure by default: return empty/error in production if no context is found
              if (operation.startsWith('find') || operation.startsWith('get')) {
                return operation.endsWith('Many') ? [] : null;
              }
              throw new Error(`Unauthorized: No tenant context active for operation ${operation} on model ${model}`);
            }

            // Even when bypassing RLS *reads*, a known tenant must still be stamped onto
            // *writes* — the column is NOT NULL and has no DB default. We deliberately do
            // NOT add a tenantId WHERE-filter here, so cross-tenant reads (e.g. the worker's
            // JobRun lookup before the tenant is known) keep working.
            if (tenantId && hasTenantField) {
              applyBypassTenant(operation, args, tenantId);
            }

            // Without DB-level RLS there's nothing to bypass — run directly over HTTP.
            if (!DB_RLS_ENFORCED) {
              return query(args);
            }
            const [, result] = await client.$transaction([
              client.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`,
              query(args),
            ] as any);
            return result;
          }

          // 3. Scoped path — inject tenantId into WHERE (reads + targeted writes) and stamp
          //    it onto write payloads (the primary isolation layer when RLS is off).
          if (hasTenantField) {
            applyScopedTenant(operation, args, tenantId);
          }

          // 3b. Scope nested relations too. `applyScopedTenant` above only reaches the top-level
          // `where`; an `include` follows its foreign key wherever it points, so a row pointing
          // outside the tenant would otherwise disclose the foreign row's selected fields.
          // Reproduced twice before this existed: through `GET /api/booking-links` with a
          // session, and through `scripts/repro-nested-include-leak.ts` on this same path.
          const scopeRelations = RELATION_SCOPED_OPS.has(operation);
          const forced = scopeRelations
            ? forceTenantIdOnRelations(model, args, tenantId, RELATION_MAP)
            : [];
          const finish = (value: any) =>
            scopeRelations
              ? stripForcedFields(scrubForeignRelations(model, value, tenantId, RELATION_MAP), forced)
              : value;

          // 4. The app-layer tenantId injection above is the isolation layer. Only when
          // DB-level RLS is enforced do we also set the GUCs inside a transaction (the
          // secondary, defense-in-depth layer) — otherwise run a single HTTP query.
          if (!DB_RLS_ENFORCED) {
            return finish(await query(args));
          }
          const [, , result] = await client.$transaction([
            client.$executeRaw`SELECT set_config('app.bypass_rls', 'false', true)`,
            client.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
            query(args),
          ] as any);
          return finish(result);
        },
      },
    },
  });
}

// --- Type-level tenant loosening -------------------------------------------------------
// The extension above stamps `tenantId` onto every write, so callers must not be forced to
// pass it. We loosen ONLY `tenantId` on write-input payloads; every other field keeps full
// type-checking (this is not `as any`). Runtime correctness is guaranteed by the middleware.
type DistributiveTenantOptional<T> = T extends any
  ? 'tenantId' extends keyof T
    ? Omit<T, 'tenantId'> & { tenantId?: T['tenantId'] }
    : T
  : never;

type LooseWriteData<D> = D extends readonly (infer E)[]
  ? DistributiveTenantOptional<E>[]
  : DistributiveTenantOptional<D>;

type LooseWriteArgs<A> = A extends { data: infer D }
  ? Omit<A, 'data'> & { data: LooseWriteData<D> }
  : A extends { create: infer C; update: infer U }
    ? Omit<A, 'create' | 'update'> & { create: DistributiveTenantOptional<C>; update: DistributiveTenantOptional<U> }
    : A;

type WriteOp = 'create' | 'createMany' | 'createManyAndReturn' | 'update' | 'updateMany' | 'upsert';

type TenantOptionalDelegate<Delegate> = {
  [K in keyof Delegate]: K extends WriteOp
    ? Delegate[K] extends (args: infer A, ...rest: infer Rest) => infer R
      ? (args: LooseWriteArgs<A>, ...rest: Rest) => R
      : Delegate[K]
    : Delegate[K];
};

type TenantOptionalClient<C> = {
  [M in keyof C]: C[M] extends { create: (...a: any[]) => any } ? TenantOptionalDelegate<C[M]> : C[M];
};

// Reuse across hot-reloads in development to avoid exhausting connections.
const basePrisma = globalForPrisma.prisma ?? createPrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = basePrisma;

export const prisma = basePrisma as unknown as TenantOptionalClient<PrismaClient>;

/**
 * The client raw SQL must go through once PostgreSQL is enforcing RLS.
 *
 * The extension above is registered as `query.$allModels`. `$queryRaw` and `$executeRaw` are
 * **root client operations**, so they are outside it by construction: no `set_config` runs and
 * the statement reaches PostgreSQL with no tenant context at all. Under
 * `FORCE ROW LEVEL SECURITY` it then matches no policy and touches zero rows — silently, because
 * an empty result is not an error. Measured on 2026-08-23 by `npm run verify:rls-app-paths`:
 * the same client, holding the same tenant context, saw its row through `prisma.lead.count()`
 * and nothing at all through `$queryRaw ... FROM "Lead"`.
 *
 * These wrap **one statement at a time, deliberately.** Each raw statement is its own implicit
 * transaction today, so a one-statement explicit transaction preserves exactly the atomicity it
 * already has. Grouping several into one wrapper would be fewer round-trips and would quietly
 * move where a rollback lands — `checkAndReserveAiBudget` in particular compensates a failed
 * insert by hand precisely because the claim before it has already committed.
 *
 * They are also **not** a general replacement for raw SQL inside an existing interactive
 * transaction. A caller already holding a `tx` must set the GUC on that `tx` itself: opening a
 * second transaction from inside one takes a different connection, which for
 * `pg_advisory_xact_lock` would take the lock somewhere else and drop it immediately. That is
 * why `app/api/booking-links/route.ts` is left alone — its raw statements are lock acquisitions
 * on tables with no `tenantId`, so no policy applies to them anyway.
 *
 * When RLS is not enforced both call straight through, so the ordinary deployment pays nothing.
 */
export async function withTenantRaw<T>(
  tenantId: string,
  run: (db: PrismaClient) => Promise<T>
): Promise<T> {
  if (!DB_RLS_ENFORCED) return run(basePrisma as PrismaClient);
  return (basePrisma as PrismaClient).$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'false', true)`;
    await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
    return run(tx as unknown as PrismaClient);
  });
}

/**
 * The same, for raw SQL that is cross-tenant *by design*.
 *
 * Deliberately separate from `withTenantRaw` rather than a `tenantId === null` branch of it:
 * these are the statements that reach across every tenant — the reservation sweep, the
 * test-support truncations — and they should have to say so at the call site. A helper that
 * silently degraded to a bypass when a tenant id happened to be undefined would turn a missing
 * argument into a cross-tenant read.
 */
export async function withBypassRaw<T>(run: (db: PrismaClient) => Promise<T>): Promise<T> {
  if (!DB_RLS_ENFORCED) return run(basePrisma as PrismaClient);

  // Prefer the maintenance role. `rls.sql` grants the cross-tenant policy to it by name, and
  // grants the application role no policy that consults `app.bypass_rls` — so on a database
  // with role-targeted policies the GUC below is inert and this would quietly touch nothing.
  const maintenance = maintenanceClient();
  if (maintenance) return run(maintenance);

  return (basePrisma as PrismaClient).$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
    return run(tx as unknown as PrismaClient);
  });
}

/**
 * A connection as `crm_maintenance`, the role `supabase/rls.sql` grants the cross-tenant
 * policy to. Returns null when none is configured, which is every deployment that has not
 * enabled DB-level RLS — callers then keep their previous behaviour.
 *
 * Lazily created and cached: most processes never touch it, and one extra pool per process is
 * the cost of having it at all. Deliberately NOT the client `prisma` is built on — the whole
 * point is that ordinary request traffic cannot reach across tenants, so the privileged
 * connection has to be a separate object that a caller opts into by name.
 */
let cachedMaintenance: PrismaClient | null | undefined;
function maintenanceClient(): PrismaClient | null {
  if (cachedMaintenance !== undefined) return cachedMaintenance;
  const url = process.env.CRM_MAINTENANCE_URL;
  cachedMaintenance = url ? new PrismaClient({ datasources: { db: { url } } }) : null;
  return cachedMaintenance;
}

/**
 * Bootstrap helper for resolving the tenantId of a JobRun record.
 * Bypasses model-level tenant extension and queries JobRun directly
 * inside a raw transaction with app.bypass_rls=true.
 */
export async function resolveWorkerJobTenant(jobRunId: string): Promise<string | null> {
  // This runs before the tenant is known, so it is cross-tenant by definition. On a
  // role-targeted database the GUC grants the application role nothing; the maintenance
  // connection is what can actually see the row.
  const maintenance = maintenanceClient();
  if (maintenance) {
    const rows = await maintenance.$queryRaw<Array<{ tenantId: string }>>`
      SELECT "tenantId" FROM "JobRun" WHERE "id" = ${jobRunId} LIMIT 1
    `;
    return rows[0]?.tenantId ?? null;
  }

  return (basePrisma as PrismaClient).$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'true', true)`;
    const rows = await tx.$queryRaw<Array<{ tenantId: string }>>`
      SELECT "tenantId"
      FROM "JobRun"
      WHERE "id" = ${jobRunId}
      LIMIT 1
    `;
    return rows[0]?.tenantId ?? null;
  });
}
