import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { SessionUser } from '@/lib/auth';

/**
 * Team leads assign their own pod to campaigns (owner, 2026-10-06, after team leads could create
 * campaigns but could not put anyone in them).
 *
 * A team lead gets the `pod` manage scope: the people below them (getVisibleUserIds) on the
 * campaigns they can see (getVisibleCampaignIds). It is deliberately narrower than a floor
 * manager's: no whole-user operations (canManageUser), and no Team & Accounts panel
 * (/api/admin/assignments), which edits who reports to whom.
 */

const visibleUserIds = vi.fn();
const visibleCampaignIds = vi.fn();
const session = { current: null as SessionUser | null };

vi.mock('@/lib/auth', () => ({
  getVisibleUserIds: (...a: unknown[]) => visibleUserIds(...a),
  getVisibleCampaignIds: (...a: unknown[]) => visibleCampaignIds(...a),
  getLeadgenScope: vi.fn(async () => ({ kind: 'none' })),
  clearVisibleUserCache: vi.fn(),
  requireAuth: async () => session.current,
}));

const campaignFindUnique = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findUnique: (...a: unknown[]) => campaignFindUnique(...a) },
    campaignSdr: { findMany: vi.fn(async () => []) },
    lead: { groupBy: vi.fn(async () => []) },
    task: { groupBy: vi.fn(async () => []) },
    meeting: { groupBy: vi.fn(async () => []) },
    opportunity: { groupBy: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
  },
}));

const { getManageScope, canManage, canManageUser } = await import('@/lib/admin/scope');
const { GET: getAssignments } = await import('@/app/api/admin/assignments/route');
const { GET: getMembers } = await import('@/app/api/campaigns/[id]/members/route');

const teamLead: SessionUser = {
  id: 'u-tl', role: 'team_lead', tenantId: 't1', email: 'tl@t.test', firstName: 'T', lastName: 'L',
};

describe('the pod manage scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.current = teamLead;
    visibleUserIds.mockResolvedValue(['u-tl', 'u-sdr1', 'u-sdr2']);
    visibleCampaignIds.mockResolvedValue(['camp-mine']);
  });

  it('gives a team lead their pod on the campaigns they can see', async () => {
    const scope = await getManageScope(teamLead);

    expect(scope.kind).toBe('pod');
    expect(canManage(scope, 'u-sdr1', 'camp-mine')).toBe(true);
  });

  it('stops at the edge of the pod and of their campaigns', async () => {
    const scope = await getManageScope(teamLead);

    expect(canManage(scope, 'u-other-pod', 'camp-mine'), 'someone outside the pod').toBe(false);
    expect(canManage(scope, 'u-sdr1', 'camp-elsewhere'), 'a campaign they cannot see').toBe(false);
  });

  it('opens no whole-user operation — transferring all work or deactivating stays with managers above', async () => {
    const scope = await getManageScope(teamLead);

    expect(canManageUser(scope, 'u-sdr1')).toBe(false);
  });

  it('keeps the Team & Accounts panel, which edits reporting lines, closed to a team lead', async () => {
    const res = await getAssignments();

    expect(res.status).toBe(403);
  });

  it('answers 404 for the members of a campaign the team lead cannot see', async () => {
    campaignFindUnique.mockResolvedValue({ id: 'camp-elsewhere', name: 'X', status: 'active', client: null, _count: {} });

    const res = await getMembers(new NextRequest('http://localhost:3000/api/campaigns/camp-elsewhere/members'), {
      params: Promise.resolve({ id: 'camp-elsewhere' }),
    });

    expect(res.status).toBe(404);
  });

  it('lists the members of a campaign the team lead can see', async () => {
    campaignFindUnique.mockResolvedValue({
      id: 'camp-mine', name: 'Mine', status: 'active',
      client: { id: 'cl-1', name: 'Nekko', status: 'active' },
      _count: { leads: 0, meetings: 0, opportunities: 0 },
    });

    const res = await getMembers(new NextRequest('http://localhost:3000/api/campaigns/camp-mine/members'), {
      params: Promise.resolve({ id: 'camp-mine' }),
    });

    expect(res.status).toBe(200);
  });
});
