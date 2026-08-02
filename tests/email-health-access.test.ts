import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { SessionUser } from '@/lib/auth';

/**
 * Access-control regressions for the deliverability module.
 *
 * Mailbox visibility is strictly the user axis — an EmailAccount belongs to a
 * person. These tests exist to stop the campaign/account axis used for leads
 * from leaking in, which would expose a colleague's mailbox to anyone sharing
 * a campaign with them.
 */

const mockUserFindMany = vi.fn();
const mockAccountFindUnique = vi.fn();

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: (...args: unknown[]) => mockUserFindMany(...args) },
    emailAccount: { findUnique: (...args: unknown[]) => mockAccountFindUnique(...args) },
  },
  tenantStorage: { run: (_: unknown, fn: () => unknown) => fn() },
}));

const { auth } = await import('@/auth');
const { getEmailAccountScope, emailAccountWhere, canAccessEmailAccount, isManagerRole } =
  await import('@/lib/email-health/access');
const { GET: getCampaigns } = await import('@/app/api/email-health/campaigns/route');
const { GET: getDomains } = await import('@/app/api/email-health/domains/route');

function sessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'u-sdr',
    email: 'sdr@telestar.test',
    firstName: 'Sam',
    lastName: 'Rep',
    role: 'sdr',
    tenantId: 'tenant-1',
    ...overrides,
  };
}

function mockSession(user: SessionUser | null) {
  (auth as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce(
    user ? { user, expires: '' } : null
  );
}

// A small org: director → floor manager → team lead → two SDRs.
const ORG = [
  { id: 'u-dir', role: 'director', managerId: null },
  { id: 'u-fm', role: 'floor_manager', managerId: 'u-dir' },
  { id: 'u-tl', role: 'team_lead', managerId: 'u-fm' },
  { id: 'u-sdr', role: 'sdr', managerId: 'u-tl' },
  { id: 'u-other', role: 'sdr', managerId: 'u-tl' },
];

describe('isManagerRole', () => {
  it.each([
    ['director', true],
    ['floor_manager', true],
    ['team_lead', true],
    ['sdr', false],
    ['leadgen', false],
    ['leadgen_manager', false],
  ])('%s → %s', (role, expected) => {
    expect(isManagerRole(role as SessionUser['role'])).toBe(expected);
  });
});

describe('getEmailAccountScope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindMany.mockResolvedValue(ORG);
  });

  it('restricts an SDR to their own mailbox without reading the org', async () => {
    const scope = await getEmailAccountScope(sessionUser());

    expect(scope).toEqual({ userIds: ['u-sdr'], canManage: false });
    // Short-circuit matters: a non-manager must never trigger the full user read.
    expect(mockUserFindMany).not.toHaveBeenCalled();
  });

  it('gives a director unrestricted visibility', async () => {
    const scope = await getEmailAccountScope(sessionUser({ id: 'u-dir', role: 'director' }));

    expect(scope.userIds).toBeNull();
    expect(scope.canManage).toBe(true);
  });

  it('scopes a team lead to their pod', async () => {
    const scope = await getEmailAccountScope(sessionUser({ id: 'u-tl', role: 'team_lead' }));

    expect(scope.canManage).toBe(true);
    expect(scope.userIds).toEqual(expect.arrayContaining(['u-tl', 'u-sdr', 'u-other']));
    expect(scope.userIds).not.toContain('u-dir');
    expect(scope.userIds).not.toContain('u-fm');
  });

  it('treats leadgen roles as non-managers for mailbox access', async () => {
    const scope = await getEmailAccountScope(sessionUser({ id: 'u-lg', role: 'leadgen_manager' }));

    expect(scope).toEqual({ userIds: ['u-lg'], canManage: false });
  });
});

describe('emailAccountWhere', () => {
  it('produces an empty filter for unrestricted scope', () => {
    expect(emailAccountWhere({ userIds: null, canManage: true })).toEqual({});
  });

  it('filters by owner for a restricted scope', () => {
    expect(emailAccountWhere({ userIds: ['a', 'b'], canManage: true })).toEqual({
      userId: { in: ['a', 'b'] },
    });
  });

  it('never widens an SDR scope to a campaign axis', () => {
    // Regression guard: leads are visible via campaign OR assignee, but mailboxes
    // must only ever be filtered by owner.
    const where = emailAccountWhere({ userIds: ['u-sdr'], canManage: false });
    expect(where).toEqual({ userId: { in: ['u-sdr'] } });
    expect(JSON.stringify(where)).not.toContain('campaign');
    expect(JSON.stringify(where)).not.toContain('OR');
  });
});

describe('canAccessEmailAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindMany.mockResolvedValue(ORG);
  });

  it('allows an SDR to read their own mailbox', async () => {
    mockAccountFindUnique.mockResolvedValue({ userId: 'u-sdr' });
    expect(await canAccessEmailAccount(sessionUser(), 'acc-1')).toBe(true);
  });

  it("denies an SDR access to a peer's mailbox (IDOR)", async () => {
    mockAccountFindUnique.mockResolvedValue({ userId: 'u-other' });
    expect(await canAccessEmailAccount(sessionUser(), 'acc-2')).toBe(false);
  });

  it("allows a team lead to read a direct report's mailbox", async () => {
    mockAccountFindUnique.mockResolvedValue({ userId: 'u-sdr' });
    const tl = sessionUser({ id: 'u-tl', role: 'team_lead' });
    expect(await canAccessEmailAccount(tl, 'acc-1')).toBe(true);
  });

  it("denies a team lead access to their own manager's mailbox", async () => {
    mockAccountFindUnique.mockResolvedValue({ userId: 'u-fm' });
    const tl = sessionUser({ id: 'u-tl', role: 'team_lead' });
    expect(await canAccessEmailAccount(tl, 'acc-fm')).toBe(false);
  });

  it('returns false for a missing account rather than throwing', async () => {
    mockAccountFindUnique.mockResolvedValue(null);
    expect(await canAccessEmailAccount(sessionUser(), 'nope')).toBe(false);
  });
});

describe('manager-only route gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindMany.mockResolvedValue(ORG);
  });

  it('401s an unauthenticated campaigns request', async () => {
    mockSession(null);
    const res = await getCampaigns(new Request('http://localhost/api/email-health/campaigns') as never);
    expect(res.status).toBe(401);
  });

  it('403s an SDR requesting campaign deliverability', async () => {
    mockSession(sessionUser());
    const res = await getCampaigns(new Request('http://localhost/api/email-health/campaigns') as never);
    expect(res.status).toBe(403);
  });

  it('403s an SDR requesting domain health', async () => {
    mockSession(sessionUser());
    const res = await getDomains(new Request('http://localhost/api/email-health/domains') as never);
    expect(res.status).toBe(403);
  });

  it('401s an unauthenticated domains request', async () => {
    mockSession(null);
    const res = await getDomains(new Request('http://localhost/api/email-health/domains') as never);
    expect(res.status).toBe(401);
  });
});
