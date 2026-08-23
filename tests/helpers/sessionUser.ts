/**
 * Give a mocked session a real `User` row to revalidate against.
 *
 * Task 2 made every protected request re-check the session against the database: the user
 * must exist, be active, be in the token's tenant, and carry a matching `authVersion`. That
 * is the point — a deactivated or demoted user loses access immediately instead of when
 * their token happens to expire.
 *
 * It also broke 25 route tests, and the breakage was the feature working. Those tests mock
 * `auth()` to return a synthetic session for `sdr-1`, `fm-1` and friends, but no such row
 * exists, so the request is now rejected as unauthenticated (401) before it ever reaches
 * the role check they assert on (403).
 *
 * Mocking `getSessionUser` instead is not available: it is a module-local `const` inside
 * `lib/auth.ts`, and `requireAuth`/`requireRole` call that local binding, so replacing the
 * export does not intercept them. Reshaping production code to add a test seam would be
 * the tail wagging the dog.
 *
 * So the fixtures get real rows. The tests stay integration tests of the real authorization
 * path, and they now exercise revalidation as well as the role matrix — which is strictly
 * more coverage than they had before.
 */

import { createAdminClient } from '@/lib/db/adminClient.mjs';

/** The subset a session fixture needs to be revalidatable. */
export type SeedableSessionUser = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  tenantId?: string;
  /** Set false to test that a deactivated user loses access. */
  isActive?: boolean;
};

/** Matches the fallback tenant `lib/prisma.ts` stamps onto writes. */
const DEFAULT_TENANT_ID = 'default-tenant';

// A bare client: this runs before any tenant context exists, and the extended client in
// lib/prisma.ts resolves tenant context per query.
const raw = createAdminClient();

/**
 * Upsert a `User` row for each fixture, plus its tenant.
 *
 * Idempotent and additive — never deletes. Suites share one database and several call
 * `deleteMany()` in `beforeEach`; a helper that cleaned up after itself would pull rows out
 * from under whichever file is running alongside.
 *
 * `authVersion` is left at its default of 1, which is what `getSessionUser` treats a token
 * with no `authVersion` claim as — so mocked sessions revalidate cleanly without every
 * fixture having to know the field exists.
 */
export async function ensureSessionUsers(...users: SeedableSessionUser[]): Promise<void> {
  const tenantIds = [...new Set(users.map((u) => u.tenantId ?? DEFAULT_TENANT_ID))];

  await raw.tenant.createMany({
    data: tenantIds.map((id) => ({ id, name: `Test tenant ${id}` })),
    skipDuplicates: true,
  });

  for (const user of users) {
    const tenantId = user.tenantId ?? DEFAULT_TENANT_ID;
    const data = {
      // Always derived from the id, never taken from the fixture. `User.email` is globally
      // unique and the fixtures use plausible addresses like `sdr@telestar.vn` — which the
      // demo seed already owns, so honouring them collides on any seeded database. These
      // rows exist to be revalidated against, not to be read: nothing asserts on them.
      email: `${user.id}@session-fixture.test`,
      firstName: user.firstName ?? 'Test',
      lastName: user.lastName ?? 'User',
      role: (user.role ?? 'sdr') as never,
      isActive: user.isActive ?? true,
      tenantId,
    };

    await raw.user.upsert({
      where: { id: user.id },
      // Update as well as create: a fixture's role or active flag can differ between
      // suites reusing the same id, and a stale row would make one file's expectations
      // depend on which file ran first.
      update: data,
      create: { id: user.id, password: 'not-a-real-credential', ...data },
    });
  }
}

/** Release the helper's connection. Safe to call more than once. */
export async function disconnectSessionUsers(): Promise<void> {
  await raw.$disconnect();
}
