import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The leads list is capped server-side, and now says so.
 *
 * The API defaulted to 200 (max 500) and the page rendered whatever came back with no pager and
 * no "N of M". Past 200 matching leads the pipeline simply stopped, and a manager doing a
 * headcount or a bulk assignment from that screen believed they had everyone.
 */
const mockFindMany = vi.fn();
vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(async () => ({ id: 'u1', tenantId: 't1', role: 'director' })),
  getLeadWhereScope: vi.fn(async () => ({})),
  getVisibleCampaignIds: vi.fn(async () => null),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: { lead: { findMany: (...a: unknown[]) => mockFindMany(...a) } },
}));

const { GET } = await import('@/app/api/leads/route');
const lead = (i: number) => ({ id: `l${i}`, crmPriorityScore: 'warm', engagementScore: 1, tasks: [] });

beforeEach(() => vi.clearAllMocks());

describe('GET /api/leads cap headers', () => {
  it('marks a full page as truncated', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 200 }, (_, i) => lead(i)));
    const res = await GET(new NextRequest(new Request('https://crm.test/api/leads')));
    expect(res.headers.get('X-Leads-Limit')).toBe('200');
    expect(res.headers.get('X-Leads-Truncated')).toBe('true');
  });

  it('marks a partial page as complete, and honours an explicit limit', async () => {
    mockFindMany.mockResolvedValue(Array.from({ length: 7 }, (_, i) => lead(i)));
    const res = await GET(new NextRequest(new Request('https://crm.test/api/leads?limit=50')));
    expect(res.headers.get('X-Leads-Limit')).toBe('50');
    expect(res.headers.get('X-Leads-Truncated')).toBe('false');
    expect(Array.isArray(await res.json())).toBe(true);
  });
});
