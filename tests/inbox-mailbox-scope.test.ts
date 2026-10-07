/**
 * One person's unified inbox (owner, 2026-10-07): "everyone's inbox is a mess — split it into a
 * view per user; unify only what runs for that user's sequences; an SDR must not see mail that
 * flows in for a team lead".
 *
 * A person's inbox holds the conversations they are responsible for: mail in a mailbox they
 * connected, replies from leads they hold (whichever sender mailbox the sequence used), and replies
 * to sequences they own (lib/inbox/scope.ts). It used to be every mailbox owned by anyone the
 * viewer could see, merged into one list — a manager read the whole pod at once, and a reply that
 * landed in a team lead's sender mailbox never reached the SDR holding the lead.
 *
 * A manager now opens one rep's inbox at a time; nobody opens an inbox outside their reach.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockInbound = vi.fn();
const mockOutbound = vi.fn();
const mockInboundUpdate = vi.fn();
const mockInboundDelete = vi.fn();
const mockSequences = vi.fn();
const mockUserFindFirst = vi.fn();
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
    outboundMessage: { findMany: (...a: unknown[]) => mockOutbound(...a) },
    sequence: { findMany: (...a: unknown[]) => mockSequences(...a) },
    user: { findFirst: (...a: unknown[]) => mockUserFindFirst(...a) },
  },
}));

const { GET, PATCH } = await import('@/app/api/inbox/route');

const SDR = { id: 'u-sdr', tenantId: 't1', role: 'sdr' };
const TEAM_LEAD = { id: 'u-tl', tenantId: 't1', role: 'team_lead' };
const DIRECTOR = { id: 'u-dir', tenantId: 't1', role: 'director' };

const get = (query = 'folder=inbox') => new NextRequest(new Request(`https://crm.test/api/inbox?${query}`));

const patch = (body: unknown) =>
  new NextRequest(
    new Request('https://crm.test/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

/** The scope one person's inbox gets, given the sequences they own. */
const inboundScopeOf = (ids: string[], sequenceIds: string[] = []) => ({
  OR: [
    { account: { userId: { in: ids } } },
    { lead: { is: { assignedToId: { in: ids } } } },
    ...(sequenceIds.length ? [{ lead: { is: { sequenceId: { in: sequenceIds } } } }] : []),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(SDR);
  mockInbound.mockResolvedValue([]);
  mockOutbound.mockResolvedValue([]);
  mockInboundUpdate.mockResolvedValue({ count: 0 });
  mockInboundDelete.mockResolvedValue({ count: 0 });
  mockSequences.mockResolvedValue([]);
  mockUserFindFirst.mockResolvedValue({ id: 'found' });
  mockVisibleUserIds.mockResolvedValue([SDR.id]);
});

describe('reading an inbox', () => {
  it('shows the viewer’s own conversations: their mailboxes, their leads, their sequences', async () => {
    mockSequences.mockResolvedValue([{ id: 'seq-mine' }]);

    await GET(get());

    expect(mockSequences).toHaveBeenCalledWith({ where: { createdById: { in: [SDR.id] } }, select: { id: true } });
    const inbound = mockInbound.mock.calls[0][0].where;
    expect(inbound.tenantId).toBe('t1');
    expect(inbound.AND).toEqual([inboundScopeOf([SDR.id], ['seq-mine'])]);
    const outbound = mockOutbound.mock.calls[0][0].where;
    expect(outbound.AND).toEqual([{
      OR: [
        { account: { userId: { in: [SDR.id] } } },
        { lead: { is: { assignedToId: { in: [SDR.id] } } } },
        { sequenceId: { in: ['seq-mine'] } },
      ],
    }]);
  });

  it('gives a team lead their own inbox by default, not their pod merged', async () => {
    mockRequireAuth.mockResolvedValue(TEAM_LEAD);
    mockVisibleUserIds.mockResolvedValue(['u-tl', 'u-sdr-a', 'u-sdr-b']);

    await GET(get());

    expect(mockInbound.mock.calls[0][0].where.AND).toEqual([inboundScopeOf(['u-tl'])]);
  });

  it('lets a team lead open one of their reps’ inboxes', async () => {
    mockRequireAuth.mockResolvedValue(TEAM_LEAD);
    mockVisibleUserIds.mockResolvedValue(['u-tl', 'u-sdr-a']);

    const res = await GET(get('folder=inbox&userId=u-sdr-a'));

    expect(res.status).toBe(200);
    expect(mockInbound.mock.calls[0][0].where.AND).toEqual([inboundScopeOf(['u-sdr-a'])]);
  });

  // "An SDR must not see a team lead's mail."
  it('refuses an SDR who asks for their team lead’s inbox', async () => {
    const res = await GET(get('folder=inbox&userId=u-tl'));

    expect(res.status).toBe(403);
    expect(mockInbound).not.toHaveBeenCalled();
  });

  it('lets a director open anyone’s inbox in the tenant, and only in the tenant', async () => {
    mockRequireAuth.mockResolvedValue(DIRECTOR);
    mockVisibleUserIds.mockResolvedValue(null);

    expect((await GET(get('userId=u-sdr'))).status).toBe(200);
    expect(mockUserFindFirst).toHaveBeenCalledWith({ where: { id: 'u-sdr', tenantId: 't1' }, select: { id: true } });

    mockUserFindFirst.mockResolvedValue(null);
    expect((await GET(get('userId=u-other-tenant'))).status).toBe(404);
  });

  it('shows only conversations with leads — no bounces, no stored non-lead mail', async () => {
    await GET(get());

    expect(mockInbound.mock.calls[0][0].where).toMatchObject({ leadId: { not: null }, isBounce: false });
  });

  it('narrows to one mailbox inside the scope, never instead of it', async () => {
    await GET(get('folder=inbox&accountId=acct-7'));

    const where = mockInbound.mock.calls[0][0].where;
    expect(where.accountId).toBe('acct-7');
    expect(where.AND).toEqual([inboundScopeOf([SDR.id])]);
  });

  it('keeps the folder filter alongside the scope', async () => {
    await GET(get('folder=spam'));

    expect(mockInbound.mock.calls[0][0].where).toMatchObject({ isSpam: true, isTrash: false });
  });
});

describe('acting on messages', () => {
  for (const action of ['read', 'unread', 'spam', 'trash']) {
    it(`scopes the ${action} action to inboxes the viewer may open`, async () => {
      await PATCH(patch({ messageIds: ['m1'], action }));

      const args = mockInboundUpdate.mock.calls[0][0];
      expect(args.where).toMatchObject({ id: { in: ['m1'] }, tenantId: 't1' });
      expect(args.where.AND).toEqual([inboundScopeOf([SDR.id])]);
    });
  }

  it('scopes a delete the same way, and only to mailboxes the viewer or their reports own', async () => {
    await PATCH(patch({ messageIds: ['m1'], action: 'delete' }));

    const where = mockInboundDelete.mock.calls[0][0].where;
    expect(where.AND).toEqual([inboundScopeOf([SDR.id])]);
    // Seeing a conversation through a lead or a sequence is not owning the mailbox it sits in.
    expect(where.account).toEqual({ userId: { in: [SDR.id] } });
  });

  it('lets a manager act on their reps’ conversations', async () => {
    mockRequireAuth.mockResolvedValue(TEAM_LEAD);
    mockVisibleUserIds.mockResolvedValue(['u-tl', 'u-sdr-a']);

    await PATCH(patch({ messageIds: ['m1'], action: 'read' }));

    expect(mockInboundUpdate.mock.calls[0][0].where.AND).toEqual([inboundScopeOf(['u-tl', 'u-sdr-a'])]);
  });

  it('lets a director act anywhere in the tenant', async () => {
    mockRequireAuth.mockResolvedValue(DIRECTOR);
    mockVisibleUserIds.mockResolvedValue(null);

    await PATCH(patch({ messageIds: ['m1'], action: 'read' }));

    expect(mockInboundUpdate.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', AND: [{}] });
  });
});
