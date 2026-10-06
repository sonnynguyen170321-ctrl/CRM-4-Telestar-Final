import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockOutboundFindFirst = vi.fn();
vi.mock('@/lib/prisma', () => ({
  prisma: { outboundMessage: { findFirst: (...a: unknown[]) => mockOutboundFindFirst(...a) } },
}));

const { planStepThread } = await import('@/lib/sequences/threading');
const {
  buildReferences,
  canReplyInThread,
  normalizeMessageId,
  previousEmailOrder,
  replySubject,
  stripReplyPrefix,
} = await import('@/lib/sequences/threadingRules');

describe('reply subject', () => {
  it('prefixes the parent subject once, however many times it was already a reply', () => {
    expect(replySubject('Quick question')).toBe('Re: Quick question');
    expect(replySubject('Re: RE: re: Quick question')).toBe('Re: Quick question');
    expect(stripReplyPrefix('Fwd: Re: Quick question')).toBe('Quick question');
  });

  it('has nothing to reply to when the parent has no subject', () => {
    expect(replySubject('')).toBeNull();
    expect(replySubject('   ')).toBeNull();
    expect(replySubject(null)).toBeNull();
  });
});

describe('References header', () => {
  it('is the parent chain followed by the parent, with ids in angle brackets', () => {
    expect(normalizeMessageId('m1@mail.gmail.com')).toBe('<m1@mail.gmail.com>');
    expect(buildReferences(null, '<m1@x>')).toBe('<m1@x>');
    expect(buildReferences('<m1@x> <m2@x>', 'm3@x')).toBe('<m1@x> <m2@x> <m3@x>');
  });

  it('keeps the root and the most recent ids when the chain is long', () => {
    const chain = Array.from({ length: 30 }, (_, i) => `<m${i}@x>`).join(' ');
    const ids = buildReferences(chain, '<last@x>', 5).split(' ');
    expect(ids).toHaveLength(5);
    expect(ids[0]).toBe('<m0@x>');
    expect(ids.at(-1)).toBe('<last@x>');
  });
});

describe('which steps may be a reply', () => {
  const steps = [
    { order: 1, channel: 'linkedin', autoComplete: false },
    { order: 2, channel: 'email', autoComplete: true },
    { order: 3, channel: 'phone', autoComplete: false },
    { order: 4, channel: 'email', autoComplete: true },
  ];

  it('needs an earlier email step — the first email is always a new one', () => {
    expect(canReplyInThread(steps, 2)).toBe(false);
    expect(canReplyInThread(steps, 4)).toBe(true);
    expect(previousEmailOrder(steps, 4)).toBe(2);
    expect(previousEmailOrder(steps, 2)).toBeNull();
  });

  // An email a rep sends by hand is not recorded against the cadence step, so there is nothing
  // for the worker to reply to — the builder must not offer it as a thread.
  it('does not count an email the rep sends by hand as something to reply to', () => {
    const manualFirst = [
      { order: 1, channel: 'email', autoComplete: false },
      { order: 2, channel: 'email', autoComplete: true },
      { order: 3, channel: 'email', autoComplete: true },
    ];
    expect(canReplyInThread(manualFirst, 2)).toBe(false);
    expect(previousEmailOrder(manualFirst, 3)).toBe(2);
  });
});

describe('planStepThread', () => {
  const input = {
    tenantId: 't1',
    leadId: 'lead-1',
    sequenceId: 'seq-1',
    stepOrder: 2,
    enrolledAt: new Date('2026-10-01T00:00:00Z'),
    accountId: 'acct-1',
  };

  beforeEach(() => vi.clearAllMocks());

  it('replies to the previous email of this enrollment, from the same mailbox', async () => {
    mockOutboundFindFirst.mockResolvedValue({
      id: 'out-1', subject: 'Quick question', accountId: 'acct-1', rfcMessageId: '<m1@mail.gmail.com>',
    });

    expect(await planStepThread(input)).toEqual({
      mode: 'reply', subject: 'Re: Quick question', inReplyToOutboundId: 'out-1',
    });
    // Only sent emails of earlier steps, and only from this enrollment onwards: a previous run of
    // the same sequence is a different conversation.
    expect(mockOutboundFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: 't1', leadId: 'lead-1', sequenceId: 'seq-1', status: 'sent',
          sequenceStepOrder: { lt: 2 }, sentAt: { gte: input.enrolledAt },
        }),
        orderBy: { sentAt: 'desc' },
      }),
    );
  });

  it('continues under the same subject, without "Re:", when the earlier email came from another mailbox', async () => {
    mockOutboundFindFirst.mockResolvedValue({
      id: 'out-1', subject: 'Quick question', accountId: 'acct-other', rfcMessageId: '<m1@x>',
    });
    expect(await planStepThread(input)).toEqual({ mode: 'continue', subject: 'Quick question', reason: 'different_mailbox' });
  });

  it('continues under the same subject when the provider never reported a Message-ID', async () => {
    // Every email sent before threading existed, and every Outlook send.
    mockOutboundFindFirst.mockResolvedValue({ id: 'out-1', subject: 'Re: Quick question', accountId: 'acct-1', rfcMessageId: null });
    expect(await planStepThread(input)).toEqual({ mode: 'continue', subject: 'Quick question', reason: 'no_message_id' });
  });

  it('leaves the step its own subject when nothing was sent before it', async () => {
    mockOutboundFindFirst.mockResolvedValue(null);
    expect(await planStepThread(input)).toEqual({ mode: 'new', reason: 'no_prior_email' });
  });
});
