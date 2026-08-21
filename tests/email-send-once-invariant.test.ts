import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

/**
 * Phase 13 — ONE LOGICAL EMAIL STEP = AT MOST ONE INTENDED PHYSICAL SEND.
 *
 * `tests/email-worker.test.ts` already covers this handler's decisions, but it mocks Prisma
 * entirely — including `outboundMessage.updateMany`, which *is* the compare-and-set that makes
 * the invariant hold. A mocked CAS cannot prove a CAS. So the guarantee the whole email lane
 * rests on had never been exercised against a database that can actually serialise two writers.
 *
 * These tests run the real handler against real Postgres and count real provider invocations.
 * Only the provider itself and the queue are substituted; every status transition is genuine.
 *
 * Skips itself when no DATABASE_URL is configured, the same way the other database suites do.
 */

const sendCalls: Array<{ to: string; subject: string }> = [];
/** EmailService.send resolves a provider message id string, or undefined. */
let sendBehaviour: (args: { to: string; subject: string }) => Promise<string | undefined> = async () =>
  `provider-${crypto.randomUUID()}`;

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn().mockResolvedValue({
      send: async (args: { to: string; subject: string }) => {
        sendCalls.push({ to: args.to, subject: args.subject });
        return sendBehaviour(args);
      },
    }),
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
  enqueueReschedule: vi.fn().mockResolvedValue('job-1'),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
}));

// The send must be a real one, not the dry-run short circuit, or nothing is being measured.
vi.mock('@/lib/emailSafety', () => ({
  effectiveDryRun: () => false,
  isGlobalEmailPaused: () => false,
  isCanaryRecipientAllowed: () => true,
  isAutosendEnabled: () => true,
  isDryRun: () => false,
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { handleEmailSend } = await import('@/workers/email');
const { OUTBOUND_STATUS } = await import('@/lib/email/idempotency');

const hasDb = Boolean(process.env.DATABASE_URL);
const T = 'sendonce-tenant';
const OTHER_T = 'sendonce-other-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);

let accountId = '';
let leadId = '';

async function seed() {
  await run(async () => {
    await prisma.inboundMessage.deleteMany({ where: { account: { tenantId: T } } });
    await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
    await prisma.sequence.deleteMany({ where: { tenantId: T } });
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
    await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.emailAccount.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });

    await prisma.tenant.deleteMany({ where: { id: OTHER_T } });
    await prisma.tenant.create({ data: { id: T, name: 'Send Once' } });
    // A real neighbouring tenant, so the cross-tenant suppression assertion is about scoping
    // rather than about a foreign key that happens to fail.
    await prisma.tenant.create({ data: { id: OTHER_T, name: 'Send Once Other' } });
    const user = await prisma.user.create({
      data: {
        tenantId: T,
        email: 'owner@sendonce.test',
        firstName: 'Owner',
        lastName: 'One',
        role: 'sdr',
        password: 'x',
        isActive: true,
      },
    });
    const account = await prisma.emailAccount.create({
      data: {
        tenantId: T,
        userId: user.id,
        email: 'sender@sendonce.test',
        provider: 'imap_smtp',
        isActive: true,
        dailyCap: 1000,
        dailySendCount: 0,
      },
    });
    // Leads belong to campaigns, not to people, so the whole chain has to exist.
    const client = await prisma.client.create({
      data: {
        tenantId: T,
        name: 'Send Once Client',
        industry: 'Logistics',
        contactName: 'Chris Contact',
        contactEmail: 'chris@sendonce.test',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: T, clientId: client.id, name: 'Send Once Campaign', startDate: new Date() },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: T,
        firstName: 'Pat',
        lastName: 'Prospect',
        email: 'prospect@sendonce.test',
        company: 'Prospect Co',
        assignedToId: user.id,
        campaignId: campaign.id,
      },
    });
    accountId = account.id;
    leadId = lead.id;
  });
}

