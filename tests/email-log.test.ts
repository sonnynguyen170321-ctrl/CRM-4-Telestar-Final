import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { EMAIL_LOG_STATUS_GROUPS, buildEmailLogWhere, parseEmailLogFilters } from '@/lib/email/emailLog';

/**
 * Email Log (owner, 2026-10-06): "I want a detail view like the Activity tab for sent and not
 * sent, with filters, so I can track it". One table — a Sends tab per sequence and an Email Log
 * page — over OutboundMessage, scoped to the leads the viewer can see.
 */

describe('parseEmailLogFilters', () => {
  it('reads every filter the table offers, and ignores what it does not know', () => {
    const filters = parseEmailLogFilters(
      new URLSearchParams(
        'status=failed&accountId=acc-1&assignedToId=u-1&sequenceId=seq-1&step=2&campaignId=c-1' +
          '&dateFrom=2026-10-01&dateTo=2026-10-06&engagement=opened&nonsense=1'
      )
    );

    expect(filters).toEqual({
      status: 'failed',
      accountId: 'acc-1',
      assignedToId: 'u-1',
      sequenceId: 'seq-1',
      step: 2,
      campaignId: 'c-1',
      dateFrom: new Date('2026-10-01T00:00:00'),
      dateTo: new Date('2026-10-07T00:00:00'),
      engagement: 'opened',
    });
  });

  it('drops values that are not one of the allowed ones', () => {
    const filters = parseEmailLogFilters(new URLSearchParams('status=everything&step=x&engagement=liked&dateFrom=nope'));

    expect(filters).toEqual({});
  });
});

describe('buildEmailLogWhere', () => {
  const scope = { assignedToId: { in: ['u-1', 'u-2'] } };

  it('always stays inside the viewer’s leads', () => {
    expect(JSON.stringify(buildEmailLogWhere(scope, {}))).toContain(JSON.stringify({ lead: { is: scope } }));
  });

  it('maps each status group onto the outbound statuses behind it', () => {
    for (const [group, statuses] of Object.entries(EMAIL_LOG_STATUS_GROUPS)) {
      const where = JSON.stringify(buildEmailLogWhere(scope, { status: group as keyof typeof EMAIL_LOG_STATUS_GROUPS }));
      for (const status of statuses) expect(where).toContain(status);
    }
  });

  it('narrows by mailbox, rep, sequence, step, campaign, date and engagement together', () => {
    const where = JSON.stringify(
      buildEmailLogWhere(scope, {
        accountId: 'acc-1',
        assignedToId: 'u-1',
        sequenceId: 'seq-1',
        step: 2,
        campaignId: 'c-1',
        dateFrom: new Date('2026-10-01T00:00:00Z'),
        engagement: 'replied',
      })
    );

    expect(where).toContain('"accountId":"acc-1"');
    expect(where).toContain('"assignedToId":"u-1"');
    expect(where).toContain('"sequenceId":"seq-1"');
    expect(where).toContain('"sequenceStepOrder":2');
    expect(where).toContain('"campaignId":"c-1"');
    expect(where).toContain('"createdAt":{"gte":"2026-10-01T00:00:00.000Z"}');
    expect(where).toContain('"repliedAt":{"not":null}');
  });
});

describe('GET /api/email-log', () => {
  const findMany = vi.fn();
  const groupBy = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    findMany.mockReset().mockResolvedValue([]);
    groupBy.mockReset().mockResolvedValue([]);
    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        outboundMessage: { findMany: (...a: unknown[]) => findMany(...a), groupBy: (...a: unknown[]) => groupBy(...a) },
        emailAccount: { findMany: vi.fn(async () => []) },
        sequence: { findMany: vi.fn(async () => []) },
      },
    }));
    vi.doMock('@/lib/auth', () => ({
      requireAuth: async () => ({ id: 'u-tl', role: 'team_lead', tenantId: 't1' }),
      getLeadWhereScope: async () => ({ assignedToId: { in: ['u-tl', 'u-sdr'] } }),
    }));
  });

  it('lists the viewer’s sends with the filters applied, newest first, one page at a time', async () => {
    const { GET } = await import('@/app/api/email-log/route');

    const res = await GET(new NextRequest('http://localhost:3000/api/email-log?status=failed&sequenceId=seq-1'));

    expect(res.status).toBe(200);
    const query = findMany.mock.calls[0][0];
    expect(JSON.stringify(query.where)).toContain('"assignedToId":{"in":["u-tl","u-sdr"]}');
    expect(JSON.stringify(query.where)).toContain('"sequenceId":"seq-1"');
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(query.take).toBe(51);
  });

  it('counts every status group for the same filters, so the tabs show what is behind them', async () => {
    groupBy.mockResolvedValue([
      { status: 'sent', _count: { _all: 40 } },
      { status: 'permanently_failed', _count: { _all: 3 } },
      { status: 'failed', _count: { _all: 2 } },
    ]);
    const { GET } = await import('@/app/api/email-log/route');

    const body = await (await GET(new NextRequest('http://localhost:3000/api/email-log'))).json();

    expect(body.counts).toMatchObject({ sent: 40, failed: 5 });
  });
});
