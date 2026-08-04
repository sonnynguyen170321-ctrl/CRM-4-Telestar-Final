import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClientReportScope } from '@/lib/client-reports/access';

const getVisibleCampaignIds = vi.fn();

vi.mock('@/lib/auth', () => ({
  getVisibleCampaignIds: (...args: unknown[]) => getVisibleCampaignIds(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * CRM-E-007. `getClientReportScope` decides whether a caller bypasses row
 * filtering entirely, so a wrong `seeAll` here reopens the whole hole — an SDR
 * able to export any client's pipeline. These pin the dispatch.
 */
describe('client report scope resolution', () => {
  it('grants seeAll to a director without consulting campaign scope', async () => {
    const scope = await getClientReportScope({ id: 'dean', role: 'director', tenantId: 't1' });

    expect(scope.seeAll).toBe(true);
    expect(getVisibleCampaignIds).not.toHaveBeenCalled();
  });

  it('grants seeAll to a floor manager', async () => {
    const scope = await getClientReportScope({ id: 'sonny', role: 'floor_manager', tenantId: 't1' });

    expect(scope.seeAll).toBe(true);
    expect(getVisibleCampaignIds).not.toHaveBeenCalled();
  });

  it('limits an SDR to their visible campaigns', async () => {
    getVisibleCampaignIds.mockResolvedValue(['camp-acme', 'camp-logix']);

    const scope = await getClientReportScope({ id: 'david', role: 'sdr', tenantId: 't1' });

    expect(scope.seeAll).toBe(false);
    expect([...scope.campaignIds]).toEqual(['camp-acme', 'camp-logix']);
  });

  it('gives an SDR with no campaigns an empty set, not a bypass', async () => {
    getVisibleCampaignIds.mockResolvedValue([]);

    const scope = await getClientReportScope({ id: 'new-hire', role: 'sdr', tenantId: 't1' });

    expect(scope.seeAll).toBe(false);
    expect(scope.campaignIds.size).toBe(0);
  });

  it('honours a null from getVisibleCampaignIds as see-everything', async () => {
    // Leadgen managers resolve to null by existing design (lib/auth.ts).
    getVisibleCampaignIds.mockResolvedValue(null);

    const scope = await getClientReportScope({ id: 'dominic', role: 'leadgen_manager', tenantId: 't1' });

    expect(scope.seeAll).toBe(true);
  });

  it('does not grant seeAll to a team lead by role alone', async () => {
    getVisibleCampaignIds.mockResolvedValue(['camp-acme']);

    const scope = await getClientReportScope({ id: 'brandon', role: 'team_lead', tenantId: 't1' });

    expect(scope.seeAll).toBe(false);
    expect(getVisibleCampaignIds).toHaveBeenCalled();
  });
});