/** One logical step: the same idempotency key every time, as the sequence worker would build it. */
async function createMessage(key: string) {
  return run(() =>
    prisma.outboundMessage.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        tenantId: T,
        leadId,
        accountId,
        to: 'prospect@sendonce.test',
        subject: 'One step, one send',
        body: 'Hello',
        idempotencyKey: key,
        status: OUTBOUND_STATUS.PENDING,
      },
    }),
  );
}

/** The real job payload shape: the worker reads recipient and copy from the job, not the row. */
const payloadFor = (id: string) => ({
  outboundMessageId: id,
  accountId,
  to: 'prospect@sendonce.test',
  subject: 'One step, one send',
  body: 'Hello',
  leadId,
});

/**
 * Seeded once for the whole file. Both suites share the tenant chain, so tearing it down at the
 * end of the first `describe` left the second with a lead that no longer existed.
 */
beforeAll(seed);

afterAll(async () => {
  await run(async () => {
    // A successful send writes an Activity against the lead and the user, so those rows have to
    // go before the records they point at.
    await prisma.inboundMessage.deleteMany({ where: { account: { tenantId: T } } });
    await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
    await prisma.sequence.deleteMany({ where: { tenantId: T } });
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
    await prisma.suppressionEntry.deleteMany({ where: { tenantId: OTHER_T } });
    await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.emailAccount.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: { in: [T, OTHER_T] } } });
  });
});

