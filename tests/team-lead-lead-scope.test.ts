import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '@/lib/auth';

/**
 * Owner report, 2026-10-07: "on the Leads tab a team lead still sees other teams' leads". A team
 * lead's lead scope was their pod OR every lead in any campaign their pod belongs to, so a shared
 * campaign showed them every other team's working leads. Owner decision: only their pod's leads.
 *
 * Kept on purpose: leads in their campaigns held by a deactivated rep, which must be taken over.
 * Floor managers are unchanged.
 */

const userFindMany = vi.fn();
const userFindUnique = vi.fn();
const campaignSdrFindMany = vi.fn();

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: (...a: unknown[]) => userFindMany(...a),
      findUnique: (...a: unknown[]) => userFindUnique(...a),
    },
    campaignSdr: { findMany: (...a: unknown[]) => campaignSdrFindMany(...a) },
  },
}));

const { canAccessLead, clearVisibleUserCache, getLeadWhereScope } = await import('@/lib/auth');

const teamLead = { id: 'tl-1', role: 'team_lead', tenantId: 't-1' } as SessionUser;
const floorManager = { id: 'fm-1', role: 'floor_manager', tenantId: 't-1' } as SessionUser;

// tl-1 manages sdr-1; tl-2 (another team) manages sdr-2; both teams are in camp-shared.
const org = [
  { id: 'fm-1', role: 'floor_manager', managerId: null },
  { id: 'tl-1', role: 'team_lead', managerId: 'fm-1' },
  { id: 'sdr-1', role: 'sdr', managerId: 'tl-1' },
  { id: 'tl-2', role: 'team_lead', managerId: 'fm-1' },
  { id: 'sdr-2', role: 'sdr', managerId: 'tl-2' },
];

beforeEach(() => {
  clearVisibleUserCache();
  userFindMany.mockReset().mockResolvedValue(org);
  userFindUnique.mockReset();
  campaignSdrFindMany.mockReset().mockResolvedValue([{ campaignId: 'camp-shared' }]);
});

describe('getLeadWhereScope — team lead', () => {
  it('reaches the pod’s leads, and in their campaigns only those whose rep was deactivated', async () => {
    expect(await getLeadWhereScope(teamLead)).toEqual({
      OR: [
        { assignedToId: { in: ['tl-1', 'sdr-1'] } },
        { assignedTo: { isActive: false }, campaignId: { in: ['camp-shared'] } },
      ],
    });
  });

  // Review finding: `assignedToId` is a required column, and Prisma refuses a null filter on it —
  // every team lead's lead list would have answered 500.
  it('never filters the required assignee column on null', async () => {
    expect(JSON.stringify(await getLeadWhereScope(teamLead))).not.toContain('"assignedToId":null');
  });

  it('is the pod alone when the pod belongs to no campaign', async () => {
    campaignSdrFindMany.mockResolvedValue([]);
    expect(await getLeadWhereScope(teamLead)).toEqual({ OR: [{ assignedToId: { in: ['tl-1', 'sdr-1'] } }] });
  });

  it('leaves the floor manager’s whole-campaign reach as it was', async () => {
    const scope = (await getLeadWhereScope(floorManager)) as { OR: unknown[] };
    expect(scope.OR).toContainEqual({ campaignId: { in: ['camp-shared'] } });
  });
});

describe('canAccessLead — team lead', () => {
  it('opens their own pod’s lead', async () => {
    expect(await canAccessLead(teamLead, { assignedToId: 'sdr-1', campaignId: 'camp-shared' })).toBe(true);
  });

  it('refuses another team’s working lead in a shared campaign', async () => {
    userFindUnique.mockResolvedValue({ isActive: true });
    expect(await canAccessLead(teamLead, { assignedToId: 'sdr-2', campaignId: 'camp-shared' })).toBe(false);
  });

  it('opens a lead whose rep was deactivated, so it can be taken over', async () => {
    userFindUnique.mockResolvedValue({ isActive: false });
    expect(await canAccessLead(teamLead, { assignedToId: 'gone-1', campaignId: 'camp-shared' })).toBe(true);
  });

  it('refuses an unassigned lead in a campaign that is not theirs', async () => {
    expect(await canAccessLead(teamLead, { assignedToId: null, campaignId: 'camp-other' })).toBe(false);
  });

  it('still lets a floor manager open any lead in their campaigns', async () => {
    expect(await canAccessLead(floorManager, { assignedToId: 'someone-else', campaignId: 'camp-shared' })).toBe(true);
  });
});

describe('canAccessOpportunity — team lead', () => {
  it('refuses another team’s opportunity in a shared campaign', async () => {
    const { canAccessOpportunity } = await import('@/lib/opportunities/access');
    userFindUnique.mockResolvedValue({ isActive: true });

    expect(await canAccessOpportunity(teamLead, {
      ownerId: 'sdr-2', createdById: 'sdr-2', campaignId: 'camp-shared',
      lead: { id: 'lead-2', assignedToId: 'sdr-2', campaignId: 'camp-shared' },
    })).toBe(false);
  });

  it('opens their pod’s opportunity', async () => {
    const { canAccessOpportunity } = await import('@/lib/opportunities/access');

    expect(await canAccessOpportunity(teamLead, {
      ownerId: 'sdr-1', createdById: 'sdr-1', campaignId: 'camp-shared',
      lead: { id: 'lead-1', assignedToId: 'sdr-1', campaignId: 'camp-shared' },
    })).toBe(true);
  });
});
