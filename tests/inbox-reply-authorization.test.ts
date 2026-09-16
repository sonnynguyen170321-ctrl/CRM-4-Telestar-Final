/**
 * Replying from the inbox sends mail *as the lead's owner*.
 *
 * The route looks the lead up by id and tenant, then picks the active `EmailAccount` belonging to
 * `lead.assignedToId` and sends through it. With one tenant per deployment that made every lead
 * reachable by every authenticated user, and the resulting mail went out over a colleague's
 * address — not a read leak but an impersonated send, which cannot be taken back.
 *
 * `canAccessLead` is the answer the rest of the CRM already gives (`app/api/leads/[id]/route.ts`
 * gates on it), and the reply path has to give the same one.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRequireAuth = vi.fn();
const mockCanAccessLead = vi.fn();
const mockLeadFindFirst = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockCreateOutbound = vi.fn();
const mockEnqueueSend = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  canAccessLead: (...a: unknown[]) => mockCanAccessLead(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findFirst: (...a: unknown[]) => mockLeadFindFirst(...a) },
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
const OTHER_LEAD = { id: 'lead-9', email: 'prospect@example.test', assignedToId: 'u-colleague', campaignId: 'c1' };

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
  mockLeadFindFirst.mockResolvedValue(OTHER_LEAD);
  mockAccountFindFirst.mockResolvedValue({ id: 'acct-colleague', userId: 'u-colleague' });
  mockCreateOutbound.mockResolvedValue({ id: 'out-1' });
  mockEnqueueSend.mockResolvedValue('job-1');
});

describe('POST /api/inbox/threads/[id]/reply', () => {
  it('refuses to send on a lead the caller may not access', async () => {
    mockCanAccessLead.mockResolvedValue(false);

    const res = await POST(req({ leadId: OTHER_LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(res.status).toBe(403);
    expect(mockCreateOutbound, 'nothing may be queued for a refused caller').not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  it('checks access against the lead it actually loaded', async () => {
    mockCanAccessLead.mockResolvedValue(true);

    await POST(req({ leadId: OTHER_LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(mockCanAccessLead).toHaveBeenCalledWith(
      SDR,
      expect.objectContaining({ assignedToId: 'u-colleague' })
    );
  });

  it('still sends for a caller who owns the lead', async () => {
    mockLeadFindFirst.mockResolvedValue({ ...OTHER_LEAD, assignedToId: SDR.id });
    mockAccountFindFirst.mockResolvedValue({ id: 'acct-mine', userId: SDR.id });
    mockCanAccessLead.mockResolvedValue(true);

    const res = await POST(req({ leadId: OTHER_LEAD.id, body: 'hello', subject: 'Intro' }), params);

    expect(res.status).toBeLessThan(400);
    expect(mockEnqueueSend).toHaveBeenCalled();
  });
});
