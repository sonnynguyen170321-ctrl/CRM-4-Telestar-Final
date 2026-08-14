import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { EmailSendPayload } from '@/lib/bullmq/types';

const mockOutboundFindUnique = vi.fn();
const mockOutboundUpdate = vi.fn();
const mockOutboundUpdateMany = vi.fn();
const mockSuppressionFindFirst = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockLeadFindUnique = vi.fn();
const mockLeadUpdate = vi.fn();
const mockActivityCreate = vi.fn();
const mockExecuteRaw = vi.fn();
const mockServiceSend = vi.fn();
const mockEnqueueReschedule = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    outboundMessage: {
      findUnique: (...args: unknown[]) => mockOutboundFindUnique(...args),
      update: (...args: unknown[]) => mockOutboundUpdate(...args),
      updateMany: (...args: unknown[]) => mockOutboundUpdateMany(...args),
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

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueueReschedule: (...args: unknown[]) => mockEnqueueReschedule(...args),
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
    attemptCount: 0,
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
    // Dry-run is now the default when EMAIL_SEND_DRY_RUN is unset, so the real-send
    // path has to be opted into explicitly. Deleting the var would route every test
    // below into the dry-run branch and they would stop exercising the provider.
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    // The deliverability preflight reads the account before quota is reserved,
    // so every test needs a sendable account unless it is testing the gate.
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount());
    // Winning the claim is the default; races override this with count 0.
    mockOutboundUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('sends email and updates outbound message to sent', async () => {
    const payload = buildPayload();
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(1);
    mockServiceSend.mockResolvedValueOnce('provider-msg-id-123');

    const result = await handleEmailSend(payload);

    expect(result).toEqual({ success: true, outboundMessageId: 'msg-1', providerMessageId: 'provider-msg-id-123' });

    expect(mockOutboundUpdateMany).toHaveBeenCalledWith({
      where: { id: 'msg-1', status: { in: ['pending', 'failed'] } },
      data: {
        status: 'sending',
        claimedAt: expect.any(Date),
        attemptCount: { increment: 1 },
        errorMessage: null,
      },
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

  it('defers to the next quota window instead of failing when quota is exhausted', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(0);

    const result = await handleEmailSend(buildPayload());

    expect(result).toMatchObject({ deferred: true, skipped: true, reason: 'quota_exhausted' });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'pending',
        errorMessage: expect.stringContaining('Daily send limit reached — deferred to'),
      },
    });
  });

  // Returning the row to `pending` only helps if something will claim it again. Without
  // this re-enqueue the message is claimable with no job behind it, which stalls silently
  // — strictly worse than the `failed` this replaced.
  it('re-enqueues the deferred send so a quota-blocked message is not stranded', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(0);

    await handleEmailSend(buildPayload());

    expect(mockEnqueueReschedule).toHaveBeenCalledTimes(1);
    const [jobType, payload, opts] = mockEnqueueReschedule.mock.calls[0];
    expect(jobType).toBe('email.send');
    expect(payload).toMatchObject({ outboundMessageId: 'msg-1', accountId: 'acc-1' });
    expect(opts).toMatchObject({ tenantId: TENANT_ID });
    expect(opts.delay).toBeGreaterThan(0);
    // A payload-only dedupe key would collide with the job currently running and be
    // dropped by BullMQ, so the reschedule must carry a discriminator.
    expect(opts.discriminator).toMatch(/^quota:/);
  });

  it('fails the message once it has exhausted the deferral budget', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage({ attemptCount: 4 }));
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(0);

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'quota_exhausted_max_deferrals' });
    expect(mockEnqueueReschedule).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'failed',
        errorMessage: expect.stringContaining('Daily send limit reached on 5'),
      },
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

  it('respects EMAIL_SEND_DRY_RUN and marks dry run without calling external email provider', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'true';
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount());
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockSuppressionFindFirst.mockResolvedValueOnce(null);
    mockExecuteRaw.mockResolvedValueOnce(1);

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({
      success: true,
      dryRun: true,
      outboundMessageId: 'msg-1',
      providerMessageId: 'dry-run-msg-1',
    });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'sent',
        providerMessageId: 'dry-run-msg-1',
        sentAt: expect.any(Date),
        errorMessage: null,
      },
    });
    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'email_sent',
        description: expect.stringContaining('[DRY RUN]'),
        metadata: expect.objectContaining({ dryRun: true }),
      }),
    });
  });
});

/**
 * Task 3 — one CRM task must produce at most one delivered email, across crashes,
 * retries and concurrent workers. Every test here asserts on how many times the provider
 * was called, because that is the only thing the recipient experiences.
 */
