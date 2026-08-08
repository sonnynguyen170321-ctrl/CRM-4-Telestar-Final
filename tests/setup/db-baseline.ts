/**
 * Guarantee the one row the database-backed suites cannot create for themselves.
 *
 * Almost every model has a NOT NULL `tenantId` with a foreign key to `Tenant`, and the
 * Prisma extension in `lib/prisma.ts` stamps `default-tenant` onto writes made under that
 * context. So a suite that enqueues a job or writes any tenant-scoped row needs that
 * tenant to already exist — and no suite created it. They were inheriting it from whatever
 * a developer had last seeded, which is why `tests/bullmq.test.ts` and
 * `tests/run-now-immediate.test.ts` passed on a workstation and failed on CI's fresh
 * database with `Foreign key constraint violated: JobRun_tenantId_fkey`.
 *
 * Runs once per test file (vitest `setupFiles`). Idempotent, so parallel files racing it
 * is fine: `createMany` + `skipDuplicates` cannot collide, and it never deletes anything —
 * several suites call `deleteMany()` in `beforeEach` against a shared database, and a
 * setup file that dropped the tenant would take the other files down with it.
 */
import { PrismaClient } from '@prisma/client';

/** The tenant id `lib/prisma.ts` falls back to when no session is present. */
export const DEFAULT_TEST_TENANT_ID = 'default-tenant';

// A bare client on purpose: the extended client in `lib/prisma.ts` resolves tenant context
// per query, and this has to run before any context exists.
const raw = new PrismaClient();

await raw.tenant.createMany({
  data: [{ id: DEFAULT_TEST_TENANT_ID, name: 'Default Test Tenant' }],
  skipDuplicates: true,
});

await raw.$disconnect();
