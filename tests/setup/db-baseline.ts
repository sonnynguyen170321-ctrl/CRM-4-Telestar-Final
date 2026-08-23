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
import { createAdminClient } from '@/lib/db/adminClient.mjs';

/** The tenant id `lib/prisma.ts` falls back to when no session is present. */
export const DEFAULT_TEST_TENANT_ID = 'default-tenant';

/**
 * Private tenants for the two suites that clear `JobRun` in `beforeEach`.
 *
 * Both used to run against `default-tenant`, so scoping their cleanup to a tenant did not
 * separate them from each other — they shared the one they were scoped to, and could still
 * delete rows the other had just written. Measured: with the scoping reverted, running the two
 * files concurrently produced `expected 'cmsu1jm8u…' to be 'cmsu1jm8s…'`, a JobRun whose identity
 * moved underneath the assertion.
 *
 * A tenant each makes the cleanup actually isolating. They are seeded here rather than in the
 * suites because this file is the one place that may create a tenant without racing: `createMany`
 * with `skipDuplicates` cannot collide, and nothing here deletes.
 */
export const BULLMQ_TEST_TENANT_ID = 'test-tenant-bullmq';
export const RUN_NOW_TEST_TENANT_ID = 'test-tenant-run-now';

// A bare client on purpose: the extended client in `lib/prisma.ts` resolves tenant context
// per query, and this has to run before any context exists.
const raw = createAdminClient();

try {
  await raw.tenant.createMany({
    data: [
      { id: DEFAULT_TEST_TENANT_ID, name: 'Default Test Tenant' },
      { id: BULLMQ_TEST_TENANT_ID, name: 'BullMQ Suite Tenant' },
      { id: RUN_NOW_TEST_TENANT_ID, name: 'Run-Now Suite Tenant' },
    ],
    skipDuplicates: true,
  });
} catch {
  // Gracefully continue so mocked/isolated unit suites execute. Suites requiring live DB will fail on their own queries.
} finally {
  await raw.$disconnect().catch(() => {});
}
