import { vi, describe, it, expect, beforeEach } from 'vitest';

// --- Prisma mocks ---
const mockLeadFindUnique = vi.fn();
const mockLeadFindFirst = vi.fn();
const mockLeadFindMany = vi.fn();
const mockLeadUpdate = vi.fn();
const mockAccountFindUnique = vi.fn();
const mockAccountUpdate = vi.fn();
const mockNotificationCreate = vi.fn();
const mockActivityCreate = vi.fn();
const mockActivityFindFirst = vi.fn().mockResolvedValue(null);
const mockTaskCreate = vi.fn();
const mockSuppressionFindFirst = vi.fn();
const mockSuppressionCreate = vi.fn();
const mockInboundFindUnique = vi.fn();
const mockInboundCreate = vi.fn();
const mockOutboundFindFirst = vi.fn();
const mockOutboundFindMany = vi.fn().mockResolvedValue([]);
const mockOutboundUpdate = vi.fn();
const mockLeadUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockTaskUpdateManyOcc = vi.fn().mockResolvedValue({ count: 0 });
const mockEnrollmentFindFirst = vi.fn();
const mockEnrollmentUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockHandoff = vi.fn();

const mockInboundUpdate = vi.fn();
const mockInboundUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
const mockInboundFindFirst = vi.fn().mockResolvedValue(null);
const mockClassifyReply = vi.fn();
const mockApplyClassification = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    lead: {
      updateMany: (...a: unknown[]) => mockLeadUpdateMany(...a),
      findUnique: (...args: unknown[]) => mockLeadFindUnique(...args),
      findFirst: (...args: unknown[]) => mockLeadFindFirst(...args),
      findMany: (...args: unknown[]) => mockLeadFindMany(...args),
      update: (...args: unknown[]) => mockLeadUpdate(...args),
    },
    emailAccount: {
      findUnique: (...args: unknown[]) => mockAccountFindUnique(...args),
      update: (...args: unknown[]) => mockAccountUpdate(...args),
    },
    notification: {
      create: (...args: unknown[]) => mockNotificationCreate(...args),
    },
    activity: {
      create: (...args: unknown[]) => mockActivityCreate(...args),
      // handleApplyBounce dedupes the timeline entry on the provider's event id, so a
      // redelivered webhook does not record the same bounce twice. Defaults to "not seen".
      findFirst: (...args: unknown[]) => mockActivityFindFirst(...args),
    },
    task: {
      updateMany: (...a: unknown[]) => mockTaskUpdateManyOcc(...a),
      create: (...args: unknown[]) => mockTaskCreate(...args),
    },
    suppressionEntry: {
      findFirst: (...args: unknown[]) => mockSuppressionFindFirst(...args),
      create: (...args: unknown[]) => mockSuppressionCreate(...args),
    },
    inboundMessage: {
      findUnique: (...args: unknown[]) => mockInboundFindUnique(...args),
      create: (...args: unknown[]) => mockInboundCreate(...args),
      update: (...args: unknown[]) => mockInboundUpdate(...args),
      updateMany: (...args: unknown[]) => mockInboundUpdateMany(...args),
      findFirst: (...args: unknown[]) => mockInboundFindFirst(...args),
    },
    outboundMessage: {
      findFirst: (...args: unknown[]) => mockOutboundFindFirst(...args),
      findMany: (...args: unknown[]) => mockOutboundFindMany(...args),
      update: (...args: unknown[]) => mockOutboundUpdate(...args),
    },
    sequenceEnrollment: {
      findFirst: (...args: unknown[]) => mockEnrollmentFindFirst(...args),
      // A bounce now stops every running cadence on the lead (lib/sequences/leadStop.ts), which
      // lists them first. Each test arranges the single enrollment it cares about through
      // `findFirst`; the list is that same row, so the arrangement keeps meaning what it says.
      findMany: async (...args: unknown[]) => {
        const row = await mockEnrollmentFindFirst(...args);
        return row ? [row] : [];
      },
      // The reply/bounce paths pause each occurrence they resolved with a conditional
      // updateMany rather than a lead-scoped helper.
      updateMany: (...args: unknown[]) => mockEnrollmentUpdateMany(...args),
    },
  },
}));

// Ownership moves through the transition service, which owns the task, the notification, the
// ledger row and the activity. Mocked here so these tests assert the reply path's decisions
// rather than re-testing the transition primitive.
vi.mock('@/lib/prospects/ownership', () => ({
  handoffProspectToHuman: (...args: unknown[]) => mockHandoff(...args),
}));

// Classification and its consequences have their own suite (tests/phase-8b-replies.test.ts).
// Here they are stubbed so these tests assert what sync *routes*, not what a class does.
vi.mock('@/lib/replies/classification', () => ({
  classifyReply: (...args: unknown[]) => mockClassifyReply(...args),
  classifyDeterministic: vi.fn(),
}));

vi.mock('@/lib/replies/handling', () => ({
  applyReplyClassification: (...args: unknown[]) => mockApplyClassification(...args),
}));

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn(),
  },
}));

vi.mock('@/lib/sequences/engine', () => ({
  pauseSequence: vi.fn(),
}));

vi.mock('@/lib/sequences/lifecycle', () => ({
  pauseEnrollmentOccurrence: vi.fn(),
  resumeEnrollmentOccurrence: vi.fn(),
}));

