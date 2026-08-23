import { onTestFinished } from 'vitest';
import { prisma } from '@/lib/prisma';

/**
 * Create a tenant for one test, and delete it when that test finishes.
 *
 * Eleven suites minted a tenant per test case — `beforeEach` with a fresh `randomUUID()` — and
 * never removed it. Measured on the development database on 2026-08-23: **74,974 tenants and
 * 430,835 leads**, accumulating since 2026-08-12, **14,041 of them in the preceding 24 hours**.
 * Telestar is one BPO with one tenant; none of that is real data.
 *
 * It is not a tidiness problem. Org-wide aggregates scan all of it, so the admin overview tests
 * began timing out at their 20-second budget — three failures in a full run that passed 33/33
 * once the budget was raised, which is the signature of a dataset problem rather than a code
 * one. It compounds: every run leaves more behind than the last, so the threshold only moves in
 * one direction, and it degrades every developer sharing the database.
 *
 * `onTestFinished` rather than an `afterEach` block, deliberately. The cleanup registers itself
 * from inside the same hook that does the creating, so there is one line to change per call
 * site and no way for the registration to end up in the wrong `describe` scope — which is the
 * mistake that a mechanical edit across eleven files with different nesting would invite. It
 * also runs per test, matching how the tenants are created.
 *
 * `deleteMany` rather than `delete`: a test that removes its own tenant should not then fail
 * teardown with a missing-record error. The delete cascades to every tenant-owned row, which
 * was verified against the real schema rather than assumed.
 */
export async function createTestTenant(id: string, name: string): Promise<string> {
  await prisma.tenant.create({ data: { id, name } });
  onTestFinished(async () => {
    await prisma.tenant.deleteMany({ where: { id } });
  });
  return id;
}
