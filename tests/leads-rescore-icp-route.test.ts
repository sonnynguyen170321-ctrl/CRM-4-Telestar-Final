/**
 * `POST /api/leads/rescore-icp` — the manager's way to score leads that predate ICP-on-Lead,
 * and to re-run after a rule change.
 *
 * The runtime is covered against real Postgres in tests/lead-icp-scoring.test.ts; this pins
 * the route's edges: who may call it, that the body is validated with bounds, that it runs
 * inside the caller's tenant, and that the report comes back whole.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn();
const mockRescore = vi.fn();
const mockTenantRun = vi.fn();

vi.mock('@/lib/auth', () => ({ requireAuth: (...a: unknown[]) => mockRequireAuth(...a) }));
vi.mock('@/lib/leads/icpScoring', () => ({
  rescoreLeadsIcp: (...a: unknown[]) => mockRescore(...a),
  RESCORE_LEADS_BATCH_LIMIT: 500,
}));
vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: { run: (...a: unknown[]) => mockTenantRun(...a) },
}));

const { POST } = await import('@/app/api/leads/rescore-icp/route');

const MANAGER = { id: 'u-fm', tenantId: 't1', role: 'floor_manager' };
const SDR = { id: 'u-sdr', tenantId: 't1', role: 'sdr' };

const req = (body: unknown) =>
  new NextRequest(new Request('https://crm.test/api/leads/rescore-icp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(MANAGER);
  mockTenantRun.mockImplementation(async (_ctx: unknown, fn: () => Promise<unknown>) => fn());
  mockRescore.mockResolvedValue({ considered: 3, scored: 2, notScored: 1, reasons: { no_icp_configured: 1 }, truncated: false });
});

describe('POST /api/leads/rescore-icp', () => {
  it('refuses an SDR', async () => {
    mockRequireAuth.mockResolvedValue(SDR);
    const res = await POST(req({}));
    expect(res.status).toBe(403);
    expect(mockRescore).not.toHaveBeenCalled();
  });

  it('runs inside the caller\'s tenant and returns the report', async () => {
    const res = await POST(req({ campaignId: 'c1', onlyUnscored: false, limit: 50 }));
    expect(res.status).toBe(200);
    expect(mockTenantRun).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1' }), expect.any(Function));
    expect(mockRescore).toHaveBeenCalledWith({ tenantId: 't1', campaignId: 'c1', onlyUnscored: false, limit: 50 });
    expect(await res.json()).toMatchObject({ success: true, considered: 3, scored: 2, notScored: 1, reasons: { no_icp_configured: 1 } });
  });

  it('defaults to every unscored lead in the tenant', async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(mockRescore).toHaveBeenCalledWith({ tenantId: 't1', campaignId: undefined, onlyUnscored: undefined, limit: undefined });
  });

  it('rejects a limit above the batch ceiling instead of clamping silently', async () => {
    const res = await POST(req({ limit: 5000 }));
    expect(res.status).toBe(400);
    expect(mockRescore).not.toHaveBeenCalled();
  });
});