vi.mock('@/lib/email/bounceDetection', () => ({
  isBounceMessage: vi.fn(),
  isAutoReply: vi.fn(),
  extractBouncedRecipient: vi.fn(),
}));

vi.mock('@/lib/tenant-context', () => ({
  tenantStorage: {
    run: (_: unknown, fn: () => unknown) => fn(),
  },
}));

const { handleApplyReply, handleApplyBounce, handleEmailSync } = await import('@/workers/sync');
const { pauseEnrollmentOccurrence } = await import('@/lib/sequences/lifecycle');
const { isBounceMessage, isAutoReply, extractBouncedRecipient } = await import('@/lib/email/bounceDetection');
const { EmailService } = await import('@/lib/email/EmailService');

describe('handleApplyReply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockResolvedValue({ id: 'inbound-1' });
    mockOutboundFindFirst.mockResolvedValue(null);
    // The authoritative gate: an active enrollment, not the legacy Lead.sequenceStatus cache.
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', sequenceId: 'seq-1' });
    mockHandoff.mockResolvedValue({ applied: true, state: 'human_attention', transitionId: 'tr-1' });
    // Default: an ordinary sales reply that hands the prospect to the SDR.
    mockClassifyReply.mockResolvedValue({
      replyClass: 'C', kind: 'interest', confidence: 0.9, source: 'ai', rationale: 'Interested.',
    });
    mockApplyClassification.mockResolvedValue({ cadence: 'paused', handedOff: true });
    mockInboundUpdate.mockResolvedValue({});
    // clearAllMocks resets recorded calls but not implementations, so a rejection set in one
    // test would leak into every test after it. Re-establish the default each time.
    (pauseEnrollmentOccurrence as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });
  });

  const baseLead = {
    id: 'lead-1', stage: 'contacted', tenantId: 'tenant-1',
    assignedToId: 'user-1', firstName: 'John', lastName: 'Doe', company: 'Acme',
  };

  it('leaves a later stage alone and records no stage change when a meeting-booked lead replies', async () => {
    mockLeadFindUnique.mockResolvedValue({ ...baseLead, stage: 'meeting_booked' });
    // The forward-only stage write matches nothing for a lead already past "replied".
    mockLeadUpdateMany.mockResolvedValueOnce({ count: 0 });

    await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    const types = mockActivityCreate.mock.calls.map((call) => (call[0] as { data: { type: string } }).data.type);
    expect(types).not.toContain('stage_changed');
    expect(types).toContain('email_replied');
  });

  it('records a sales reply and hands the classified prospect onward', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(result).toMatchObject({
      success: true,
      leadId: 'lead-1',
      providerMessageId: 'msg-1',
      pauseOutcome: 'paused',
      handoffApplied: true,
      replyClass: 'C',
      replyKind: 'interest',
    });
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { emailReplyCount: { increment: 1 } },
    });
    // Forward only: the stage moves to replied from new / sequence_active, never back from later.
    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', stage: { in: ['new', 'sequence_active'] } },
      data: { stage: 'replied' },
    });
    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 'lead-1', type: 'stage_changed', channel: 'email',
        metadata: expect.objectContaining({ to: 'replied', providerMessageId: 'msg-1' }),
      }),
    });
    // The exact occurrence travels to the class handler; nothing downstream re-reads
    // `Lead.sequenceId` to decide what to pause.
    expect(mockApplyClassification).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        tenantId: 'tenant-1',
        eventId: 'msg-1',
        enrollment: { id: 'enr-1', sequenceId: 'seq-1' },
      })
    );
    expect(mockTaskCreate).not.toHaveBeenCalled();
    expect(mockNotificationCreate).not.toHaveBeenCalled();
  });

  it('persists the classification onto the inbound message', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockInboundFindUnique.mockResolvedValue({ id: 'inb-1', subject: 'Re:', body: 'hi', isReply: true });

    await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    // The inbound row *is* the conversation record — there is no second store to reconcile.
    expect(mockInboundUpdate).toHaveBeenCalledWith({
      where: { id: 'inb-1' },
      data: expect.objectContaining({ replyClass: 'C', replyKind: 'interest', classificationSource: 'ai' }),
    });
  });

  it('does not count an administrative reply as a sales reply', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockClassifyReply.mockResolvedValue({
      replyClass: 'B', kind: 'out_of_office', confidence: 1, source: 'deterministic', rationale: 'OOO.',
    });
    mockApplyClassification.mockResolvedValue({ cadence: 'paused', handedOff: false, resumeAt: new Date() });

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', autoReply: true });

    expect(result).toMatchObject({ replyClass: 'B', handoffApplied: false });
    // No stage move, no reply counter, no attribution to the originating send: an inbox full of
    // out-of-office responders must not move reply rate.
    expect(mockLeadUpdate).not.toHaveBeenCalled();
    expect(mockOutboundUpdate).not.toHaveBeenCalled();
    expect(mockActivityCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'email_replied' }) })
    );
  });

  it('still reports the outcome when there was no active cadence to pause', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockApplyClassification.mockResolvedValue({ cadence: 'no_enrollment', handedOff: true });

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    // Not a failed handoff: the prospect engaged, so the SDR still needs them.
    expect(result).toMatchObject({ success: true, pauseOutcome: 'not_active', handoffApplied: true });
  });

  it('lets a handling failure surface instead of swallowing it', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockApplyClassification.mockRejectedValueOnce(new Error('db down'));

    await expect(
      handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' })
    ).rejects.toThrow('db down');
  });

  it('skips if lead not found', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(result).toEqual({ skipped: true, reason: 'lead_not_found' });
    expect(mockLeadUpdate).not.toHaveBeenCalled();
    expect(pauseEnrollmentOccurrence).not.toHaveBeenCalled();
  });

  it('skips if provider message already processed', async () => {
    mockLeadFindUnique.mockResolvedValue({ ...baseLead, stage: 'replied' });
    mockInboundFindUnique.mockResolvedValue({ id: 'inb-1', classifiedAt: new Date() });

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(result).toEqual({ skipped: true, reason: 'already_processed' });
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('skips when there is no active enrollment', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockEnrollmentFindFirst.mockResolvedValue(null);

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(result).toEqual({ skipped: true, reason: 'sequence_not_active' });
    expect(mockLeadUpdate).not.toHaveBeenCalled();
    expect(mockHandoff).not.toHaveBeenCalled();
  });

  it('gates on the enrollment, not the legacy Lead.sequenceStatus cache', async () => {
    // The cache says the run is dead; the authoritative enrollment says it is active. A stale
    // cache must not be able to drop a real prospect reply before the handoff is reached.
    mockLeadFindUnique.mockResolvedValue({ ...baseLead, sequenceStatus: 'paused' });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', sequenceId: 'seq-1' });

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(result).toMatchObject({ success: true });
    expect(mockApplyClassification).toHaveBeenCalledOnce();

    // And the reply path must not read the cache at all any more.
    const selected = JSON.stringify(mockLeadFindUnique.mock.calls[0][0]);
    expect(selected).not.toMatch(/sequenceStatus/);
  });

  // --- P0 deliverability data capture ---

  it('stamps repliedAt on the originating send so reply rate is computable', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockOutboundFindFirst.mockResolvedValue({ id: 'out-9' });

    await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(mockOutboundFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: 'lead-1', accountId: 'acct-1', status: 'sent', repliedAt: null },
        orderBy: { sentAt: 'desc' },
      })
    );
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'out-9' },
      data: { repliedAt: expect.any(Date) },
    });
  });

  it('emits an email_replied activity alongside stage_changed', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);

    await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    const types = mockActivityCreate.mock.calls.map((c) => (c[0] as { data: { type: string } }).data.type);
    expect(types).toContain('stage_changed');
    expect(types).toContain('email_replied');
  });

  it('does not blow up when no originating send can be matched', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockOutboundFindFirst.mockResolvedValue(null);

    const result = await handleApplyReply({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1' });

    expect(result).toMatchObject({ success: true, leadId: 'lead-1', providerMessageId: 'msg-1' });
    expect(mockOutboundUpdate).not.toHaveBeenCalled();
  });
});