describe.skipIf(!hasDb)('one logical step sends at most one physical email', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
  });

  it('sends exactly once when ten workers race the same message', async () => {
    // The case a mocked updateMany cannot prove: ten concurrent claimants against one row.
    const message = await createMessage(`race-${crypto.randomUUID()}`);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => run(() => handleEmailSend(payloadFor(message.id)))),
    );

    expect(sendCalls).toHaveLength(1);

    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.status).toBe(OUTBOUND_STATUS.SENT);
    expect(after?.providerMessageId).toBeTruthy();

    // Nine of the ten must have declined cleanly rather than thrown.
    const declined = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as { skipped?: boolean })?.skipped,
    );
    expect(declined.length).toBeGreaterThanOrEqual(9);
  });

  it('sends exactly once when the same job is delivered twice in sequence', async () => {
    const message = await createMessage(`dup-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(message.id)));
    await run(() => handleEmailSend(payloadFor(message.id)));

    expect(sendCalls).toHaveLength(1);
  });

  it('upserting the same logical step twice yields one row, not two', async () => {
    // The other half of the invariant: two derivations of one step must converge on one message.
    const key = `single-${crypto.randomUUID()}`;
    const first = await createMessage(key);
    const second = await createMessage(key);
    expect(second.id).toBe(first.id);

    const count = await run(() =>
      prisma.outboundMessage.count({ where: { tenantId: T, idempotencyKey: key } }),
    );
    expect(count).toBe(1);
  });

  it('does not send again after an ambiguous provider outcome', async () => {
    // A timeout after the provider may already have accepted. Re-sending here is how a
    // prospect receives the same mail twice, so the message must go to reconciliation and stay.
    const message = await createMessage(`ambiguous-${crypto.randomUUID()}`);
    sendBehaviour = async () => {
      const error = new Error('ETIMEDOUT: socket hang up');
      (error as NodeJS.ErrnoException).code = 'ETIMEDOUT';
      throw error;
    };
    // The handler records the outcome and then rethrows, so BullMQ retries it — the retry is
    // what must not produce a second send.
    await expect(run(() => handleEmailSend(payloadFor(message.id)))).rejects.toThrow();

    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.status).toBe(OUTBOUND_STATUS.RECONCILIATION_REQUIRED);

    // A retry must not attempt a second delivery.
    sendCalls.length = 0;
    sendBehaviour = async () => 'second-attempt-should-not-happen';
    await run(() => handleEmailSend(payloadFor(message.id)));
    expect(sendCalls).toHaveLength(0);
  });

  it('does not send again after a crash between provider acceptance and the status write', async () => {
    // The worst window: the provider has the mail, the database does not know yet. Simulated by
    // throwing after the send resolves.
    const message = await createMessage(`crash-${crypto.randomUUID()}`);
    sendBehaviour = async () => {
      throw Object.assign(new Error('worker killed after accept'), { code: 'ECONNRESET' });
    };
    await expect(run(() => handleEmailSend(payloadFor(message.id)))).rejects.toThrow();

    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    // Whatever it is, it must not be claimable again by a worker that would re-send.
    expect([OUTBOUND_STATUS.RECONCILIATION_REQUIRED, OUTBOUND_STATUS.SENT]).toContain(after?.status);

    sendCalls.length = 0;
    await run(() => handleEmailSend(payloadFor(message.id))).catch(() => undefined);
    expect(sendCalls).toHaveLength(0);
  });

  it('never sends to a suppressed recipient, even on a fresh message', async () => {
    const message = await createMessage(`suppressed-${crypto.randomUUID()}`);
    await run(() =>
      prisma.suppressionEntry.create({
        data: { tenantId: T, email: 'prospect@sendonce.test', reason: 'unsubscribed' },
      }),
    );

    await run(() => handleEmailSend(payloadFor(message.id)));
    expect(sendCalls).toHaveLength(0);

    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.status).toBe(OUTBOUND_STATUS.FAILED);

    await run(() => prisma.suppressionEntry.deleteMany({ where: { tenantId: T } }));
  });

  it('a message already marked sent is never re-sent', async () => {
    const message = await createMessage(`terminal-${crypto.randomUUID()}`);
    await run(() =>
      prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: OUTBOUND_STATUS.SENT, providerMessageId: 'already-delivered', sentAt: new Date() },
      }),
    );

    await run(() => handleEmailSend(payloadFor(message.id)));
    expect(sendCalls).toHaveLength(0);
  });
});

/**
 * The stop rules, against the same real database.
 *
 * `tests/unsubscribe.test.ts` and `tests/sequence-worker.test.ts` both mock `@/lib/prisma`, so
 * "a stopped contact never receives a later step" had only ever been asserted against mocks.
 * The send path is the chokepoint that makes it true regardless of what the sequence decides,
 * so each stop signal is driven through the real handler here and counted.
 */
describe.skipIf(!hasDb)('a stopped contact receives no further sends', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
  });

  afterEach(async () => {
    await run(async () => {
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
      await prisma.emailAccount.updateMany({
        where: { tenantId: T },
        data: { isActive: true, sendPausedAt: null, sendPauseReason: null },
      });
    });
  });

  it('an unsubscribe stops the NEXT step, not just the one that triggered it', async () => {
    // Step one goes out, the prospect unsubscribes, step two must not.
    const stepOne = await createMessage(`unsub-step1-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(stepOne.id)));
    expect(sendCalls).toHaveLength(1);

    await run(() =>
      prisma.suppressionEntry.create({
        data: { tenantId: T, email: 'prospect@sendonce.test', reason: 'unsubscribed' },
      }),
    );

    sendCalls.length = 0;
    const stepTwo = await createMessage(`unsub-step2-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(stepTwo.id)));

    expect(sendCalls).toHaveLength(0);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: stepTwo.id } }));
    expect(after?.status).toBe(OUTBOUND_STATUS.FAILED);
    expect(after?.errorMessage).toContain('suppressed');
  });

  it('a hard bounce suppression stops later steps the same way', async () => {
    await run(() =>
      prisma.suppressionEntry.create({
        data: { tenantId: T, email: 'prospect@sendonce.test', reason: 'hard_bounce' },
      }),
    );

    const message = await createMessage(`bounce-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(message.id)));

    expect(sendCalls).toHaveLength(0);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.errorMessage).toContain('hard_bounce');
  });

  it('a paused inbox sends nothing, and says why', async () => {
    await run(() =>
      prisma.emailAccount.updateMany({
        where: { id: accountId },
        data: { sendPausedAt: new Date(), sendPauseReason: 'manager paused' },
      }),
    );

    const message = await createMessage(`paused-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(message.id)));

    expect(sendCalls).toHaveLength(0);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.status).toBe(OUTBOUND_STATUS.FAILED);
    expect(after?.errorMessage).toContain('manager paused');
  });

  it('a deactivated sender sends nothing', async () => {
    // The SDR left, or was deactivated mid-cadence.
    await run(() =>
      prisma.emailAccount.updateMany({ where: { id: accountId }, data: { isActive: false } }),
    );

    const message = await createMessage(`inactive-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(message.id)));

    expect(sendCalls).toHaveLength(0);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.errorMessage).toContain('inactive');
  });

  it('resuming a paused inbox lets the next step through again', async () => {
    // Pause must be reversible, or a manager pause becomes a permanent outage.
    await run(() =>
      prisma.emailAccount.updateMany({
        where: { id: accountId },
        data: { sendPausedAt: new Date(), sendPauseReason: 'temporary' },
      }),
    );
    const blocked = await createMessage(`resume-blocked-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(blocked.id)));
    expect(sendCalls).toHaveLength(0);

    await run(() =>
      prisma.emailAccount.updateMany({
        where: { id: accountId },
        data: { sendPausedAt: null, sendPauseReason: null },
      }),
    );
    const allowed = await createMessage(`resume-allowed-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(allowed.id)));
    expect(sendCalls).toHaveLength(1);
  });

  it('suppression is matched per tenant, not globally', async () => {
    // A suppression in someone else's tenant must not silence this one's sending.
    await run(() =>
      prisma.suppressionEntry.create({
        data: { tenantId: OTHER_T, email: 'prospect@sendonce.test', reason: 'unsubscribed' },
      }),
    );

    const message = await createMessage(`crosstenant-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(message.id)));
    expect(sendCalls).toHaveLength(1);

    await run(() =>
      prisma.suppressionEntry.deleteMany({ where: { tenantId: OTHER_T } }),
    );
  });
});

/**
 * A duplicate provider webhook must not double-apply.
 *
 * Providers redeliver. `handleApplyBounce` guards the originating message (only rows still
 * `sent` are selected) and the suppression entry (checked before create), and returns
 * `already_invalid` on a second hard bounce. Whether all of that holds together under an actual
 * redelivery had never been measured — `tests/sync-worker.test.ts` mocks `@/lib/prisma`.
 */
describe.skipIf(!hasDb)('a redelivered provider webhook does not double-apply', () => {
  beforeEach(async () => {
    sendCalls.length = 0;
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
      await prisma.lead.updateMany({ where: { tenantId: T }, data: { emailInvalid: false } });
    });
  });

  it('a hard bounce delivered twice suppresses once and marks the lead once', async () => {
    const { handleApplyBounce } = await import('@/workers/sync');
    const sent = await createMessage(`bounce-dup-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(sent.id)));

    const bounce = {
      providerMessageId: `bounce-evt-${crypto.randomUUID()}`,
      leadId,
      accountId,
      bounceType: 'hard' as const,
    };

    const first = await run(() => handleApplyBounce(bounce));
    const second = await run(() => handleApplyBounce(bounce));

    // The second delivery must recognise the state it already produced.
    expect((second as { skipped?: boolean }).skipped).toBe(true);
    expect((second as { reason?: string }).reason).toBe('already_invalid');
    expect((first as { skipped?: boolean }).skipped).not.toBe(true);

    const suppressions = await run(() =>
      prisma.suppressionEntry.count({
        where: { tenantId: T, email: 'prospect@sendonce.test', reason: 'hard_bounce' },
      }),
    );
    expect(suppressions).toBe(1);

    const message = await run(() => prisma.outboundMessage.findUnique({ where: { id: sent.id } }));
    expect(message?.status).toBe('bounced');
  });

  it('the invalid-email tag is not appended twice', async () => {
    const { handleApplyBounce } = await import('@/workers/sync');
    const sent = await createMessage(`tag-dup-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(sent.id)));

    const bounce = {
      providerMessageId: `tag-evt-${crypto.randomUUID()}`,
      leadId,
      accountId,
      bounceType: 'hard' as const,
    };
    await run(() => handleApplyBounce(bounce));
    await run(() => handleApplyBounce(bounce));

    const lead = await run(() => prisma.lead.findUnique({ where: { id: leadId } }));
    const tags = (lead?.tags ?? []) as string[];
    expect(tags.filter((t) => t === 'invalid-email')).toHaveLength(1);
  });

  it('records the bounce on the timeline exactly once per delivery', async () => {
    // A redelivered webhook writing a second timeline entry is duplicated CRM state: the
    // prospect bounced once, and the record should say so once.
    const { handleApplyBounce } = await import('@/workers/sync');
    const sent = await createMessage(`activity-dup-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(sent.id)));

    const bounce = {
      providerMessageId: `activity-evt-${crypto.randomUUID()}`,
      leadId,
      accountId,
      bounceType: 'hard' as const,
    };
    await run(() => handleApplyBounce(bounce));
    await run(() => handleApplyBounce(bounce));

    const bounceActivities = await run(() =>
      prisma.activity.count({ where: { tenantId: T, leadId, type: 'email_bounced' } }),
    );
    expect(bounceActivities).toBe(1);
  });

  it('a soft bounce does not suppress the address', async () => {
    const { handleApplyBounce } = await import('@/workers/sync');
    const sent = await createMessage(`soft-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(sent.id)));

    await run(() =>
      handleApplyBounce({
        providerMessageId: `soft-evt-${crypto.randomUUID()}`,
        leadId,
        accountId,
        bounceType: 'soft' as const,
      }),
    );

    const suppressions = await run(() =>
      prisma.suppressionEntry.count({ where: { tenantId: T, email: 'prospect@sendonce.test' } }),
    );
    expect(suppressions).toBe(0);

    const lead = await run(() => prisma.lead.findUnique({ where: { id: leadId } }));
    expect(lead?.emailInvalid).toBe(false);
  });
});

/**
 * A redelivered reply webhook must not double-apply either.
 *
 * `handleApplyReply` carries an explicit dedup gate — "Redelivery deduplication (S4): if this
 * exact provider message was already classified, skip" — and `tests/phase-8b-replies.test.ts`,
 * which does use a real database, has **no** redelivery case. The gate had never been exercised.
 *
 * "Please unsubscribe me." classifies deterministically, so no AI provider is involved.
 */
describe.skipIf(!hasDb)('a redelivered reply webhook does not double-apply', () => {
  let sequenceId = '';

  beforeEach(async () => {
    await run(async () => {
      await prisma.inboundMessage.deleteMany({ where: { account: { tenantId: T } } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
      await prisma.activity.deleteMany({ where: { tenantId: T } });

      if (!sequenceId) {
        const owner = await prisma.user.findFirst({ where: { tenantId: T } });
        const sequence = await prisma.sequence.create({
          data: { tenantId: T, name: 'Send Once Cadence', createdById: owner!.id },
        });
        sequenceId = sequence.id;
      }
    });
  });

  async function enrolAndReceive(providerMessageId: string, body: string) {
    return run(async () => {
      await prisma.sequenceEnrollment.create({
        data: {
          tenantId: T,
          leadId,
          sequenceId,
          status: 'active',
          occupancyKey: `${T}:${leadId}`,
          currentStep: 1,
        },
      });
      await prisma.inboundMessage.create({
        data: {
          accountId,
          leadId,
          fromEmail: 'prospect@sendonce.test',
          to: 'sender@sendonce.test',
          providerMessageId,
          date: new Date(),
          subject: 'Re: One step, one send',
          body,
          isReply: true,
        },
      });
    });
  }

  it('classifies once and reports the redelivery as already processed', async () => {
    const { handleApplyReply } = await import('@/workers/sync');
    const providerMessageId = `reply-evt-${crypto.randomUUID()}`;
    await enrolAndReceive(providerMessageId, 'Please unsubscribe me.');

    const first = await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    const second = await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));

    expect((first as { skipped?: boolean }).skipped).not.toBe(true);
    expect((second as { skipped?: boolean }).skipped).toBe(true);
    expect((second as { reason?: string }).reason).toBe('already_processed');
  });

  it('a redelivered unsubscribe reply suppresses the address exactly once', async () => {
    const { handleApplyReply } = await import('@/workers/sync');
    const providerMessageId = `reply-unsub-${crypto.randomUUID()}`;
    await enrolAndReceive(providerMessageId, 'Please unsubscribe me.');

    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));

    const suppressions = await run(() =>
      prisma.suppressionEntry.count({ where: { tenantId: T, email: 'prospect@sendonce.test' } }),
    );
    expect(suppressions).toBe(1);
  });

  it('records the reply on the timeline exactly once across a redelivery', async () => {
    // The same defect class as the bounce path (TEL-P2-024). Suppression is protected twice
    // over — the dedup gate here and applyReplyClassification's own check — but the timeline
    // is written on the classification path, so only the dedup gate stands between a
    // redelivery and a duplicated entry.
    const { handleApplyReply } = await import('@/workers/sync');
    const providerMessageId = `reply-timeline-${crypto.randomUUID()}`;
    await enrolAndReceive(providerMessageId, 'Please unsubscribe me.');

    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    const before = await run(() =>
      prisma.activity.count({ where: { tenantId: T, leadId } }),
    );
    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    const after = await run(() => prisma.activity.count({ where: { tenantId: T, leadId } }));

    expect(after).toBe(before);
  });

  it('does not re-stamp classifiedAt on a redelivery', async () => {
    // If the second delivery reclassified, the timestamp would move and the audit trail would
    // claim the prospect replied later than they did.
    const { handleApplyReply } = await import('@/workers/sync');
    const providerMessageId = `reply-stamp-${crypto.randomUUID()}`;
    await enrolAndReceive(providerMessageId, 'Please unsubscribe me.');

    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    const first = await run(() =>
      prisma.inboundMessage.findUnique({ where: { providerMessageId } }),
    );

    await new Promise((resolve) => setTimeout(resolve, 25));
    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    const second = await run(() =>
      prisma.inboundMessage.findUnique({ where: { providerMessageId } }),
    );

    expect(second?.classifiedAt?.getTime()).toBe(first?.classifiedAt?.getTime());
  });

  it('the stop reaches the send path: no later step goes out after the reply', async () => {
    // The rule the whole cadence rests on, driven end to end rather than asserted.
    const { handleApplyReply } = await import('@/workers/sync');
    const providerMessageId = `reply-stop-${crypto.randomUUID()}`;
    await enrolAndReceive(providerMessageId, 'Please unsubscribe me.');
    await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));

    sendCalls.length = 0;
    const nextStep = await createMessage(`after-reply-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(nextStep.id)));

    expect(sendCalls).toHaveLength(0);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: nextStep.id } }));
    expect(after?.status).toBe(OUTBOUND_STATUS.FAILED);
  });

  it('a reply for a lead with no active enrollment is skipped, not applied', async () => {
    const { handleApplyReply } = await import('@/workers/sync');
    const providerMessageId = `reply-noenrol-${crypto.randomUUID()}`;
    await enrolAndReceive(providerMessageId, 'Please unsubscribe me.');
    await run(() =>
      prisma.sequenceEnrollment.updateMany({
        where: { tenantId: T, leadId },
        data: { status: 'completed', occupancyKey: null },
      }),
    );

    const result = await run(() => handleApplyReply({ providerMessageId, leadId, accountId }));
    expect((result as { skipped?: boolean }).skipped).toBe(true);
    expect((result as { reason?: string }).reason).toBe('sequence_not_active');
  });
});

