/**
 * The unified inbox unifies *your* mailboxes, not the company's.
 *
 * An SDR runs campaigns from several sending addresses, and the point of the unified view is that
 * they see all of their own in one place. The query scoped by `tenantId` alone, and this
 * deployment has a single tenant, so every SDR was reading — and marking read, spamming and
 * trashing — every colleague's mail, including replies from prospects they do not own.
 *
 * Ownership runs message -> `accountId` -> `EmailAccount.userId`. Who a viewer may see is not a
 * new idea either: `getVisibleUserIds` already answers it for leads and tasks (an SDR sees only
 * themselves, a team lead their reports, a director everyone), and the inbox has to give the same
 * answer or the two surfaces disagree about the same person.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInbound = vi.fn();
const mockOutbound = vi.fn();
const mockInboundUpdate = vi.fn();
const mockOutboundUpdate = vi.fn();
const mockInboundDelete = vi.fn();
const mockVisibleUserIds = vi.fn();
const mockRequireAuth = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  getVisibleUserIds: (...a: unknown[]) => mockVisibleUserIds(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    inboundMessage: {
      findMany: (...a: unknown[]) => mockInbound(...a),
      updateMany: (...a: unknown[]) => mockInboundUpdate(...a),
      deleteMany: (...a: unknown[]) => mockInboundDelete(...a),
    },
    outboundMessage: {
      findMany: (...a: unknown[]) => mockOutbound(...a),
      updateMany: (...a: unknown[]) => mockOutboundUpdate(...a),
    },
  },
}));

const { GET, PATCH } = await import('@/app/api/inbox/route');

const SDR = { id: 'u-sdr', tenantId: 't1', role: 'sdr' };
const DIRECTOR = { id: 'u-dir', tenantId: 't1', role: 'director' };

const get = (folder = 'inbox') =>
  new NextRequest(new Request(`https://crm.test/api/inbox?folder=${folder}`));

const patch = (body: unknown) =>
  new NextRequest(
    new Request('https://crm.test/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(SDR);
  mockInbound.mockResolvedValue([]);
  mockOutbound.mockResolvedValue([]);
  mockInboundUpdate.mockResolvedValue({ count: 0 });
  mockOutboundUpdate.mockResolvedValue({ count: 0 });
  mockInboundDelete.mockResolvedValue({ count: 0 });
  mockVisibleUserIds.mockResolvedValue([SDR.id]);
});

describe('reading the inbox', () => {
  it('asks only for mail belonging to mailboxes the viewer owns', async () => {
    await GET(get());

    for (const call of [mockInbound.mock.calls[0][0], mockOutbound.mock.calls[0][0]]) {
      expect(call.where.tenantId).toBe('t1');
      expect(call.where.account, 'the query must be scoped by mailbox owner').toEqual({
        userId: { in: [SDR.id] },
      });
    }
    expect(mockVisibleUserIds).toHaveBeenCalledWith(SDR);
  });

  it('gives a team lead their reports’ mailboxes too, the same set leads use', async () => {
    mockRequireAuth.mockResolvedValue({ id: 'u-tl', tenantId: 't1', role: 'team_lead' });
    mockVisibleUserIds.mockResolvedValue(['u-tl', 'u-sdr-a', 'u-sdr-b']);

    await GET(get());

    expect(mockInbound.mock.calls[0][0].where.account).toEqual({
      userId: { in: ['u-tl', 'u-sdr-a', 'u-sdr-b'] },
    });
  });

  it('does not narrow by mailbox for a director, who sees the whole tenant', async () => {
    // `getVisibleUserIds` returns null for a director — "no user-axis restriction" — and the
    // inbox must read that as the tenant filter alone, not as an empty allow-list.
    mockRequireAuth.mockResolvedValue(DIRECTOR);
    mockVisibleUserIds.mockResolvedValue(null);

    await GET(get());

    expect(mockInbound.mock.calls[0][0].where.tenantId).toBe('t1');
    expect(mockInbound.mock.calls[0][0].where.account).toBeUndefined();
  });

  it('keeps the folder filter alongside the mailbox filter', async () => {
    await GET(get('spam'));
    const where = mockInbound.mock.calls[0][0].where;
    expect(where).toMatchObject({ isSpam: true, isTrash: false });
    expect(where.account).toEqual({ userId: { in: [SDR.id] } });
  });
});

describe('mutating the inbox', () => {
  for (const action of ['read', 'unread', 'spam', 'trash']) {
    it(`scopes the ${action} action to the viewer's own mailboxes`, async () => {
      await PATCH(patch({ messageIds: ['m1'], action }));

      expect(mockInboundUpdate).toHaveBeenCalled();
      const args = mockInboundUpdate.mock.calls[0][0];
      expect(args.where.tenantId).toBe('t1');
      expect(args.where.id).toEqual({ in: ['m1'] });
      expect(args.where.account, 'a write must be scoped the same way the read is').toEqual({
        userId: { in: [SDR.id] },
      });
    });
  }

  it('scopes a delete the same way — the destructive one most of all', async () => {
    await PATCH(patch({ messageIds: ['m1'], action: 'delete' }));

    expect(mockInboundDelete).toHaveBeenCalled();
    const args = mockInboundDelete.mock.calls[0][0];
    expect(args.where.account).toEqual({ userId: { in: [SDR.id] } });
  });

  it('lets a director act on any mailbox in the tenant', async () => {
    mockRequireAuth.mockResolvedValue(DIRECTOR);
    mockVisibleUserIds.mockResolvedValue(null);

    await PATCH(patch({ messageIds: ['m1'], action: 'read' }));

    const args = mockInboundUpdate.mock.calls[0][0];
    expect(args.where.tenantId).toBe('t1');
    expect(args.where.account).toBeUndefined();
  });
});