describe('handleApplyBounce', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockResolvedValue({ id: 'inbound-1' });
    mockOutboundFindFirst.mockResolvedValue(null);
  });

  const baseLead = {
    id: 'lead-1', email: 'john@acme.com', firstName: 'John', lastName: 'Doe',
    company: 'Acme', sequenceId: 'seq-1', assignedToId: 'user-1',
    tags: [], emailInvalid: false, tenantId: 'tenant-1',
  };

  it('hard bounce: marks emailInvalid, creates SuppressionEntry, pauses sequence', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockAccountFindUnique.mockResolvedValue({ tenantId: 'tenant-1' });

    const result = await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard',
    });

    expect(result).toEqual({ success: true, leadId: 'lead-1', bounceType: 'hard', providerMessageId: 'msg-1' });
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { emailInvalid: true, tags: { push: 'invalid-email' } },
    });
    // `campaignId: null` is the tenant-wide form. Written per campaign, as it used to be, a
    // dead address stayed reachable by every other campaign in the tenant.
    expect(mockSuppressionCreate).toHaveBeenCalledWith({
      data: { email: 'john@acme.com', reason: 'hard_bounce', tenantId: 'tenant-1', campaignId: null },
    });
    expect(pauseEnrollmentOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', reason: 'hard_bounce', actorUserId: 'user-1' })
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
  });

  it('soft bounce: suppresses too, because any bounce costs sender reputation', async () => {
    // Policy change, 2026-09-23, chosen by the operator after a mailbox's health score fell.
    // A soft bounce used to be treated as transient and the address stayed in the pool — which
    // in practice meant the same full or disabled mailbox was written to again on the next
    // step, and the provider counted every one of those attempts against the sending domain.
    // The trade is explicit: a mailbox that was only temporarily full is lost, and the
    // reputation is kept.
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockAccountFindUnique.mockResolvedValue({ tenantId: 'tenant-1' });

    const result = await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'soft',
    });

    expect(result).toEqual({ success: true, leadId: 'lead-1', bounceType: 'soft', providerMessageId: 'msg-1' });
    expect(mockSuppressionCreate).toHaveBeenCalledWith({
      data: { email: 'john@acme.com', reason: 'soft_bounce', tenantId: 'tenant-1', campaignId: null },
    });
    // A soft bounce still pauses for its own reason, so the operator console can tell the two
    // apart even though both now stop the sending.
    expect(pauseEnrollmentOccurrence).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', reason: 'soft_bounce', actorUserId: 'user-1' })
    );
    expect(mockNotificationCreate).toHaveBeenCalled();
  });

  it('skips if lead not found', async () => {
    mockLeadFindUnique.mockResolvedValue(null);

    const result = await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard',
    });

    expect(result).toEqual({ skipped: true, reason: 'lead_not_found' });
    expect(mockLeadUpdate).not.toHaveBeenCalled();
  });

  it('still ensures the suppression when the lead is already marked invalid', async () => {
    // This used to return early on `emailInvalid`, which is one of the reasons production ran a
    // month with `emailInvalid` set on nobody and `SuppressionEntry` empty: any lead that
    // reached the flag by another route could never gain the suppression that actually stops
    // the sending. The lead-level writes are still skipped — they are already applied — but the
    // suppression is ensured every time.
    mockLeadFindUnique.mockResolvedValue({ ...baseLead, emailInvalid: true });
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockAccountFindUnique.mockResolvedValue({ tenantId: 'tenant-1' });

    const result = await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard',
    });

    expect(result).toMatchObject({ success: true, leadId: 'lead-1' });
    expect(mockLeadUpdate, 'the flag is already set; nothing to write').not.toHaveBeenCalled();
    expect(mockSuppressionCreate).toHaveBeenCalled();
  });

  it('does not create duplicate SuppressionEntry if one already exists', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockSuppressionFindFirst.mockResolvedValue({ id: 'existing-sup' });

    const result = await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard',
    });

    expect(result.success).toBe(true);
    expect(mockSuppressionCreate).not.toHaveBeenCalled();
  });

  // --- P0 deliverability data capture ---

  // Review finding, 2026-10-09: a step sent after the bounce but before the sync read it was the one
  // marked bounced. The send a bounce answers is the latest one before the bounce arrived.
  it('marks the send the bounce answers — the latest before it arrived — with the bounce time', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockOutboundFindFirst.mockResolvedValue({ id: 'out-step1' });
    const receivedAt = '2026-10-08T03:10:00.000Z';

    await handleApplyBounce({ providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard', receivedAt });

    expect(mockOutboundFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { accountId: 'acct-1', to: { equals: 'john@acme.com', mode: 'insensitive' }, status: 'sent', sentAt: { lte: new Date(receivedAt) } },
    }));
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'out-step1' },
      data: { status: 'bounced', bouncedAt: new Date(receivedAt), bounceType: 'hard' },
    });
  });

  it('flips the originating send to bounced so bounce rate is computable', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockOutboundFindFirst.mockResolvedValue({ id: 'out-7' });

    await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard',
    });

    expect(mockOutboundFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: 'acct-1', to: { equals: 'john@acme.com', mode: 'insensitive' }, status: 'sent' },
        orderBy: { sentAt: 'desc' },
      })
    );
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'out-7' },
      data: { status: 'bounced', bouncedAt: expect.any(Date), bounceType: 'hard' },
    });
  });

  it('still marks the send bounced when the lead is already invalid', async () => {
    // A second send to a known-bad address must record its own bounce, even though
    // the lead-level side effects are correctly skipped as already applied.
    mockLeadFindUnique.mockResolvedValue({ ...baseLead, emailInvalid: true });
    mockOutboundFindFirst.mockResolvedValue({ id: 'out-8' });
    mockSuppressionFindFirst.mockResolvedValue({ id: 'existing-sup' });

    const result = await handleApplyBounce({
      providerMessageId: 'msg-2', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'hard',
    });

    expect(result).toMatchObject({ success: true, leadId: 'lead-1' });
    expect(mockOutboundUpdate).toHaveBeenCalledWith({
      where: { id: 'out-8' },
      data: { status: 'bounced', bouncedAt: expect.any(Date), bounceType: 'hard' },
    });
    // Already suppressed, so nothing new is written — the ensure is idempotent.
    expect(mockSuppressionCreate).not.toHaveBeenCalled();
  });

  it('emits an email_bounced activity for both hard and soft bounces', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead);

    await handleApplyBounce({
      providerMessageId: 'msg-1', leadId: 'lead-1', accountId: 'acct-1', bounceType: 'soft',
    });

    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        leadId: 'lead-1', type: 'email_bounced', channel: 'email',
        metadata: expect.objectContaining({ bounceType: 'soft' }),
      }),
    });
  });
});

