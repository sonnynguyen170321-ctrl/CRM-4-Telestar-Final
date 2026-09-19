/**
 * A paused mailbox is refused where the rep can see it, not after the composer has closed.
 *
 * Found in the 2026-09-19 role-play. A floor manager paused an SDR's mailbox under Email
 * Health. The SDR opened the composer, which said nothing, pressed Send, and `POST
 * /api/email/send` answered `200 { success: true }`. The composer toasted "queued", the lead
 * panel toasted "Email sent", and the worker — which checks the pause — wrote the row to
 * `failed` with the reason a moment later. Everything the rep was shown was wrong, and the
 * only true record was a notification they had not opened yet.
 *
 * The worker's check stays; it is the last gate. This is the first: the route knows the
 * account is paused before it queues anything, so it says so with a 409 and the composer can
 * render the reason. The lead panel's "Email sent" toast is gone for the same reason — at that
 * moment nothing has been sent, and the composer already says "queued".
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockRequireAuth = vi.fn();
const mockCanAccessLead = vi.fn();
const mockLeadFindUnique = vi.fn();
const mockSuppressionFindFirst = vi.fn();
const mockAccountFindFirst = vi.fn();
const mockCreateOutbound = vi.fn();
const mockEnqueueSend = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireAuth: (...a: unknown[]) => mockRequireAuth(...a),
  canAccessLead: (...a: unknown[]) => mockCanAccessLead(...a),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: { findUnique: (...a: unknown[]) => mockLeadFindUnique(...a) },
    suppressionEntry: { findFirst: (...a: unknown[]) => mockSuppressionFindFirst(...a) },
    emailAccount: { findFirst: (...a: unknown[]) => mockAccountFindFirst(...a) },
    template: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));
vi.mock('@/lib/email/idempotency', () => ({ newRequestId: () => 'req-1' }));
vi.mock('@/lib/workflows/email', () => ({
  createOutboundMessage: (...a: unknown[]) => mockCreateOutbound(...a),
  enqueueEmailSendWorkflow: (...a: unknown[]) => mockEnqueueSend(...a),
}));

const { POST } = await import('@/app/api/email/send/route');

const SDR = { id: 'u-sdr', tenantId: 't1', role: 'sdr', firstName: 'Lan', lastName: 'Pham' };
const LEAD = { assignedToId: 'u-sdr', campaignId: 'c1', tenantId: 't1', firstName: 'Quynh', lastName: 'Tester', company: 'QA Corp', email: 'q@qa.test' };
const ACCOUNT = { id: 'acct-1', userId: 'u-sdr', email: 'lan.pham@telestar.vn', isActive: true, sendPausedAt: null, sendPauseReason: null };

const req = (body: unknown) =>
  new NextRequest(
    new Request('https://crm.test/api/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

const send = () =>
  POST(req({ accountId: 'acct-1', to: 'q@qa.test', subject: 'Hello', body: 'Hi there', leadId: 'lead-1' }));

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuth.mockResolvedValue(SDR);
  mockCanAccessLead.mockResolvedValue(true);
  mockLeadFindUnique.mockResolvedValue(LEAD);
  mockSuppressionFindFirst.mockResolvedValue(null);
  mockAccountFindFirst.mockResolvedValue(ACCOUNT);
  mockCreateOutbound.mockResolvedValue({ id: 'out-1' });
  mockEnqueueSend.mockResolvedValue('job-1');
});

describe('POST /api/email/send with a paused mailbox', () => {
  it('queues normally when the mailbox is not paused', async () => {
    const res = await send();
    expect(res.status).toBe(200);
    expect(mockCreateOutbound).toHaveBeenCalledTimes(1);
    expect(mockEnqueueSend).toHaveBeenCalledTimes(1);
  });

  it('refuses with 409 and the reason, and queues nothing', async () => {
    mockAccountFindFirst.mockResolvedValue({ ...ACCOUNT, sendPausedAt: new Date('2026-09-19T10:00:00Z'), sendPauseReason: 'bounce spike' });

    const res = await send();
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('mailbox_paused');
    expect(json.error).toContain('lan.pham@telestar.vn');
    expect(json.error).toContain('bounce spike');
    // Nothing reaches the queue: a 409 that also queued would be the original bug with a
    // different status code.
    expect(mockCreateOutbound).not.toHaveBeenCalled();
    expect(mockEnqueueSend).not.toHaveBeenCalled();
  });

  it('refuses a pause with no recorded reason without inventing one', async () => {
    mockAccountFindFirst.mockResolvedValue({ ...ACCOUNT, sendPausedAt: new Date(), sendPauseReason: null });
    const res = await send();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Sending is paused for lan\.pham@telestar\.vn\. A manager/);
  });
});

describe('what the rep is shown', () => {
  const panel = readFileSync(join(process.cwd(), 'components', 'LeadDetailPanel.tsx'), 'utf8');
  const composer = readFileSync(join(process.cwd(), 'components', 'MailComposerModal.tsx'), 'utf8');
  const accountsRoute = readFileSync(join(process.cwd(), 'app', 'api', 'email', 'accounts', 'route.ts'), 'utf8');

  it('the lead panel no longer announces "Email sent" when a send is merely queued', () => {
    // Asserted against the source because this is a large client component and the repo has
    // no DOM test environment — the same approach as tests/linkedin-task-flow-truth.test.ts.
    expect(panel).not.toMatch(/showToast\(\s*['"]Email sent['"]/);
  });

  it('the composer disables Send and explains when the mailbox is paused', () => {
    expect(composer).toMatch(/sendPausedAt/);
    expect(composer).toMatch(/Sending is paused for/);
    expect(composer).toMatch(/disabled=\{[^}]*sendPausedAt[^}]*\}/);
  });

  it('the accounts endpoint gives the composer the pause state to render', () => {
    const select = accountsRoute.slice(accountsRoute.indexOf('select: {'), accountsRoute.indexOf('orderBy'));
    expect(select).toContain('sendPausedAt: true');
    expect(select).toContain('sendPauseReason: true');
    // And still nothing secret: the reason this select is explicit in the first place.
    expect(select).not.toMatch(/encPassword|encAccessToken|encRefreshToken|accessToken|refreshToken/);
  });
});
