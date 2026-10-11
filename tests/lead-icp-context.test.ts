import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolve = vi.fn();
const mockVersionFindFirst = vi.fn();
const mockProfileFindFirst = vi.fn();
vi.mock('@/lib/leadgen/scorePoolItem', () => ({ resolveCampaignIcp: (...a: unknown[]) => mockResolve(...a) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    icpVersion: { findFirst: (...a: unknown[]) => mockVersionFindFirst(...a) },
    icpProfile: { findFirst: (...a: unknown[]) => mockProfileFindFirst(...a) },
  },
}));

const { describeIcpContext, loadLeadIcpContext } = await import('@/lib/leads/icpContext');

/**
 * Reported 2026-10-08: "the lead drawer is biased to the Telestar ICP; each campaign has a
 * different ICP." Owner decision 2026-10-10: no fallback. The drawer says which ICP a verdict is
 * measured against, or that the campaign has none.
 */
const row = (id: string, name: string, versionNumber: number, status = 'published') => ({
  id,
  versionNumber,
  status,
  icpProfile: { name },
});

const resolved = (icpVersionId: string) => ({ ok: true, icpVersionId, icpProfileId: 'p1', source: 'profile' });
const unresolved = (reason: string, icpProfileId: string | null = null) => ({ ok: false, icpVersionId: null, reason, icpProfileId });

beforeEach(() => vi.resetAllMocks());

describe('loadLeadIcpContext', () => {
  it('uses the campaign’s own ICP when it has one', async () => {
    mockResolve.mockResolvedValue(resolved('v-fm'));
    mockVersionFindFirst.mockResolvedValue(row('v-fm', 'FingerMind', 2));

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: 'v-fm' });

    expect(context).toMatchObject({ source: 'campaign', reason: null, outdated: false, applies: { profileName: 'FingerMind', versionNumber: 2 } });
    expect(mockResolve).toHaveBeenCalledWith('t1', 'c1');
  });

  it('says there is no ICP, and never reaches for the company default, when the campaign has none', async () => {
    mockResolve.mockResolvedValue(unresolved('campaign_has_no_icp'));

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: 'v-ts' });

    expect(context).toMatchObject({ source: 'none', applies: null, reason: 'campaign_has_no_icp' });
    expect(mockVersionFindFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ icpProfile: { isDefault: true } }) }));
  });

  it('names the profile when it has no published version', async () => {
    mockResolve.mockResolvedValue(unresolved('icp_has_no_published_version', 'p9'));
    mockProfileFindFirst.mockResolvedValue({ name: 'Draft Only' });

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: null });

    expect(context).toMatchObject({ source: 'none', reason: 'icp_has_no_published_version', profileName: 'Draft Only' });
  });

  it('flags a verdict scored with another ICP than the campaign now uses', async () => {
    mockResolve.mockResolvedValue(resolved('v-sg'));
    mockVersionFindFirst.mockResolvedValueOnce(row('v-sg', 'Saigon Technology', 1)).mockResolvedValueOnce(row('v-ts', 'Telestar', 1));

    const context = await loadLeadIcpContext({ tenantId: 't1', campaignId: 'c1', scoredVersionId: 'v-ts' });

    expect(context.outdated).toBe(true);
    expect(context.scoredWith).toMatchObject({ profileName: 'Telestar', versionNumber: 1 });
  });
});

describe('describeIcpContext', () => {
  const ref = (name: string, n: number, status = 'published') => ({ versionId: `${name}-${n}`, profileName: name, versionNumber: n, status });
  const base = { reason: null, profileName: null, scoredWith: null, outdated: false } as const;

  it('names the campaign’s ICP without a warning when the verdict is current', () => {
    expect(describeIcpContext({ ...base, applies: ref('FingerMind', 2), source: 'campaign' })).toEqual({
      line: "Scored against this campaign's ICP: FingerMind v2.",
      warning: null,
    });
  });

  it('tells the reader the campaign has no ICP and to set one', () => {
    expect(describeIcpContext({ ...base, applies: null, source: 'none', reason: 'campaign_has_no_icp' }).line).toBe(
      'This campaign has no ICP — set one.',
    );
  });

  it('explains a profile with nothing published', () => {
    expect(
      describeIcpContext({ ...base, applies: null, source: 'none', reason: 'icp_has_no_published_version', profileName: 'Draft Only' }).line,
    ).toBe('This campaign\'s ICP "Draft Only" has no published version, so this lead is not scored — publish one.');
  });

  it('warns when the verdict came from an earlier ICP', () => {
    const text = describeIcpContext({
      ...base,
      applies: ref('Saigon Technology', 1),
      source: 'campaign',
      scoredWith: ref('Telestar', 1),
      outdated: true,
    });
    expect(text.warning).toBe('This verdict came from Telestar v1, not Saigon Technology v1. It changes only when the lead is scored again.');
  });

  it('warns when the campaign still points at an archived ICP', () => {
    const text = describeIcpContext({ ...base, applies: ref('TeleStar ICP', 1, 'archived'), source: 'campaign' });
    expect(text.warning).toMatch(/archived/);
  });
});