describe('handleEmailSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockResolvedValue({ id: 'inbound-1' });
    mockOutboundFindFirst.mockResolvedValue(null);
    mockOutboundFindMany.mockResolvedValue([]);
    mockLeadFindMany.mockResolvedValue([]);
  });

  const mockAccount = {
    id: 'acct-1', isActive: true, userId: 'user-1', email: 'sdr@example.com',
    provider: 'gmail', lastSyncAt: null, tenantId: 'tenant-1',
  };

  // Owner, 2026-10-09: the run that stopped at the read limit used to move the cursor to now, and
  // everything it had not read was never read.
  it('moves the cursor only to the last message read when the run stopped at the limit', async () => {
    const receivedAt = new Date(Date.now() - 60_000);
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue({
        messages: [{ providerMessageId: 'g-1', fromEmail: 'news@shop.com', subject: 'Sale', date: new Date(0), receivedAt }],
        truncated: true,
      }),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(result, JSON.stringify(result)).toMatchObject({ success: true, truncated: true });
    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { lastSyncAt: new Date(receivedAt.getTime() - 1000) },
    });
  });

  it('returns skipped if account not found', async () => {
    mockAccountFindUnique.mockResolvedValue(null);

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(result).toEqual({ skipped: true, reason: 'account_not_found' });
  });

  it('returns skipped if account is inactive', async () => {
    mockAccountFindUnique.mockResolvedValue({ ...mockAccount, isActive: false });

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(result).toEqual({ skipped: true, reason: 'account_inactive' });
  });

  it('returns skipped if adapter does not support sync', async () => {
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue(null),
    });

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(result).toEqual({ skipped: true, reason: 'adapter_does_not_support_sync' });
    expect(mockAccountUpdate).toHaveBeenCalledWith({
      where: { id: 'acct-1' },
      data: { lastSyncAt: expect.any(Date) },
    });
  });

  it('processes bounce messages', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-1',
      fromEmail: 'mailer-daemon@google.com',
      subject: 'Delivery Status Notification (Failure)',
      date: new Date(),
      failedRecipient: 'lead@acme.com',
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('lead@acme.com');
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'lead@acme.com', firstName: 'Lead', lastName: 'Test',
      company: 'Acme', sequenceId: 'seq-1', assignedToId: 'user-1',
      tags: [], emailInvalid: false, tenantId: 'tenant-1',
    }]);
    mockSuppressionFindFirst.mockResolvedValue(null);
    mockAccountFindUnique
      .mockResolvedValueOnce(mockAccount)   // first call in handleEmailSync
      .mockResolvedValueOnce(mockAccount);  // called by handleApplyBounce for tenantId

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(result).toEqual({ success: true, accountId: 'acct-1', messagesProcessed: 1, replies: 0, bounces: 1, autoReplies: 0, truncated: false });
    expect(mockLeadUpdate).toHaveBeenCalled();
    expect(mockSuppressionCreate).toHaveBeenCalled();
    expect(mockAccountUpdate).toHaveBeenCalled();
  });

  it('processes reply messages', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-2',
      fromEmail: 'lead@acme.com',
      subject: 'Re: Your outreach',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'lead@acme.com', stage: 'contacted', sequenceStatus: 'active',
      assignedToId: 'user-1', firstName: 'Lead', lastName: 'Test', company: 'Acme',
      sequenceId: 'seq-1',
    }]);

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(result).toEqual({ success: true, accountId: 'acct-1', messagesProcessed: 1, replies: 1, bounces: 0, autoReplies: 0, truncated: false });
    expect(mockLeadUpdate).toHaveBeenCalledWith({
      where: { id: 'lead-1' },
      data: { emailReplyCount: { increment: 1 } },
    });
    // Forward only: the stage moves to replied from new / sequence_active, never back from later.
    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', stage: { in: ['new', 'sequence_active'] } },
      data: { stage: 'replied' },
    });
    expect(mockAccountUpdate).toHaveBeenCalled();
  });

  it('routes an auto-reply through the same chokepoint without counting it as a reply', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-3',
      fromEmail: 'lead@acme.com',
      subject: 'Out of Office',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(true);
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'lead@acme.com', sequenceId: 'seq-1',
      sequenceStatus: 'active', emailInvalid: false,
    }]);
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-1', stage: 'contacted', tenantId: 'tenant-1', assignedToId: 'user-1',
      firstName: 'John', lastName: 'Doe', company: 'Acme',
    });
    mockEnrollmentFindFirst.mockResolvedValue({ id: 'enr-1', sequenceId: 'seq-1' });
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockResolvedValue({ id: 'inbound-1' });
    mockClassifyReply.mockResolvedValue({
      replyClass: 'B', kind: 'out_of_office', confidence: 1, source: 'deterministic', rationale: 'OOO.',
    });
    mockApplyClassification.mockResolvedValue({ cadence: 'paused', handedOff: false });

    const result = await handleEmailSync({ accountId: 'acct-1' });

    // It reaches the chokepoint — routing it anywhere else would be the second inbound listener
    // the architecture forbids — but it is counted separately, so reply rate is untouched.
    expect(result).toEqual({ success: true, accountId: 'acct-1', messagesProcessed: 1, replies: 0, bounces: 0, autoReplies: 1, truncated: false });
    expect(mockInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isReply: false }),
    });
    expect(mockClassifyReply).toHaveBeenCalledWith(expect.objectContaining({ isAutoReply: true }));
  });

  // --- P0 deliverability data capture ---

  it('looks leads up by the bounced recipient, not the mailer-daemon sender', async () => {
    // Regression: the lead map used to be keyed only on fromEmail, so a DSN from
    // mailer-daemon never matched a lead and the bounce was silently dropped.
    const mockMsg = {
      providerMessageId: 'gmail-b1',
      fromEmail: 'mailer-daemon@google.com',
      subject: 'Delivery Status Notification (Failure)',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('lead@acme.com');
    mockLeadFindMany.mockResolvedValue([]);

    await handleEmailSync({ accountId: 'acct-1' });

    expect(mockOutboundFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: 'acct-1', sentAt: { gte: expect.any(Date) }, to: { in: ['lead@acme.com'], mode: 'insensitive' } } })
    );
    expect(mockLeadFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ email: { in: ['lead@acme.com'], mode: 'insensitive' }, assignedToId: 'user-1' }] },
      })
    );
  });

  it('does not move the sync cursor past a message it failed to store, and fails visibly', async () => {
    // Advancing lastSyncAt after a failed save meant the next fetch started after that message,
    // so the reply or bounce was lost for good (pre-launch audit, 2026-10-05).
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([{ providerMessageId: 'gmail-lost', fromEmail: 'p@acme.com', subject: 'Re: hi', date: new Date() }]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Only prospect mail is stored now (owner, 2026-10-07).
    mockLeadFindMany.mockResolvedValue([{ id: 'lead-p', email: 'p@acme.com', sequenceId: null, sequenceStatus: null, emailInvalid: false }]);
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockRejectedValueOnce(new Error('connection reset'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(handleEmailSync({ accountId: 'acct-1' })).rejects.toThrow(/could not be saved/);
    expect(mockAccountUpdate).not.toHaveBeenCalled();
  });

  it('treats a message another sync stored first as stored, and moves on', async () => {
    const { Prisma } = await import('@prisma/client');
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([{ providerMessageId: 'gmail-race', fromEmail: 'p@acme.com', subject: 'Re: hi', date: new Date() }]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Only prospect mail is stored now (owner, 2026-10-07).
    mockLeadFindMany.mockResolvedValue([{ id: 'lead-p', email: 'p@acme.com', sequenceId: null, sequenceStatus: null, emailInvalid: false }]);
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'test' }));

    await expect(handleEmailSync({ accountId: 'acct-1' })).resolves.toMatchObject({ success: true });
    expect(mockAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { lastSyncAt: expect.any(Date) } }));
  });

  it('skips a message the database rejects for its content instead of stalling the mailbox', async () => {
    const { Prisma } = await import('@prisma/client');
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([{ providerMessageId: 'gmail-poison', fromEmail: 'p@acme.com', subject: 'x', date: new Date() }]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Only prospect mail is stored now (owner, 2026-10-07).
    mockLeadFindMany.mockResolvedValue([{ id: 'lead-p', email: 'p@acme.com', sequenceId: null, sequenceStatus: null, emailInvalid: false }]);
    mockInboundFindUnique.mockResolvedValue(null);
    mockInboundCreate.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('too long', { code: 'P2000', clientVersion: 'test' }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(handleEmailSync({ accountId: 'acct-1' })).resolves.toMatchObject({ success: true });
    expect(mockAccountUpdate).toHaveBeenCalled();
  });

  it('strips NUL bytes, which Postgres text refuses on every retry', async () => {
    const NUL = String.fromCharCode(0);
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([{ providerMessageId: 'gmail-nul', fromEmail: 'p@acme.com', fromName: `P${NUL}`, subject: `Re${NUL}: hi`, body: `a${NUL}b`, date: new Date() }]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Only prospect mail is stored now (owner, 2026-10-07).
    mockLeadFindMany.mockResolvedValue([{ id: 'lead-p', email: 'p@acme.com', sequenceId: null, sequenceStatus: null, emailInvalid: false }]);
    mockInboundFindUnique.mockResolvedValue(null);

    await handleEmailSync({ accountId: 'acct-1' });

    const data = mockInboundCreate.mock.calls.at(-1)![0].data;
    expect([data.fromName, data.subject, data.body, data.bodyHtml]).toEqual(['P', 'Re: hi', 'ab', 'ab']);
  });

  it('persists bounce notifications instead of discarding them', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-b2',
      fromEmail: 'mailer-daemon@google.com',
      subject: 'Undelivered Mail Returned to Sender',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('lead@acme.com');
    mockLeadFindMany.mockResolvedValue([]);

    await handleEmailSync({ accountId: 'acct-1' });

    expect(mockInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        providerMessageId: 'gmail-b2',
        isBounce: true,
        isReply: false,
        bounceType: 'hard',
        bouncedRecipient: 'lead@acme.com',
        tenantId: 'tenant-1',
      }),
    });
  });

  it('classifies a transient failure as a soft bounce', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-b3',
      fromEmail: 'mailer-daemon@google.com',
      subject: 'Delivery delayed: mailbox full, will try again later',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('lead@acme.com');
    mockLeadFindMany.mockResolvedValue([]);

    await handleEmailSync({ accountId: 'acct-1' });

    expect(mockInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isBounce: true, bounceType: 'soft' }),
    });
  });

  it('flags a lead reply with isReply so reply rate can be aggregated', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-r1',
      fromEmail: 'lead@acme.com',
      subject: 'Re: Your outreach',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'lead@acme.com', sequenceId: 'seq-1',
      sequenceStatus: 'active', emailInvalid: false,
    }]);
    mockLeadFindUnique.mockResolvedValue({
      id: 'lead-1', stage: 'contacted', sequenceStatus: 'active', assignedToId: 'user-1',
      firstName: 'Lead', lastName: 'Test', company: 'Acme',
    });

    await handleEmailSync({ accountId: 'acct-1' });

    expect(mockInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isReply: true, isBounce: false, leadId: 'lead-1' }),
    });
  });

  it('records an out-of-sequence lead reply without pausing anything', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-r2',
      fromEmail: 'lead@acme.com',
      subject: 'Re: Your outreach',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'lead@acme.com', sequenceId: null,
      sequenceStatus: null, emailInvalid: false,
    }]);

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(mockInboundCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ isReply: true, leadId: 'lead-1' }),
    });
    expect(result).toEqual({ success: true, accountId: 'acct-1', messagesProcessed: 1, replies: 0, bounces: 0, autoReplies: 0, truncated: false });
    expect(pauseEnrollmentOccurrence).not.toHaveBeenCalled();
  });

  it('does not store inbound mail from a non-lead (owner, 2026-10-07)', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-r3',
      fromEmail: 'colleague@telestar.com',
      subject: 'lunch?',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockLeadFindMany.mockResolvedValue([]);

    const result = await handleEmailSync({ accountId: 'acct-1' });

    expect(mockInboundCreate).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, replies: 0 });
  });

  // A sequence sends only from its chosen sender mailboxes, which are often not the lead
  // holder's. Replies and bounces landing there matched no lead, so the cadence kept going.
  // Review finding, 2026-10-09: the apply loops ran over every message read, stored before or not.
  // The cursor backs up a second and a re-read covers old mail, so a stored bounce was acted on again —
  // a second notification to the rep, and a later send marked bounced.
  describe('acting only on what this run stores', () => {
    const dsn = { providerMessageId: 'gmail-dsn-1', fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', date: new Date() };
    const lead = { id: 'lead-1', email: 'lead@acme.com', sequenceId: 'seq-1', sequenceStatus: 'active', emailInvalid: false, assignedToId: 'user-1', tenantId: 'tenant-1', tags: [] };

    const arrange = () => {
      mockAccountFindUnique.mockResolvedValue(mockAccount);
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({ fetchMessagesSince: vi.fn().mockResolvedValue([dsn]) });
      (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('lead@acme.com');
      mockLeadFindMany.mockResolvedValue([lead]);
      mockLeadFindUnique.mockResolvedValue(lead);
      mockSuppressionFindFirst.mockResolvedValue(null);
    };

    it('does not act again on a bounce stored and placed by an earlier run', async () => {
      arrange();
      mockInboundFindUnique.mockResolvedValue({ id: 'in-1', leadId: 'lead-1' });

      const result = await handleEmailSync({ accountId: 'acct-1' });

      expect(result).toMatchObject({ bounces: 0 });
      expect(mockNotificationCreate).not.toHaveBeenCalled();
      expect(mockSuppressionCreate).not.toHaveBeenCalled();
      expect(mockInboundUpdateMany).not.toHaveBeenCalled();
    });

    // The case before #257: the bounce was stored with no lead and nothing ever acted on it.
    it('acts once on a stored bounce it can now place with a lead', async () => {
      arrange();
      mockInboundFindUnique.mockResolvedValue({ id: 'in-1', leadId: null });

      const result = await handleEmailSync({ accountId: 'acct-1' });

      expect(mockInboundUpdateMany).toHaveBeenCalledWith({ where: { id: 'in-1', leadId: null }, data: { leadId: 'lead-1', isReply: false } });
      expect(result).toMatchObject({ bounces: 1 });
      expect(mockSuppressionCreate).toHaveBeenCalled();
    });

    it('leaves a stored bounce alone when another run placed it first', async () => {
      arrange();
      mockInboundFindUnique.mockResolvedValue({ id: 'in-1', leadId: null });
      mockInboundUpdateMany.mockResolvedValueOnce({ count: 0 });

      expect(await handleEmailSync({ accountId: 'acct-1' })).toMatchObject({ bounces: 0 });
    });

    // IMAP stored the bare UID, which two mailboxes share.
    it('recognises a message stored under the id its adapter used before', async () => {
      arrange();
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        fetchMessagesSince: vi.fn().mockResolvedValue([{ ...dsn, providerMessageId: 'imap:mei@nekko.tech:7:123', legacyProviderMessageId: '123' }]),
      });
      mockInboundFindUnique.mockResolvedValue(null);
      mockInboundFindFirst.mockResolvedValueOnce({ id: 'in-legacy', leadId: 'lead-1' });

      const result = await handleEmailSync({ accountId: 'acct-1' });

      expect(mockInboundFindFirst).toHaveBeenCalledWith({ where: { providerMessageId: '123', accountId: 'acct-1' }, select: { id: true, leadId: true } });
      expect(mockInboundCreate).not.toHaveBeenCalled();
      expect(result).toMatchObject({ bounces: 0 });
    });
  });

  describe("a sender mailbox that is not the lead holder's", () => {
    const senderMailbox = { ...mockAccount, id: 'acct-tl', userId: 'team-lead-1', email: 'mei@nekko.tech' };
    const sdrLead = {
      id: 'lead-9', email: 'prospect@acme.com', sequenceId: 'seq-1', sequenceStatus: 'active',
      emailInvalid: false, assignedToId: 'sdr-7', stage: 'sequence_active',
    };

    it('matches a reply to the lead this mailbox wrote to, and pauses its cadence', async () => {
      mockAccountFindUnique.mockResolvedValue(senderMailbox);
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        fetchMessagesSince: vi.fn().mockResolvedValue([
          { providerMessageId: 'gmail-x1', fromEmail: 'Prospect@Acme.com', subject: 'Re: intro', date: new Date() },
        ]),
      });
      (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
      mockOutboundFindMany.mockResolvedValue([{ leadId: 'lead-9', to: 'prospect@acme.com' }]);
      mockLeadFindMany.mockResolvedValue([sdrLead]);

      const result = await handleEmailSync({ accountId: 'acct-tl' });

      expect(mockOutboundFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { accountId: 'acct-tl', sentAt: { gte: expect.any(Date) }, to: { in: ['Prospect@Acme.com'], mode: 'insensitive' } },
      }));
      expect(mockLeadFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { OR: [
          { id: { in: ['lead-9'] } },
          { email: { in: ['Prospect@Acme.com'], mode: 'insensitive' }, assignedToId: 'team-lead-1' },
        ] },
      }));
      expect(mockInboundCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ leadId: 'lead-9', isReply: true }) });
      expect(result).toMatchObject({ replies: 1 });
    });

    it('matches a bounce to the lead this mailbox wrote to, and suppresses the address', async () => {
      mockAccountFindUnique.mockResolvedValue(senderMailbox);
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        fetchMessagesSince: vi.fn().mockResolvedValue([
          { providerMessageId: 'gmail-x2', fromEmail: 'mailer-daemon@google.com', subject: 'Delivery Status Notification (Failure)', date: new Date() },
        ]),
      });
      (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('prospect@acme.com');
      mockOutboundFindMany.mockResolvedValue([{ leadId: 'lead-9', to: 'prospect@acme.com' }]);
      mockLeadFindMany.mockResolvedValue([{ ...sdrLead, tenantId: 'tenant-1', tags: [] }]);
      mockLeadFindUnique.mockResolvedValue({ ...sdrLead, tenantId: 'tenant-1', tags: [] });
      mockSuppressionFindFirst.mockResolvedValue(null);

      const result = await handleEmailSync({ accountId: 'acct-tl' });

      expect(result).toMatchObject({ bounces: 1 });
      expect(mockSuppressionCreate).toHaveBeenCalled();
    });

    // Owner, 2026-10-09: a bounce that names no lead through this mailbox is still a dead address.
    it('falls back to the tenant’s latest send when the bounce matches nothing through this mailbox', async () => {
      mockAccountFindUnique.mockResolvedValue(senderMailbox);
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        fetchMessagesSince: vi.fn().mockResolvedValue([
          { providerMessageId: 'gmail-x9', fromEmail: 'mailer-daemon@googlemail.com', subject: 'Delivery Status Notification (Failure)', date: new Date() },
        ]),
      });
      (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(true);
      (extractBouncedRecipient as ReturnType<typeof vi.fn>).mockReturnValue('prospect@acme.com');
      mockOutboundFindMany
        .mockResolvedValueOnce([]) // nothing from this mailbox
        .mockResolvedValueOnce([{ leadId: 'lead-9', to: 'prospect@acme.com' }]); // the tenant's send
      mockLeadFindMany
        .mockResolvedValueOnce([]) // not the mailbox owner's lead either
        .mockResolvedValueOnce([sdrLead]);
      mockLeadFindUnique.mockResolvedValue({ ...sdrLead, tenantId: 'tenant-1', tags: [] });
      mockSuppressionFindFirst.mockResolvedValue(null);

      const result = await handleEmailSync({ accountId: 'acct-tl' });

      expect(mockOutboundFindMany.mock.calls[1][0].where).toMatchObject({ tenantId: 'tenant-1', to: { in: ['prospect@acme.com'], mode: 'insensitive' } });
      expect(result).toMatchObject({ bounces: 1 });
      expect(mockInboundCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ leadId: 'lead-9', isBounce: true }) });
    });

    it('takes the lead of the latest send when an address was written to for two leads', async () => {
      mockAccountFindUnique.mockResolvedValue(senderMailbox);
      (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
        fetchMessagesSince: vi.fn().mockResolvedValue([
          { providerMessageId: 'gmail-x3', fromEmail: 'prospect@acme.com', subject: 'Re: intro', date: new Date() },
        ]),
      });
      (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
      // newest first, as queried
      mockOutboundFindMany.mockResolvedValue([
        { leadId: 'lead-new', to: 'prospect@acme.com' },
        { leadId: 'lead-9', to: 'prospect@acme.com' },
      ]);
      mockLeadFindMany.mockResolvedValue([sdrLead, { ...sdrLead, id: 'lead-new' }]);

      await handleEmailSync({ accountId: 'acct-tl' });

      expect(mockInboundCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ leadId: 'lead-new' }) });
    });
  });

  it('does not re-create an already-persisted message', async () => {
    const mockMsg = {
      providerMessageId: 'gmail-dupe',
      fromEmail: 'lead@acme.com',
      subject: 'Re: hello',
      date: new Date(),
    };
    mockAccountFindUnique.mockResolvedValue(mockAccount);
    (EmailService.fromAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
      fetchMessagesSince: vi.fn().mockResolvedValue([mockMsg]),
    });
    (isBounceMessage as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isAutoReply as ReturnType<typeof vi.fn>).mockReturnValue(false);
    mockInboundFindUnique.mockResolvedValue({ id: 'already-there' });
    mockLeadFindMany.mockResolvedValue([]);

    await handleEmailSync({ accountId: 'acct-1' });

    expect(mockInboundCreate).not.toHaveBeenCalled();
  });
});
