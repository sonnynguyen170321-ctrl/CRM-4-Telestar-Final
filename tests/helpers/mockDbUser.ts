/**
 * A `prisma.user.findUnique` stand-in for suites that mock the whole Prisma client.
 *
 * Task 2's `getSessionUser` revalidates every request by loading the user from the
 * database. Suites that mock `@/lib/prisma` therefore need that one call answered, or every
 * request 401s before reaching the authorization logic they exist to test.
 *
 * Seeding a real row — the approach used by the suites that talk to a real database — does
 * not work here: the route reads the mocked client, not Postgres. Teaching the mock is both
 * the smaller change and the one that keeps these files as unit tests with no database.
 */

import { vi } from 'vitest';

type UserSeed = {
  id: string;
  role?: string;
  tenantId?: string;
  isActive?: boolean;
  /** Number of active direct reports, which decides `isManager`. */
  reports?: number;
};

/**
 * Build the exact row shape `getSessionUser` selects.
 *
 * `authVersion: 1` matches both the column default and the value `getSessionUser` assumes
 * for a token carrying no `authVersion` claim — so a mocked session revalidates cleanly
 * without every fixture having to know the field exists.
 */
export function dbUserRow(seed: UserSeed) {
  return {
    id: seed.id,
    email: `${seed.id}@session-fixture.test`,
    firstName: 'Test',
    lastName: 'User',
    role: seed.role ?? 'sdr',
    isActive: seed.isActive ?? true,
    tenantId: seed.tenantId ?? 'default-tenant',
    authVersion: 1,
    _count: { reports: seed.reports ?? 0 },
  };
}

/**
 * A `findUnique` that resolves the given fixtures by id and returns null for anything else.
 *
 * Returning null for an unknown id is deliberate: it is exactly what a deleted user looks
 * like, so a test that mocks a session for someone who was never seeded still gets the
 * correct 401 rather than a silently-passing fake.
 */
export function makeUserFindUnique(seeds: UserSeed[]) {
  const rows = new Map(seeds.map((s) => [s.id, dbUserRow(s)]));
  return vi.fn(async (args: { where?: { id?: string } } = {}) => {
    const id = args?.where?.id;
    return (id && rows.get(id)) || null;
  });
}
