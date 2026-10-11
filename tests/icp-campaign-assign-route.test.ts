/**
 * PATCH /api/icp/campaigns/[id]: assigning or clearing a campaign's ICP is an audited admin act, and
 * the response says existing verdicts stay until the campaign is rescored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mockRequireManager = vi.fn();
const mockAssign = vi.fn();
const mockAudit = vi.fn();
const mockVisible = vi.fn();

vi.mock('@/app/api/icp/manager', () => ({
  requireIcpManager: (...a: unknown[]) => mockRequireManager(...a),
  icpAuthoringErrorResponse: () => NextResponse.json({ error: 'x' }, { status: 400 }),
}));
vi.mock('@/lib/auth', () => ({ getVisibleCampaignIds: (...a: unknown[]) => mockVisible(...a) }));
vi.mock('@/lib/api/tenant', () => ({ requireTenantId: (u: { tenantId: string }) => u.tenantId }));
vi.mock('@/lib/cache', () => ({ invalidateList: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAdminAudit: (...a: unknown[]) => mockAudit(...a) }));
vi.mock('@/lib/leadgen/icpAuthoring', () => ({ assignCampaignIcp: (...a: unknown[]) => mockAssign(...a) }));

const { PATCH } = await import('@/app/api/icp/campaigns/[id]/route');

const call = (body: unknown) =>
  PATCH(
    new NextRequest(new Request('https://crm.test/api/icp/campaigns/c1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })),
    { params: Promise.resolve({ id: 'c1' }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireManager.mockResolvedValue({ id: 'u1', tenantId: 't1', role: 'floor_manager' });
  mockVisible.mockResolvedValue(null);
  mockAssign.mockResolvedValue({ id: 'c1' });
});

describe('PATCH /api/icp/campaigns/[id]', () => {
  it('audits an assignment and says leads keep their verdicts until rescored', async () => {
    const res = await call({ icpVersionId: 'v1' });
    expect(res.status).toBe(200);
    expect(mockAssign).toHaveBeenCalledWith({ tenantId: 't1', campaignId: 'c1', icpVersionId: 'v1' });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.campaign.icp_assign', recordId: 'c1', actorId: 'u1' }));
    expect((await res.json()).note).toMatch(/until you rescore/);
  });

  it('audits a clear (null) as its own action and explains the campaign is no longer scored', async () => {
    const res = await call({ icpVersionId: null });
    expect(res.status).toBe(200);
    expect(mockAssign).toHaveBeenCalledWith({ tenantId: 't1', campaignId: 'c1', icpVersionId: null });
    expect(mockAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'admin.campaign.icp_clear' }));
    expect((await res.json()).note).toMatch(/not scored/);
  });

  it('writes no audit row when the assignment fails or the campaign is not visible', async () => {
    mockVisible.mockResolvedValue(['other']);
    expect((await call({ icpVersionId: 'v1' })).status).toBe(404);
    mockVisible.mockResolvedValue(null);
    mockAssign.mockRejectedValue(new Error('boom'));
    expect((await call({ icpVersionId: 'v1' })).status).toBe(400);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
