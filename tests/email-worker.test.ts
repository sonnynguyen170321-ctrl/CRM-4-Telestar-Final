import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { EmailSendPayload } from '@/lib/bullmq/types';

const mockOutboundFindUnique = vi.fn();
const mockOutboundUpdate = vi.fn();
const mockSuppressionFindFirst = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockLeadFindUnique = vi.fn();
const mockLeadUpdate = vi.fn();
const mockActivityCreate = vi.fn();
const mockExecuteRaw = vi.fn();
const mockServiceSend = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    outboundMessage: {
      findUnique: (...args: unknown[]) => mockOutboundFindUnique(...args),
      update: (...args: unknown[]) => mockOutboundUpdate(...args),
    },
    suppressionEntry: {
      findFirst: (...args: unknown[]) => mockSuppressionFindFirst(...args),
    },
    emailAccount: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
    },
    lead: {
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    activity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
    },
    $executeRaw: (...args: unknown[]) => mockExecuteRaw(...args),
  },
}));

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn().mockResolvedValue({
      send: (...args: unknown[]) => mockServiceSend(...args),
    }),
  },
}));

vi.mock('@/lib/templates/render', () => ({
  renderTemplate: vi.fn((val: string) => val),
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: {
    run: (_: unknown, fn: () => unknown) => fn(),
  },
}));

const { handleEmailSend, evaluateSendBlock } = await import('@/workers/email');

const TENANT_ID = 'default-tenant';

function mockOutboundMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    leadId: 'lead-1',
    accountId: 'acc-1',
    to: 'test@example.com',
    subject: 'Hello',
    body: 'World',
    status: 'pending',
    providerMessageId: null,
    tenantId: TENANT_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    lead: { campaignId: 'camp-1', assignedToId: 'user-1' },
    ...overrides,
  };
}

function buildPayload(overrides: Partial<EmailSendPayload> = {}): EmailSendPayload {
  return {
    outboundMessageId: 'msg-1',
    accountId: 'acc-1',
    to: 'test@example.com',
    subject: 'Hello',
    body: 'World',
    leadId: 'lead-1',
    templateId: 'tpl-1',
    ...overrides,
  };
}

/** A connected, unpaused, healthy mailbox — the default for every test. */
function mockEmailAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-1',
    email: 'sender@example.com',
    isActive: true,
    sendPausedAt: null,
    sendPauseReason: null,
    healthLevel: null,
    signature: null,
    ...overrides,
  };
}

describe('handleEmailSend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EMAIL_HEALTH_AUTOPAUSE;
    // The deliverability preflight reads the account before quota is reserved,
    // so every test needs a sendable account unless it is testing the gate.
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount());
  });

  it('sends email and updates outbound message to sent', async () => {
    const payload = buildPayload();
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(1);
    mockServiceSend.mockResolvedValueOnce('provider-msg-id-123');

    const result = await handleEmailSend(payload);

    expect(result).toEqual({ success: true, outboundMessageId: 'msg-1', providerMessageId: 'provider-msg-id-123' });

    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'sending' },
    });
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'sent', providerMessageId: 'provider-msg-id-123', sentAt: expect.any(Date) },
    });
    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 'lead-1',
        type: 'email_sent',
        userId: 'user-1',
      }),
    });
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { lastContactedAt: expect.any(Date) },
    });
  });

  it('skips if already sent with providerMessageId', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'sent', providerMessageId: 'abc-123' })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'already_sent', providerMessageId: 'abc-123' });
    expect(mockServiceSend).not.toHaveBeenCalled();
  });

  it('skips if sending with providerMessageId (reconciliation)', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'sending', providerMessageId: 'abc-123' })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'already_sent_provider_reconcile', providerMessageId: 'abc-123' });
    expect(mockServiceSend).not.toHaveBeenCalled();
  });

  it('skips if recipient is suppressed', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce({ reason: 'unsubscribed', email: 'test@example.com' });

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'suppressed' });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'failed', errorMessage: 'Recipient suppressed: unsubscribed' },
    });
  });

  it('skips if quota exhausted', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(0);

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'quota_exhausted' });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'failed', errorMessage: 'Daily send limit reached' },
    });
  });

  it('sends without leadId if payload omits it', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage({ lead: { campaignId: null, assignedToId: 'system' } }));
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(1);
    mockServiceSend.mockResolvedValueOnce(undefined);

    const result = await handleEmailSend(buildPayload({ leadId: undefined }));

    expect(result).toEqual({ success: true, outboundMessageId: 'msg-1', providerMessageId: undefined });
    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'system' }),
    });
  });

  it('throws and marks failed on send error', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(1);
    mockServiceSend.mockRejectedValueOnce(new Error('SMTP connection refused'));

    await expect(handleEmailSend(buildPayload())).rejects.toThrow('SMTP connection refused');

    const failedUpdate = mockOutboundUpdate.mock.calls.find(
      (args: any[]) => args[0]?.data?.status === 'failed'
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate![0].data.errorMessage).toBe('SMTP connection refused');
  });
});