describe('handleEmailSend — exactly-once delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.EMAIL_HEALTH_AUTOPAUSE;
    process.env.EMAIL_SEND_DRY_RUN = 'false';
    mockAccountFindUnique.mockResolvedValue(mockEmailAccount());
    mockOutboundUpdateMany.mockResolvedValue({ count: 1 });
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockExecuteRaw.mockResolvedValue(1);
  });

  it('lets only one of two workers racing the same message reach the provider', async () => {
    mockOutboundFindUnique.mockResolvedValue(mockOutboundMessage());
    // Both read the row as pending; the CAS decides. The loser's updateMany matches
    // nothing because the winner already moved the row out of `pending`.
    mockOutboundUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mockServiceSend.mockResolvedValue('provider-msg-id-123');

    const [first, second] = await Promise.all([
      handleEmailSend(buildPayload()),
      handleEmailSend(buildPayload()),
    ]);

    expect(mockServiceSend).toHaveBeenCalledTimes(1);
    const outcomes = [first, second];
    expect(outcomes).toContainEqual({ skipped: true, reason: 'claim_lost' });
    expect(outcomes).toContainEqual(
      expect.objectContaining({ success: true, providerMessageId: 'provider-msg-id-123' })
    );
  });

  it('does not resend a message left mid-flight with no provider confirmation', async () => {
    // The shape a crash between the provider call and the DB write leaves behind.
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'sending', providerMessageId: null })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'reconciliation_required' });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'reconciliation_required',
        errorMessage: expect.stringContaining('Ambiguous send'),
      },
    });
  });

  it('never resends a message already awaiting reconciliation', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'reconciliation_required' })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({ skipped: true, reason: 'awaiting_reconciliation' });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdateMany).not.toHaveBeenCalled();
  });

  it('never resends a permanently failed message', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'permanently_failed' })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({
      skipped: true,
      reason: 'permanently_failed',
      providerMessageId: undefined,
    });
    expect(mockServiceSend).not.toHaveBeenCalled();
  });

  it('settles a mid-flight message that did record a provider id as sent', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'sending', providerMessageId: 'prov-9', sentAt: null })
    );

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual({
      skipped: true,
      reason: 'already_sent_provider_reconcile',
      providerMessageId: 'prov-9',
    });
    expect(mockServiceSend).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'sent', sentAt: expect.any(Date) },
    });
  });

  it('parks an ambiguous provider failure for reconciliation instead of retrying it', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockServiceSend.mockRejectedValueOnce(new Error('socket hang up'));

    await expect(handleEmailSend(buildPayload())).rejects.toThrow('socket hang up');

    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'reconciliation_required',
        errorMessage: expect.stringContaining('socket hang up'),
      },
    });
  });

  /**
   * A timeout is the ambiguous failure that matters most: the provider may have accepted the
   * message and simply not answered in time. Treating it as an ordinary failure would put the
   * row back in the claimable pool and the BullMQ retry would deliver a second copy.
   */
  it('never turns a provider timeout into a resend', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockServiceSend.mockRejectedValueOnce(new Error('ETIMEDOUT: request timed out after 30000ms'));

    await expect(handleEmailSend(buildPayload())).rejects.toThrow('ETIMEDOUT');

    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: {
        status: 'reconciliation_required',
        errorMessage: expect.stringContaining('ETIMEDOUT'),
      },
    });
    // Explicitly not the claimable status — that is the bug this guards.
    expect(mockOutboundUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
    );

    // The retry BullMQ schedules finds the parked row and stops before the provider.
    mockServiceSend.mockClear();
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'reconciliation_required' })
    );

    const retry = await handleEmailSend(buildPayload());

    expect(retry).toMatchObject({ skipped: true, reason: 'awaiting_reconciliation' });
    expect(mockServiceSend).not.toHaveBeenCalled();
  });

  it('returns a definitively rejected message to the claimable pool', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockServiceSend.mockRejectedValueOnce(new Error('550 5.1.1 message rejected'));

    await expect(handleEmailSend(buildPayload())).rejects.toThrow('message rejected');

    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'failed', errorMessage: '550 5.1.1 message rejected' },
    });
  });

  /**
   * The plan's key acceptance test: the provider accepts, the DB write that records it
   * fails, and the job is processed again. The provider must have been called exactly
   * once across both passes.
   */
  it('calls the provider exactly once when the post-send DB write fails and the job reruns', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockServiceSend.mockResolvedValueOnce('provider-msg-id-123');
    mockOutboundUpdate.mockRejectedValueOnce(new Error('connection terminated'));

    await expect(handleEmailSend(buildPayload())).rejects.toThrow('connection terminated');
    expect(mockServiceSend).toHaveBeenCalledTimes(1);

    // Second pass: the row is whatever the failed write left behind — `sending`, no
    // provider id. It must route to reconciliation, not to the provider.
    mockOutboundUpdate.mockResolvedValue({});
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'sending', providerMessageId: null })
    );

    const second = await handleEmailSend(buildPayload());

    expect(second).toEqual({ skipped: true, reason: 'reconciliation_required' });
    expect(mockServiceSend).toHaveBeenCalledTimes(1);
  });

  it('does not double-count quota or activity when the same job runs twice', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockServiceSend.mockResolvedValueOnce('provider-msg-id-123');
    await handleEmailSend(buildPayload());

    // The rerun sees the row the first pass left behind.
    mockOutboundFindUnique.mockResolvedValueOnce(
      mockOutboundMessage({ status: 'sent', providerMessageId: 'provider-msg-id-123' })
    );
    await handleEmailSend(buildPayload());

    expect(mockServiceSend).toHaveBeenCalledTimes(1);
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
    expect(mockActivityCreate).toHaveBeenCalledTimes(1);
  });

  it('releases the claim rather than stranding it when the account has vanished', async () => {
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockAccountFindUnique.mockResolvedValueOnce(null);

    await expect(handleEmailSend(buildPayload())).rejects.toThrow('Email account not found');

    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'failed', errorMessage: 'Email account not found: acc-1' },
    });
  });

  it('runs the dry-run path through the same claim as a real send', async () => {
    process.env.EMAIL_SEND_DRY_RUN = 'true';
    mockOutboundFindUnique.mockResolvedValueOnce(mockOutboundMessage());
    mockLeadFindUnique.mockResolvedValueOnce({ id: 'lead-1', assignedTo: null });

    const result = await handleEmailSend(buildPayload());

    expect(result).toEqual(
      expect.objectContaining({ success: true, dryRun: true, providerMessageId: 'dry-run-msg-1' })
    );
    expect(mockOutboundUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'msg-1', status: { in: ['pending', 'failed'] } } })
    );
    expect(mockServiceSend).not.toHaveBeenCalled();
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
