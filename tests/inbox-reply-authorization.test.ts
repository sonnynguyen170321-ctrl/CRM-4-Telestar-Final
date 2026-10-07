/**
 * Replying from the inbox sends mail as someone — so who may reply, and from which mailbox, is
 * settled on the server.
 *
 * The route used to pick any active mailbox of `lead.assignedToId`, gated by `canAccessLead`. Two
 * problems: the reply could leave from a different domain than the one the prospect wrote to,
 * breaking the thread; and once a reply follows its lead rather than its mailbox (owner,
 * 2026-10-07), the people who can see a conversation are not exactly the lead's viewers.
 *
 * Now: the reply goes out from the mailbox the prospect's latest message landed in, and that
 * message is looked for only inside the viewer's inbox scope (lib/inbox/scope.ts). A viewer who
 * cannot see the conversation finds no message and is refused; nothing is queued.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn();
const mockVisibleUserIds = vi.fn();
const mockInboxScope = vi.fn();
const mockLeadFindFirst = vi.fn();
const mockInboundFindFirst = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockCreateOutbound = vi.fn();
const mockEnqueueSend = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  getVisibleUserIds: (...a: unknown[]) => mockVisibleUserIds(...a),
}));
vi.mock('@/lib/inbox/scope', () => ({
  inboxScope: (...a: unknown[]) => mockInboxScope(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findFirst: (...a: unknown[]) => mockLeadFindFirst(...a) },
    inboundMessage: { findFirst: (...a: unknown[]) => mockInboundFindFirst(...a) },
    emailAccount: { findFirst: (...a: unknown[]) => mockAccountFindFirst(...a) },
  },
}));
vi.mock('@/lib/email/idempotency', () => ({ newRequestId: () => 'req-1' }));
vi.mock('@/lib/workflows/email', () => ({
  createOutboundMessage: (...a: unknown[]) => mockCreateOutbound(...a),
  enqueueEmailSendWorkflow: (...a: unknown[]) => mockEnqueueSend(...a),
}));

const { POST } = await import('@/app/api/inbox/threads/[id]/reply/route');

const SDR = { id: 'u-sdr', tenantId: 't1', role: 'sdr' };
const LEAD = { id: 'lead-9', email: 'prospect@example.test', assignedToId: 'u-sdr', campaignId: 'c1' };
const SCOPE = { inbound: { OR: [{ account: { userId: { in: ['u-sdr'] } } }] }, outbound: {} };

const req = (body: unknown) =>
  new NextRequest(
    new Request('https://crm.test/api/inbox/threads/thread-1/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const params = { params: Promise.resolve({ id: 'thread-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(SDR);
  mockVisibleUserIds.mockResolvedValue(['u-sdr']);
  mockInboxScope.mockResolvedValue(SCOPE);
  mockLeadFindFirst.mockResolvedValue(LEAD);
  mockInboundFindFirst.mockResolvedValue({ accountId: 'acct-sender' });
  mockAccountFindFirst.mockResolvedValue({ id: 'acct-sender', email: 'mei@nekko.tech', userId: 'u-team-lead' });
  mockCreateOutbound.mockResolvedValue({ id: 'out-1', to: LEAD.email, subject: 'Re: Intro', body: 'hello', createdAt: new Date() });
  mockEnqueueSend.mockResolvedValue('job-1');
});

describe('POST /api/inbox/threads/[id]/reply', () => {
  it('refuses a conversation outside the caller’s inbox scope, and queues nothing', async () => {
    mockInboundFindFirst.mockResolvedValue(null);

    const res = await POST(req({ leadId: LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(res.status).toBe(403);
    expect(mockCreateOutbound, 'nothing may be queued for a refused caller').not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  it('looks for the prospect’s latest message only inside the caller’s scope', async () => {
    await POST(req({ leadId: LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(mockInboxScope).toHaveBeenCalledWith(['u-sdr']);
    expect(mockInboundFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: 't1', leadId: LEAD.id, isBounce: false, AND: [SCOPE.inbound] },
      orderBy: { date: 'desc' },
    }));
  });

  it('replies from the mailbox the prospect wrote to, not the lead holder’s own', async () => {
    const res = await POST(req({ leadId: LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(res.status).toBeLessThan(400);
    expect(mockAccountFindFirst).toHaveBeenCalledWith({ where: { id: 'acct-sender', tenantId: 't1', isActive: true } });
    expect(mockCreateOutbound).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct-sender', to: LEAD.email }));
    expect(mockEnqueueSend).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acct-sender' }), 't1');
  });

  it('says so when that mailbox is no longer connected, rather than switching domains', async () => {
    mockAccountFindFirst.mockResolvedValue(null);

    const res = await POST(req({ leadId: LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(res.status).toBe(400);
    expect(mockCreateOutbound).not.toHaveBeenCalled();
  });

  it('refuses a lead outside the caller’s tenant', async () => {
    mockLeadFindFirst.mockResolvedValue(null);

    const res = await POST(req({ leadId: 'lead-elsewhere', body: 'hello', subject: 'Intro' }), params);

    expect(res.status).toBe(404);
    expect(mockCreateOutbound).not.toHaveBeenCalled();
  });
});
