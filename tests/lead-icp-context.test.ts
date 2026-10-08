import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCampaignFindFirst = vi.fn();
const mockVersionFindFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findFirst: (...a: unknown[]) => mockCampaignFindFirst(...a) },
    icpVersion: { findFirst: (...a: unknown[]) => mockVersionFindFirst(...a) },
  },
}));

const { describeIcpContext, loadLeadIcpContext } = await import('@/lib/leads/icpContext');

/**
 * Reported 2026-10-08: "the lead drawer is biased to the Telestar ICP; each campaign has a
 * different ICP." The drawer now says which ICP a verdict is measured against, and when it is not
 * the campaign's own.
 */
const row = (id: string, name: string, versionNumber: number, status = 'published') => ({
  id,
  versionNumber,
  status,
  icpProfile: { name },
});

beforeEach(() => vi.clearAllMocks());

describe('loadLeadIcpContext', () => {
  it('uses the campaign’s own ICP when it has one', async () => {
    mockCampaignFindFirst.mockResolvedValue({ icpVersion: row('v-fm', 'FingerMind', 2) });

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: 'v-fm' });

    expect(context).toMatchObject({ source: 'campaign', outdated: false, applies: { profileName: 'FingerMind', versionNumber: 2 } });
    expect(mockVersionFindFirst).not.toHaveBeenCalled();
  });

  it('says so when a campaign with no ICP falls back to the company default', async () => {
    mockCampaignFindFirst.mockResolvedValue({ icpVersion: null });
    mockVersionFindFirst.mockResolvedValueOnce(row('v-ts', 'Telestar', 1));

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: 'v-ts' });

    expect(context).toMatchObject({ source: 'default', outdated: false, applies: { profileName: 'Telestar' } });
    expect(mockVersionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 't1', status: 'published', icpProfile: { isDefault: true } } }),
    );
  });

  it('flags a verdict scored with another ICP than the campaign now uses', async () => {
    mockCampaignFindFirst.mockResolvedValue({ icpVersion: row('v-sg', 'Saigon Technology', 1) });
    mockVersionFindFirst.mockResolvedValueOnce(row('v-ts', 'Telestar', 1));

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: 'v-ts' });

    expect(context.outdated).toBe(true);
    expect(context.scoredWith).toMatchObject({ profileName: 'Telestar', versionNumber: 1 });
  });

  it('has nothing to apply without a campaign ICP or a default', async () => {
    mockCampaignFindFirst.mockResolvedValue(null);
    mockVersionFindFirst.mockResolvedValueOnce(null);

    expect(await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: null })).toEqual({
      applies: null, source: 'none', scoredWith: null, outdated: false,
    });
  });
});

describe('describeIcpContext', () => {
  const ref = (name: string, n: number, status = 'published') => ({ versionId: `${name}-${n}`, profileName: name, versionNumber: n, status });

  it('names the campaign’s ICP without a warning when the verdict is current', () => {
    expect(describeIcpContext({ applies: ref('FingerMind', 2), source: 'campaign', scoredWith: null, outdated: false })).toEqual({
      line: "Scored against this campaign's ICP: FingerMind v2.",
      warning: null,
    });
  });

  it('makes the company-default fallback visible', () => {
    expect(describeIcpContext({ applies: ref('Telestar', 1), source: 'default', scoredWith: null, outdated: false }).line).toBe(
      'This campaign has no ICP of its own, so it is scored against the company default: Telestar v1.',
    );
  });

  it('warns when the verdict came from an earlier ICP', () => {
    const text = describeIcpContext({
      applies: ref('Saigon Technology', 1),
      source: 'campaign',
      scoredWith: ref('Telestar', 1),
      outdated: true,
    });
    expect(text.warning).toBe('This verdict came from Telestar v1, not Saigon Technology v1. It changes only when the lead is scored again.');
  });

  it('warns when the campaign still points at an archived ICP', () => {
    const text = describeIcpContext({ applies: ref('TeleStar ICP', 1, 'archived'), source: 'campaign', scoredWith: null, outdated: false });
    expect(text.warning).toMatch(/archived/);
  });
});
