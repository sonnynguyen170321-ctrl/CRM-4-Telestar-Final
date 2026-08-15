/**
 * Reproduction for the nested-`include` cross-tenant disclosure.
 *
 * Run it before changing anything; it should print `leaked = true`. A correct fix makes it print
 * `leaked = false` without any route being involved — this reads through the Prisma client
 * directly, so only the isolation layer in `lib/prisma.ts` is under test.
 *
 *   DATABASE_URL=postgresql://…/some_test_db npx tsx scripts/repro-nested-include-leak.ts
 *
 * Why this script exists rather than a test: an attempt at the systemic fix compiled, passed
 * `tsc --noEmit`, and passed all 1,662 Vitest tests **while having no effect at all**. The suite
 * could not detect it, because no test in the repository reads a relation that points outside the
 * caller's tenant. A fix for this defect has to be driven by a measurement that fails first.
 *
 * The defect: `applyScopedTenant` injects `tenantId` into the **top-level** `where`. A relation
 * reached through that row by `include`/`select` is not scoped — the include follows the foreign
 * key wherever it points. Any row whose FK crosses a tenant boundary therefore discloses the
 * selected fields of the foreign row. 30 route files include a tenant-owned relation; two are
 * guarded by hand (`app/api/booking-links/route.ts`, `app/api/booking-links/[id]/route.ts`), and
 * the rest rely on no such row existing.
 *
 * Note for anyone implementing the fix: Prisma accepts a `where` on a **to-many** include and does
 * not on a **to-one** include, so a to-one relation can only be filtered after the query returns —
 * which means `tenantId` has to be present in the selection to be checkable.
 *
 * Writes only into two throwaway tenants and deletes them again. Refuses to run against a database
 * whose name does not look disposable, on the same principle as `lib/seed-guard.ts`.
 */
import { prisma, tenantStorage } from '@/lib/prisma';

const TENANT_A = 'repro-nested-a';
const TENANT_B = 'repro-nested-b';
const CLIENT_B = 'repro-nested-client-b';
const LINK_A = 'repro-nested-link-a';
const CANARY = 'TENANT-B-CLIENT-NAME-THAT-MUST-NOT-CROSS';

const asTenant = <R>(tenantId: string, fn: () => Promise<R>) =>
  tenantStorage.run({ tenantId, bypassRls: true }, fn);

function assertDisposableDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/dev|development|test|local/i.test(name)) {
    throw new Error(
      `Refusing to run against "${name}": the name does not contain dev, development, test or ` +
        'local. This script writes rows. Point it at a scratch database.'
    );
  }
}

async function main(): Promise<void> {
  assertDisposableDatabase();

  for (const tenantId of [TENANT_A, TENANT_B]) {
    await asTenant(tenantId, async () => {
      await prisma.tenant.upsert({
        where: { id: tenantId },
        create: { id: tenantId, name: tenantId },
        update: {},
      });
    });
  }

  await asTenant(TENANT_B, async () => {
    await prisma.client.upsert({
      where: { id: CLIENT_B },
      create: {
        id: CLIENT_B,
        name: CANARY,
        industry: 'repro',
        contactName: 'repro',
        contactEmail: 'repro@example.test',
        tenantId: TENANT_B,
      },
      update: { name: CANARY },
    });
  });

  // The poisoned row: owned by tenant A, pointing at tenant B. Written directly, because this is
  // what a row created before the reference checks existed looks like.
  await asTenant(TENANT_A, async () => {
    await prisma.bookingLink.upsert({
      where: { id: LINK_A },
      create: {
        id: LINK_A,
        clientId: CLIENT_B,
        name: 'poisoned',
        url: 'https://example.test/poisoned',
        tenantId: TENANT_A,
        isActive: true,
      },
      update: { clientId: CLIENT_B },
    });
  });

  // Read the way a request does: tenant known, RLS **not** bypassed — the scoped path.
  const rows = await tenantStorage.run({ tenantId: TENANT_A }, () =>
    prisma.bookingLink.findMany({
      where: { id: LINK_A },
      include: { client: { select: { id: true, name: true } } },
    })
  );

  const serialised = JSON.stringify(rows);
  const leaked = serialised.includes(CANARY);

  console.log('--- nested-include cross-tenant disclosure ---');
  console.log('reader tenant   :', TENANT_A);
  console.log('relation owner  :', TENANT_B);
  console.log('client returned :', JSON.stringify((rows[0] as { client?: unknown } | undefined)?.client));
  console.log('leaked          :', leaked);
  console.log(
    leaked
      ? 'RESULT: the foreign relation crossed the tenant boundary. This is the defect.'
      : 'RESULT: the foreign relation was withheld.'
  );

  await asTenant(TENANT_A, async () => {
    await prisma.bookingLink.deleteMany({ where: { tenantId: TENANT_A } });
  });
  await asTenant(TENANT_B, async () => {
    await prisma.client.deleteMany({ where: { tenantId: TENANT_B } });
  });
  for (const tenantId of [TENANT_B, TENANT_A]) {
    await asTenant(tenantId, async () => {
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
    });
  }
  console.log('cleanup         : throwaway tenants deleted');

  process.exit(leaked ? 2 : 0);
}

main().catch((err) => {
  console.error('repro failed to run:', err instanceof Error ? err.message : err);
  process.exit(1);
});
