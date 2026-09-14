import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The inbox reads a bounded window and says when it was full.
 *
 * It used to load the tenant's entire message history, both directions, with a lead join, on
 * every folder change, and thread it in memory. With Postgres now sharing a box with the web
 * and worker containers, an unbounded read here slowed everything else down too. The body stays
 * a bare array (the client indexes it), so the window state travels in response headers.
 */
const mockInbound = vi.fn();
const mockOutbound = vi.fn();
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn(async () => ({ id: 'u1', tenantId: 't1', role: 'sdr' })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    inboundMessage: { findMany: (...a: unknown[]) => mockInbound(...a) },
    outboundMessage: { findMany: (...a: unknown[]) => mockOutbound(...a) },
  },
}));

const { GET } = await import('@/app/api/inbox/route');
const req = (folder = 'inbox') => new NextRequest(new Request(`https://crm.test/api/inbox?folder=${folder}`));

const inbound = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `in-${i}`, fromEmail: 'a@b.c', fromName: 'A', to: 'me@x.y', subject: `s${i}`, body: '', bodyHtml: null,
    providerMessageId: null, date: new Date(2026, 0, 1, 0, i), isRead: true, isSpam: false, isTrash: false,
    replyClass: null, replyKind: null, replyConfidence: null, classificationSource: null, lead: null,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mockOutbound.mockResolvedValue([]);
});

describe('GET /api/inbox', () => {
  it('asks the database for a bounded window in both directions', async () => {
    mockInbound.mockResolvedValue([]);
    await GET(req());
    expect(mockInbound.mock.calls[0][0]).toMatchObject({ take: 500 });
    expect(mockOutbound.mock.calls[0][0]).toMatchObject({ take: 500 });
  });

  it('reports a full window as truncated', async () => {
    mockInbound.mockResolvedValue(inbound(500));
    const res = await GET(req());
    expect(res.headers.get('X-Inbox-Truncated')).toBe('true');
    expect(res.headers.get('X-Inbox-Window')).toBe('500');
    expect(Array.isArray(await res.json())).toBe(true);
  });

  it('reports a partial window as complete', async () => {
    mockInbound.mockResolvedValue(inbound(12));
    const res = await GET(req());
    expect(res.headers.get('X-Inbox-Truncated')).toBe('false');
  });
});