describe('handleEmailSend — deliverability send gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EMAIL_HEALTH_AUTOPAUSE;
    mockOutboundFindUnique.mockResolvedValue(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockExecuteRaw.mockResolvedValue(1);
  });

  it('blocks a manager-paused inbox without consuming daily quota', async () => {
    mockAccountFindUnique.mockResolvedValue(
      mockEmailAccount({ sendPausedAt: new Date(), sendPauseReason: 'bounce spike' })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'account_paused' });
    expect(mockServiceSend).not.toHaveBeenCalled();
    // The gate must run before atomicReserveQuota, or a paused inbox silently
    // burns a send slot it can never use (quota is never refunded).
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'failed', errorMessage: 'Sending is paused for this inbox: bounce spike' },
    });
  });

  it('blocks an inactive inbox without consuming quota', async () => {
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount({ isActive: false }));

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'account_inactive' });
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockServiceSend).not.toHaveBeenCalled();
  });

  it('does NOT block a critical inbox while auto-pause is off', async () => {
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount({ healthLevel: 'critical' }));
    mockServiceSend.mockResolvedValueOnce('provider-msg-id-456');

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({
      success: true,
      outboundMessageId: 'msg-1',
      providerMessageId: 'provider-msg-id-456',
    });
    expect(mockServiceSend).toHaveBeenCalled();
  });

  it('blocks a critical inbox once auto-pause is enabled', async () => {
    process.env.EMAIL_HEALTH_AUTOPAUSE = 'true';
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount({ healthLevel: 'critical' }));

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'health_critical' });
    expect(mockExecuteRaw).not.toHaveBeenCalled();
    expect(mockServiceSend).not.toHaveBeenCalled();
  });

  it('lets an at_risk inbox send even with auto-pause enabled', async () => {
    process.env.EMAIL_HEALTH_AUTOPAUSE = 'true';
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount({ healthLevel: 'at_risk' }));
    mockServiceSend.mockResolvedValueOnce('provider-msg-id-789');

    const result = await handleEmailSend(buildPayload());

    expect(result).toMatchObject({ success: true });
    expect(mockServiceSend).toHaveBeenCalled();
  });

  it('still applies the suppression gate before touching the account', async () => {
    mockSuppressionFindFirst.mockResolvedValue({ reason: 'hard_bounce' });
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount({ sendPausedAt: new Date() }));

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'suppressed' });
  });
});

describe('evaluateSendBlock', () => {
  beforeEach(() => {
    delete process.env.EMAIL_HEALTH_AUTOPAUSE;
  });

  const base = { isActive: true, sendPausedAt: null, sendPauseReason: null, healthLevel: null };

  it('allows a healthy, active, unpaused inbox', () => {
    expect(evaluateSendBlock(base)).toBeNull();
  });

  it('reports inactive before paused when both apply', () => {
    const result = evaluateSendBlock({ ...base, isActive: false, sendPausedAt: new Date() });
    expect(result?.reason).toBe('account_inactive');
  });

  it('omits the colon when a pause has no stated reason', () => {
    const result = evaluateSendBlock({ ...base, sendPausedAt: new Date() });
    expect(result?.errorMessage).toBe('Sending is paused for this inbox');
  });

  it('treats any value other than the literal "true" as auto-pause off', () => {
    process.env.EMAIL_HEALTH_AUTOPAUSE = '1';
    expect(evaluateSendBlock({ ...base, healthLevel: 'critical' })).toBeNull();
  });
});
