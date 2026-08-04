import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAssignableRepIds, canAssignToRep } from '@/lib/leadgen/assignableReps';

const mockPrisma = {
  campaignSdr: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
};

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaignSdr: { findMany: (...args: unknown[]) => mockPrisma.campaignSdr.findMany(...args) },
    user: { findMany: (...args: unknown[]) => mockPrisma.user.findMany(...args) },
  },
}));

const leadgenManager = { id: 'dominic', role: 'leadgen_manager' as const, tenantId: 'tenant-1' };
const director = { id: 'dean', role: 'director' as const, tenantId: 'tenant-1' };

const CAMPAIGN = 'campaign-acme';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Regression cover for CRM-C-002. Lead generation is a sibling branch to the SDR
 * floor in the managerId tree, so the previous subtree-based guard rejected every
 * SDR a leadgen manager tried to route to. These tests pin the replacement rule:
 * scope by campaign membership, not by reporting line.
 */
describe('leadgen assignable reps', () => {
  it('returns the SDRs attached to the target campaign', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([{ userId: 'lan' }, { userId: 'david' }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }, { id: 'david' }]);

    const ids = await getAssignableRepIds(leadgenManager, CAMPAIGN);

    expect(ids).toEqual(['lan', 'david']);
    expect(mockPrisma.campaignSdr.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { campaignId: CAMPAIGN, tenantId: 'tenant-1' } })
    );
  });

  it('lets a leadgen manager assign to an SDR on the campaign — the case that used to 403', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([{ userId: 'lan' }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }]);

    await expect(canAssignToRep(leadgenManager, 'lan', CAMPAIGN)).resolves.toBe(true);
  });

  it('still refuses an SDR who is not on the campaign', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([{ userId: 'lan' }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }]);

    await expect(canAssignToRep(leadgenManager, 'stranger', CAMPAIGN)).resolves.toBe(false);
  });

  it('excludes deactivated reps even when CampaignSdr still lists them', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([{ userId: 'lan' }, { userId: 'retired' }]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }]);

    const ids = await getAssignableRepIds(leadgenManager, CAMPAIGN);

    expect(ids).toEqual(['lan']);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isActive: true, id: { in: ['lan', 'retired'] } }),
      })
    );
  });

  it('falls back to every active SDR when the campaign has nobody attached', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }, { id: 'vy' }]);

    const ids = await getAssignableRepIds(leadgenManager, CAMPAIGN);

    expect(ids).toEqual(['lan', 'vy']);
    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: 'sdr', isActive: true }) })
    );
  });

  it('falls back to every active SDR when no campaign is given', async () => {
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }]);

    const ids = await getAssignableRepIds(leadgenManager, null);

    expect(ids).toEqual(['lan']);
    expect(mockPrisma.campaignSdr.findMany).not.toHaveBeenCalled();
  });

  it('lets directors and floor managers reach leadgen staff as well as SDRs', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'lan' }, { id: 'alex' }]);

    await getAssignableRepIds(director, CAMPAIGN);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ role: { in: ['sdr', 'leadgen'] } }) })
    );
  });

  it('scopes every fallback query to the caller tenant', async () => {
    mockPrisma.campaignSdr.findMany.mockResolvedValue([]);
    mockPrisma.user.findMany.mockResolvedValue([]);

    await getAssignableRepIds(leadgenManager, CAMPAIGN);

    expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-1' }) })
    );
  });
});
