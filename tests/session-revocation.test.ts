import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, tenantStorage } from '@/lib/prisma';
import { auth } from '@/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Session revocation for stateless JWTs (Task 2).
 *
 * Sessions are JWTs with no server-side store, so a token is a claim about who the user *was*
 * when it was minted. Before `authVersion`, `getSessionUser` returned those claims verbatim:
 * a deactivated, demoted, tenant-moved or password-reset user kept full access until the token
 * expired. Each test below drives one of those transitions and asserts the old token dies.
 *
 * `getSessionUser` is wrapped in React `cache()`, so every test re-imports the module to get a
 * fresh cache — otherwise the first call's result would be replayed for the whole file and the
 * suite would pass no matter what the database said.
 */

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const tenantId = 'revocation-tenant';
const otherTenantId = 'revocation-tenant-other';
const hasDb = Boolean(process.env.DATABASE_URL);

const DIRECTOR = 'rev-director';
const SDR = 'rev-sdr';

const sys = <T>(fn: () => Promise<T>) =>
  tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);

/** A token as it would have been minted at sign-in for the given row. */
const tokenFor = (over: Partial<SessionUser & { authVersion: number }> = {}) => ({
  id: DIRECTOR,
  email: 'rev-director@example.test',
  firstName: 'Dee',
  lastName: 'Rector',
  role: 'director',
  tenantId,
  authVersion: 1,
  ...over,
});

const mockToken = (user: unknown | null) =>
  (auth as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(
    user ? { user, expires: '' } : null
  );

/** Fresh module instance so React `cache()` does not replay a previous call. */
async function freshGetSessionUser() {
  vi.resetModules();
  const mod = await import('@/lib/auth');
  return mod.getSessionUser;
}

const resetRows = async () =>
  sys(async () => {
    await prisma.user.updateMany({
      where: { id: { in: [DIRECTOR, SDR] } },
      data: { isActive: true, authVersion: 1, role: 'director', tenantId },
    });
    await prisma.user.update({ where: { id: SDR }, data: { role: 'sdr', tenantId } });
  });

beforeAll(async () => {
  if (!hasDb) return;
  await sys(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [DIRECTOR, SDR] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
    await prisma.tenant.create({ data: { id: tenantId, name: 'Revocation Tenant' } });
    await prisma.tenant.create({ data: { id: otherTenantId, name: 'Revocation Other' } });
    await prisma.user.create({
      data: {
        id: DIRECTOR, email: 'rev-director@example.test', password: 'x',
        firstName: 'Dee', lastName: 'Rector', role: 'director', tenantId,
      },
    });
    await prisma.user.create({
      data: {
        id: SDR, email: 'rev-sdr@example.test', password: 'x',
        firstName: 'Sam', lastName: 'Rep', role: 'sdr', tenantId,
      },
    });
  });
}, 60_000);

afterAll(async () => {
  if (!hasDb) return;
  await sys(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [DIRECTOR, SDR] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId] } } });
  });
}, 60_000);

beforeEach(async () => {
  if (hasDb) await resetRows();
});

