/**
 * Tenant context for scripts, because without it a script on production reads nothing — and
 * says so as if it were an answer.
 *
 * `lib/prisma.ts` is secure by default: with no tenant context and `NODE_ENV=production`, a
 * `findMany` returns `[]` and a `findFirst` returns `null` rather than raising. That is the
 * right behaviour for a request that lost its session. For a script it is the worst possible
 * behaviour, because the script reports what it read, and what it read is nothing.
 *
 * Observed on production 2026-09-24: `npm run backfill:next-action` printed
 *
 *     Total Evaluated:    0
 *     Repairs Candidate:  0
 *     Done.
 *
 * while 278 enrollments sat with a null `nextActionAt`. The repair tool reported success having
 * never seen a row. The same silence was waiting in `production-readiness-audit`,
 * `reconcile-production-db` and `verify-import-worker` — the tools whose whole job is to tell
 * us whether production is healthy.
 *
 * So every script that reads through the Prisma model API uses one of these two helpers, and
 * `tests/script-tenant-context.test.ts` fails the build if a new one does not.
 */
import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';

/**
 * Run `fn` once per tenant, inside that tenant's context.
 *
 * The default for anything that reads or repairs tenant-owned data. `bypassRls` is on because a
 * script runs as an operator with no session, which is the case that flag exists for; the
 * tenant is still named, so reads and writes stay scoped to it.
 */
export async function forEachTenant<R>(
  fn: (tenant: { id: string; name: string }) => Promise<R>
): Promise<R[]> {
  const tenants = await tenantStorage.run({ tenantId: 'system', bypassRls: true }, () =>
    prisma.tenant.findMany({ select: { id: true, name: true } })
  );

  const results: R[] = [];
  for (const tenant of tenants) {
    results.push(await tenantStorage.run({ tenantId: tenant.id, bypassRls: true }, () => fn(tenant)));
  }
  return results;
}

/**
 * Run `fn` with cross-tenant reads allowed.
 *
 * For the few scripts that genuinely need to see every tenant's rows at once — a migration
 * audit, a queue reconciliation. Prefer `forEachTenant`: a per-tenant loop makes it obvious in
 * the output which tenant a number belongs to, and keeps a script from quietly reporting one
 * tenant's problem against another's name.
 */
export function asOperator<R>(fn: () => Promise<R>): Promise<R> {
  return tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);
}
