import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildLeadsQueryString } from '@/lib/hooks/useLeads';
import { buildLeadListWhere } from '@/lib/leads/listQuery';

/**
 * "1671 unassigned leads waiting in pool" (owner, 2026-10-06) counted Lead.operatingState =
 * 'unassigned' across the tenant. That column is the AI prospecting state: it defaults to
 * `unassigned` and only the AI flow moves it, so leads imported to a rep and running a sequence
 * were counted as waiting forever — including the batch the owner had just uploaded — and a team
 * lead saw the whole company's number.
 *
 * Every Lead has a rep (assignedToId is required), so a lead with no owner does not exist. What
 * nobody is working is a lead whose rep is deactivated. The banner counts those — live (not
 * archived, not won or lost), inside the viewer's lead scope — and links to a list that shows
 * exactly them; with none, it does not appear.
 */

const leadCount = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { count: (...a: unknown[]) => leadCount(...a), findMany: vi.fn(async () => []) },
    emailAccount: { findMany: vi.fn(async () => []), count: vi.fn(async () => 0) },
    sequenceEnrollment: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    task: { count: vi.fn(async () => 0), groupBy: vi.fn(async () => []) },
  },
}));

const { getWhatNeedsAttention } = await import('@/lib/ai/engine/attention-engine');

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), 'utf8');

describe('the leads-nobody-works banner', () => {
  beforeEach(() => {
    leadCount.mockReset();
    leadCount.mockResolvedValue(0);
  });

  it('counts leads whose rep is deactivated, inside the viewer’s scope, not the AI operating state', async () => {
    const podScope = { OR: [{ assignedToId: { in: ['u-tl', 'u-sdr'] } }, { campaignId: { in: ['camp-1'] } }] };

    await getWhatNeedsAttention({ userId: 'u-tl', role: 'team_lead', tenantId: 't1', leadScope: podScope });

    const where = JSON.stringify(leadCount.mock.calls[0][0].where);
    expect(where).toContain('"assignedTo":{"isActive":false}');
    expect(where).toContain('"archivedAt":null');
    expect(where).toContain(JSON.stringify(podScope));
    expect(where).not.toContain('operatingState');
  });

  it('links to the list of exactly those leads', async () => {
    leadCount.mockResolvedValueOnce(12);

    const report = await getWhatNeedsAttention({ userId: 'u-fm', role: 'floor_manager', tenantId: 't1', leadScope: {} });

    const banner = report.items.find((i) => i.category === 'unassigned_leads');
    expect(banner?.title).toBe('12 leads with a deactivated rep');
    expect(banner?.targetUrl).toBe('/leads?ownerInactive=true');
  });

  it('does not appear when every lead in scope has an active rep', async () => {
    const report = await getWhatNeedsAttention({ userId: 'u-fm', role: 'floor_manager', tenantId: 't1', leadScope: {} });

    expect(report.items.find((i) => i.category === 'unassigned_leads')).toBeUndefined();
  });
});

describe('the leads list shows what the banner counted', () => {
  it('narrows to leads whose rep is deactivated, inside the role scope', () => {
    const where = JSON.stringify(buildLeadListWhere({ campaignId: { in: ['camp-1'] } }, { ownerInactive: true }));

    expect(where).toContain('"assignedTo":{"isActive":false}');
    expect(where).toContain('"campaignId":{"in":["camp-1"]}');
  });

  it('is asked for by the page and read by the route', () => {
    expect(new URLSearchParams(buildLeadsQueryString({ ownerInactive: true })).get('ownerInactive')).toBe('true');
    expect(read('app', 'api', 'leads', 'route.ts')).toMatch(/searchParams\.get\('ownerInactive'\)/);
    expect(read('app', 'leads', 'page.tsx')).toMatch(/params\.get\('ownerInactive'\)/);
  });

  it('feeds the engine the viewer’s lead scope', () => {
    expect(read('app', 'api', 'ai', 'attention', 'route.ts')).toMatch(/leadScope:[^\n]*await getLeadWhereScope\(sessionUser\)/);
  });
});