describe.skipIf(!hasDb)('getSessionUser — revalidates against the database', () => {
  it('accepts a token that still matches the row', async () => {
    mockToken(tokenFor());
    const getSessionUser = await freshGetSessionUser();
    const user = await getSessionUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(DIRECTOR);
    expect(user?.role).toBe('director');
  });

  it('rejects immediately once the user is deactivated', async () => {
    mockToken(tokenFor());
    await sys(() => prisma.user.update({ where: { id: DIRECTOR }, data: { isActive: false } }));

    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).toBeNull();
  });

  it('reactivating does not resurrect the old session', async () => {
    // Deactivation bumps authVersion in the route; simulate that, then reactivate.
    await sys(() =>
      prisma.user.update({
        where: { id: DIRECTOR },
        data: { isActive: false, authVersion: { increment: 1 } },
      })
    );
    await sys(() => prisma.user.update({ where: { id: DIRECTOR }, data: { isActive: true } }));

    mockToken(tokenFor({ authVersion: 1 })); // the pre-deactivation token
    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).toBeNull();
  });

  it('authorizes on the database role, not the token role', async () => {
    // The demoted director's cookie still says "director". Honouring it was the bug.
    await sys(() => prisma.user.update({ where: { id: DIRECTOR }, data: { role: 'sdr' } }));

    mockToken(tokenFor({ role: 'director' }));
    const getSessionUser = await freshGetSessionUser();
    const user = await getSessionUser();

    expect(user).not.toBeNull();
    expect(user?.role).toBe('sdr');
  });

  it('rejects a token whose authVersion is behind the row', async () => {
    await sys(() =>
      prisma.user.update({ where: { id: DIRECTOR }, data: { authVersion: { increment: 1 } } })
    );

    mockToken(tokenFor({ authVersion: 1 }));
    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).toBeNull();
  });

  it('treats a token minted before authVersion existed as version 1', async () => {
    // Deploying this change must not sign out every existing session.
    const { authVersion: _omitted, ...legacy } = tokenFor();
    mockToken(legacy);

    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).not.toBeNull();
  });

  it('rejects a token for a deleted user', async () => {
    mockToken(tokenFor({ id: 'rev-does-not-exist' }));
    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects a token whose tenant does not match the row', async () => {
    // Asserted by minting a token for the wrong tenant rather than moving the row. The guard
    // compares the two values, so this covers the same branch, and it keeps the test free of
    // shared-state mutation — moving the row here proved order-dependent once the file ran
    // as a whole, because each test calls vi.resetModules() and gets its own client.
    const rowTenant = await sys(() =>
      prisma.user.findUnique({ where: { id: DIRECTOR }, select: { tenantId: true } })
    );
    expect(rowTenant?.tenantId).toBe(tenantId);

    mockToken(tokenFor({ tenantId: otherTenantId }));
    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).toBeNull();
  });

  it('rejects when there is no session at all', async () => {
    mockToken(null);
    const getSessionUser = await freshGetSessionUser();
    expect(await getSessionUser()).toBeNull();
  });

  it('derives isManager from the database, not the token', async () => {
    // Token claims manager; the row is a plain SDR with no reports.
    mockToken(tokenFor({ id: SDR, role: 'director', isManager: true }));
    const getSessionUser = await freshGetSessionUser();
    const user = await getSessionUser();

    expect(user?.role).toBe('sdr');
    expect(user?.isManager).toBe(false);
  });
});

describe.skipIf(!hasDb)('requireAuth / requireRole use the revalidated user', () => {
  it('requireAuth returns 401 for a deactivated user', async () => {
    mockToken(tokenFor());
    await sys(() => prisma.user.update({ where: { id: DIRECTOR }, data: { isActive: false } }));

    vi.resetModules();
    const { requireAuth } = await import('@/lib/auth');
    const res = await requireAuth();
    expect((res as Response).status).toBe(401);
  });

  it('requireRole rejects a demoted director holding a director token', async () => {
    await sys(() => prisma.user.update({ where: { id: DIRECTOR }, data: { role: 'sdr' } }));
    mockToken(tokenFor({ role: 'director' }));

    vi.resetModules();
    const { requireRole } = await import('@/lib/auth');
    const res = await requireRole('director');
    expect((res as Response).status).toBe(403);
  });

  it('does not disclose why the session failed', async () => {
    mockToken(tokenFor());
    await sys(() => prisma.user.update({ where: { id: DIRECTOR }, data: { isActive: false } }));

    vi.resetModules();
    const { requireAuth } = await import('@/lib/auth');
    const res = (await requireAuth()) as Response;
    const body = await res.json();

    // A bare "Unauthorized" — never "account deactivated" or "role changed", which would
    // tell an attacker which of their guesses about the account is correct.
    expect(body).toEqual({ error: 'Unauthorized' });
  });
});
