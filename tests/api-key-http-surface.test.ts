import { vi, describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';

/**
 * TEL-P0-005 through the HTTP surface, with a key an SDR could actually mint.
 *
 * `tests/api-key-privilege-escalation.test.ts` proves the derivation: `deriveIsManager` is
 * honest, and no source file hardcodes `isManager: true` any more. That is necessary and it is
 * not the whole claim. The fix commit `1d41ea1` said so itself:
 *
 *   "Remaining before VERIFIED: exercise through the real HTTP surface with a live SDR-minted
 *    key. Per .claude/rules/auth-rbac.md this is R4 — independent verification required."
 *
 * This is that half. It mints a key the way `POST /api/developer/keys` does — `tl_live_…`,
 * stored as its SHA-256 — presents it in the `Authorization` header, and calls a route whose
 * only protection is `requireManager()`. The escalation being tested for is not subtle: any
 * authenticated user can mint a key, so if the API-key path reports `isManager: true` the
 * negation inside `requireManager` is satisfied and an SDR reaches manager-only routes.
 *
 * The assertion is on the response, not on an internal flag: **403**.
 */

const mockApiKeyFindUnique = vi.fn();
const mockApiKeyUpdate = vi.fn().mockResolvedValue({});
const mockUserFindUnique = vi.fn();
const mockHeaders = vi.fn();

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(mockHeaders()),
}));

vi.mock('@/auth', () => ({
  // No cookie session at all: the API key is the only credential in play, which is exactly
  // the shape of the attack — a bearer token, no browser, no session.
  auth: vi.fn().mockResolvedValue(null),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    apiKey: {
      findUnique: (...args: unknown[]) => mockApiKeyFindUnique(...args),
      update: (...args: unknown[]) => mockApiKeyUpdate(...args),
    },
    user: { findUnique: (...args: unknown[]) => mockUserFindUnique(...args) },
    account: { findUnique: vi.fn(), update: vi.fn() },
  },
  tenantStorage: { run: (_: unknown, fn: () => unknown) => fn() },
}));

const { getSessionUser, requireManager } = await import('@/lib/auth');
const { PATCH: patchAccountCap } = await import('@/app/api/automation/accounts/[id]/cap/route');

const TENANT = 'tenant-1';

/** A key in the exact shape `POST /api/developer/keys` writes, for the given creator. */
function mintKeyFor(creator: { id: string; role: string; reports: number; isActive?: boolean }) {
  const token = `tl_live_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(token).digest('hex');
  return {
    token,
    row: {
      id: 'key-1',
      name: 'ci-minted',
      keyHash,
      tenantId: TENANT,
      isActive: true,
      expiresAt: null,
      scopes: [],
      createdById: creator.id,
      createdBy: {
        id: creator.id,
        email: `${creator.id}@telestar.test`,
        firstName: 'Test',
        lastName: 'User',
        role: creator.role,
        isActive: creator.isActive ?? true,
        tenantId: TENANT,
        authVersion: 1,
        _count: { reports: creator.reports },
      },
    },
  };
}

function presentKey(token: string) {
  mockHeaders.mockReturnValue(new Headers({ authorization: `Bearer ${token}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApiKeyUpdate.mockResolvedValue({});
  // getSessionUser's session path must find nothing, so the API key is the only credential.
  mockUserFindUnique.mockResolvedValue(null);
});

describe('an SDR-minted API key does not authenticate as a manager (TEL-P0-005)', () => {
  it('resolves the key to the SDR who created it, not to a manager', async () => {
    const { token, row } = mintKeyFor({ id: 'u-sdr', role: 'sdr', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const user = await getSessionUser();
    expect(user).not.toBeNull();
    expect(user!.id).toBe('u-sdr');
    expect(user!.role).toBe('sdr');
    // The literal defect: this field was `true` unconditionally on the API-key path.
    expect(user!.isManager).toBe(false);
  });

  it('is refused by requireManager with 403, not admitted', async () => {
    const { token, row } = mintKeyFor({ id: 'u-sdr', role: 'sdr', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const result = await requireManager();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });

  it('is refused by a real manager-only route handler with 403', async () => {
    // The HTTP surface, not the helper: the route's only protection is requireManager().
    const { token, row } = mintKeyFor({ id: 'u-sdr', role: 'sdr', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const req = new Request('http://localhost/api/automation/accounts/acc-1/cap', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ dailyCap: 100 }),
    });

    const res = await patchAccountCap(req as never, { params: Promise.resolve({ id: 'acc-1' }) });
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'Forbidden' });
  });

  it('a leadgen_manager key is refused too — the name is not the CRM manager axis', async () => {
    const { token, row } = mintKeyFor({ id: 'u-lgm', role: 'leadgen_manager', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const user = await getSessionUser();
    expect(user!.isManager).toBe(false);

    const result = await requireManager();
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(403);
  });
});

describe('the same route still admits an actual manager (TEL-P0-005)', () => {
  it('a director-minted key reaches the handler rather than 403', async () => {
    // Without this the 403s above could be produced by the key path being broken outright,
    // which would prove nothing about authority.
    const { token, row } = mintKeyFor({ id: 'u-dir', role: 'director', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const user = await getSessionUser();
    expect(user!.role).toBe('director');

    const result = await requireManager();
    expect(result).not.toBeInstanceOf(Response);
    expect((result as { id: string }).id).toBe('u-dir');
  });

  it('a team_lead with reports is a manager by derivation, not by assertion', async () => {
    const { token, row } = mintKeyFor({ id: 'u-tl', role: 'team_lead', reports: 3 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const user = await getSessionUser();
    expect(user!.isManager).toBe(true);
    expect(await requireManager()).not.toBeInstanceOf(Response);
  });

  it('an SDR who has acquired reports is a manager, on the same derivation', async () => {
    // The derivation is `reports > 0 || MANAGER_ROLES.includes(role)`, and it is the same
    // derivation on both authentication paths. That is the property, not the role list.
    const { token, row } = mintKeyFor({ id: 'u-sdr2', role: 'sdr', reports: 2 });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    const user = await getSessionUser();
    expect(user!.isManager).toBe(true);
  });
});

describe('the key itself still has to be valid (TEL-P0-005)', () => {
  it('a key whose creator was deactivated authenticates nobody', async () => {
    const { token, row } = mintKeyFor({ id: 'u-gone', role: 'director', reports: 0, isActive: false });
    mockApiKeyFindUnique.mockResolvedValue(row);
    presentKey(token);

    expect(await getSessionUser()).toBeNull();
  });

  it('an expired key authenticates nobody', async () => {
    const { token, row } = mintKeyFor({ id: 'u-dir', role: 'director', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue({ ...row, expiresAt: new Date(Date.now() - 1000) });
    presentKey(token);

    expect(await getSessionUser()).toBeNull();
  });

  it('a deactivated key authenticates nobody', async () => {
    const { token, row } = mintKeyFor({ id: 'u-dir', role: 'director', reports: 0 });
    mockApiKeyFindUnique.mockResolvedValue({ ...row, isActive: false });
    presentKey(token);

    expect(await getSessionUser()).toBeNull();
  });

  it('a token that is not a key at all is not looked up', async () => {
    presentKey('not-a-telestar-key');
    expect(await getSessionUser()).toBeNull();
    expect(mockApiKeyFindUnique).not.toHaveBeenCalled();
  });
});
