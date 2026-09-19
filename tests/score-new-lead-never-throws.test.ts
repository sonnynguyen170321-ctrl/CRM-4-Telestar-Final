/**
 * `scoreNewLead` is in the import worker's per-row path, so it must never reject — a lead
 * that could not be scored is still a lead, and an import must not fail because an ICP
 * could not be read. The code review of the change asked for this to be pinned rather than
 * read off the try/catch shape, and it was right: the function is called from five doors.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockScoreLeadIcp = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { lead: { findFirst: (...a: unknown[]) => mockFindFirst(...a), update: (...a: unknown[]) => mockUpdate(...a) } },
}));
vi.mock('@/lib/leads/icpScoring', () => ({ scoreLeadIcp: (...a: unknown[]) => mockScoreLeadIcp(...a) }));

const { scoreNewLead } = await import('@/lib/leads/scoreNewLead');

const LEAD = { id: 'lead-1', tenantId: 't1', emailReplyCount: 0, emailOpenCount: 0, _count: { meetings: 0 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mockFindFirst.mockResolvedValue(LEAD);
  mockUpdate.mockResolvedValue(LEAD);
  mockScoreLeadIcp.mockResolvedValue({ status: 'scored', assessmentId: 'a1', inserted: true, fitScore: 70, qualification: 'qualified' });
});

describe('scoreNewLead never rejects', () => {
  it('returns both scores on the happy path', async () => {
    const out = await scoreNewLead({ tenantId: 't1', leadId: 'lead-1' });
    expect(out.engagementScore).toBe(0);
    expect(out.icp).toMatchObject({ status: 'scored', fitScore: 70 });
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { engagementScore: 0 } }));
  });

  it('survives the engagement write failing and still scores ICP', async () => {
    mockUpdate.mockRejectedValue(new Error('connection terminated'));
    const out = await scoreNewLead({ tenantId: 't1', leadId: 'lead-1' });
    expect(out.engagementScore).toBeNull();
    expect(out.icp).toMatchObject({ status: 'scored' });
  });

  it('survives ICP scoring throwing and reports it instead', async () => {
    mockScoreLeadIcp.mockRejectedValue(new Error('rules unreadable'));
    const out = await scoreNewLead({ tenantId: 't1', leadId: 'lead-1' });
    expect(out.engagementScore).toBe(0);
    expect(out.icp).toEqual({ status: 'error', message: 'rules unreadable' });
  });

  it('survives everything failing at once', async () => {
    mockFindFirst.mockRejectedValue(new Error('db down'));
    mockScoreLeadIcp.mockRejectedValue(new Error('db down'));
    await expect(scoreNewLead({ tenantId: 't1', leadId: 'lead-1' })).resolves.toEqual({ engagementScore: null, icp: { status: 'error', message: 'db down' } });
  });

  it('passes the ICP result through when the lead is simply not scorable', async () => {
    mockScoreLeadIcp.mockResolvedValue({ status: 'not_scored', reason: 'no_icp_configured' });
    const out = await scoreNewLead({ tenantId: 't1', leadId: 'lead-1' });
    expect(out.icp).toEqual({ status: 'not_scored', reason: 'no_icp_configured' });
  });
});