/**
 * Lead reassignment mid-cadence.
 *
 * `lib/admin/transferWork.ts` moves leads, tasks, meetings and opportunities. It does not touch
 * `OutboundMessage`, so a send already queued against the previous owner's mailbox is still
 * addressed from that mailbox when it runs. These tests characterise what actually happens
 * rather than assert what ought to — the behaviour is a product decision, and the point here is
 * that it should be a decided one rather than an accident.
 */
describe.skipIf(!hasDb)('a lead reassigned mid-cadence', () => {
  let otherUserId = '';
  let otherAccountId = '';

  beforeAll(async () => {
    await run(async () => {
      const other = await prisma.user.create({
        data: {
          tenantId: T,
          email: 'second-owner@sendonce.test',
          firstName: 'Sam',
          lastName: 'Second',
          role: 'sdr',
          password: 'x',
          isActive: true,
        },
      });
      const account = await prisma.emailAccount.create({
        data: {
          tenantId: T,
          userId: other.id,
          email: 'second-sender@sendonce.test',
          provider: 'imap_smtp',
          isActive: true,
          dailyCap: 1000,
          dailySendCount: 0,
        },
      });
      otherUserId = other.id;
      otherAccountId = account.id;
    });
  });

  beforeEach(async () => {
    sendCalls.length = 0;
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    await run(() =>
      prisma.lead.updateMany({ where: { id: leadId }, data: { assignedToId: undefined } }),
    );
  });

  it('a send queued before the handover still goes from the original mailbox', async () => {
    // Characterisation, not a judgement: the message was composed against that inbox, and
    // transferWork does not rewrite queued sends.
    const queued = await createMessage(`reassign-${crypto.randomUUID()}`);

    await run(() =>
      prisma.lead.update({ where: { id: leadId }, data: { assignedToId: otherUserId } }),
    );

    await run(() => handleEmailSend(payloadFor(queued.id)));

    expect(sendCalls).toHaveLength(1);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: queued.id } }));
    expect(after?.accountId).toBe(accountId);
    expect(after?.status).toBe(OUTBOUND_STATUS.SENT);
  });

  it('reassignment does not duplicate an already-sent message', async () => {
    // The invariant that must hold whatever the ownership decision is.
    const message = await createMessage(`reassign-dup-${crypto.randomUUID()}`);
    await run(() => handleEmailSend(payloadFor(message.id)));
    expect(sendCalls).toHaveLength(1);

    await run(() =>
      prisma.lead.update({ where: { id: leadId }, data: { assignedToId: otherUserId } }),
    );
    await run(() => handleEmailSend(payloadFor(message.id)));

    expect(sendCalls).toHaveLength(1);
  });

  it('a send explicitly queued against the new owner uses the new mailbox', async () => {
    // The supported path: the next step is derived after the handover.
    const message = await run(() =>
      prisma.outboundMessage.create({
        data: {
          tenantId: T,
          leadId,
          accountId: otherAccountId,
          to: 'prospect@sendonce.test',
          subject: 'After the handover',
          body: 'Hello again',
          idempotencyKey: `reassign-new-${crypto.randomUUID()}`,
          status: OUTBOUND_STATUS.PENDING,
        },
      }),
    );

    await run(() =>
      handleEmailSend({
        outboundMessageId: message.id,
        accountId: otherAccountId,
        to: 'prospect@sendonce.test',
        subject: 'After the handover',
        body: 'Hello again',
        leadId,
      }),
    );

    expect(sendCalls).toHaveLength(1);
    const after = await run(() => prisma.outboundMessage.findUnique({ where: { id: message.id } }));
    expect(after?.accountId).toBe(otherAccountId);
    expect(after?.status).toBe(OUTBOUND_STATUS.SENT);
  });

  it('deactivating the previous owner stops their queued sends', async () => {
    // What a real handover usually accompanies. The queued message must not go out from a
    // mailbox that has been switched off.
    const queued = await createMessage(`reassign-inactive-${crypto.randomUUID()}`);
    await run(() =>
      prisma.emailAccount.updateMany({ where: { id: accountId }, data: { isActive: false } }),
    );

    await run(() => handleEmailSend(payloadFor(queued.id)));
    expect(sendCalls).toHaveLength(0);

    await run(() =>
      prisma.emailAccount.updateMany({ where: { id: accountId }, data: { isActive: true } }),
    );
  });
});
