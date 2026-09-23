import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * A bounced address is never written to again.
 *
 * Production ran for a month with a suppression gate in front of every send and **nothing that
 * ever filled the list**: `SuppressionEntry` held 0 rows across 384 sends, and `emailInvalid`
 * was false on all 1,138 leads, while 20 messages sat unresolved and 7 had been refused outright
 * by the provider. The only path that could suppress an address was a bounce notification
 * arriving back in the inbox and matching a subject regex. It never matched.
 *
 * Worse, the redrive sweep added on 2026-09-22 treats `failed` as retryable — correct for a
 * message refused by our own quota, and reputation-destroying for one refused because the
 * mailbox does not exist. Production reached `attemptCount: 8` against a cap of 5, each attempt
 * a fresh bounce recorded against the sending domain, and a mailbox's health score fell to 90.
 *
 * The split these tests pin is the one that makes suppression safe to automate: the same `550`
 * can mean "your hourly limit" or "this address is dead", and only the DSN code says which.
 * Suppressing on the first would have deleted a day's pipeline; retrying the second is what
 * spent the reputation.
 */

let sendBehaviour: () => Promise<string | undefined> = async () => `provider-${crypto.randomUUID()}`;
let sendCalls = 0;

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn().mockResolvedValue({
      send: async () => {
        sendCalls++;
        return sendBehaviour();
      },
    }),
  },
}));

const enqueueReschedule = vi.fn().mockResolvedValue('job-1');
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
  enqueueReschedule: (...args: unknown[]) => enqueueReschedule(...args),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
}));

vi.mock('@/lib/emailSafety', () => ({
  effectiveDryRun: () => false,
  isGlobalEmailPaused: () => false,
  isCanaryRecipientAllowed: () => true,
  isAutosendEnabled: () => true,
  isDryRun: () => false,
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const { handleEmailSend } = await import('@/workers/email');
const { handleRepair } = await import('@/workers/maintenance');
const { OUTBOUND_STATUS } = await import('@/lib/email/idempotency');

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

const T = 'bounce-suppression-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);
const today = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

let userId = '';
let accountId = '';
let leadId = '';
let sequenceId = '';
const RECIPIENT = 'ghost@deadcompany.test';

async function seed() {
  await run(async () => {
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.notification.deleteMany({ where: { tenantId: T } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
    await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
    await prisma.task.deleteMany({ where: { tenantId: T } });
    await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.sequenceStep.deleteMany({ where: { tenantId: T } });
    await prisma.sequence.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.emailAccount.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });

    await prisma.tenant.create({ data: { id: T, name: 'Bounce Suppression' } });
    const user = await prisma.user.create({
      data: {
        tenantId: T,
        email: 'owner@bounce.test',
        firstName: 'Owner',
        lastName: 'Bounce',
        role: 'sdr',
        password: 'x',
        isActive: true,
      },
    });
    const account = await prisma.emailAccount.create({
      data: {
        tenantId: T,
        userId: user.id,
        email: 'sender@bounce.test',
        provider: 'imap_smtp',
        isActive: true,
        dailyCap: 100,
        hourlyCap: 0,
        dailySendCount: 0,
        dailySendDate: today(),
      },
    });
    const client = await prisma.client.create({
      data: {
        tenantId: T,
        name: 'Bounce Client',
        industry: 'Logistics',
        contactName: 'Chris',
        contactEmail: 'chris@bounce.test',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: T, clientId: client.id, name: 'Bounce Campaign', startDate: new Date() },
    });
    const sequence = await prisma.sequence.create({
      data: {
        tenantId: T,
        name: 'Bounce Sequence',
        createdById: user.id,
        steps: {
          create: [
            { order: 1, channel: 'email', delayDays: 0, autoComplete: false },
            { order: 2, channel: 'email', delayDays: 3, autoComplete: false },
          ],
        },
      },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: T,
        firstName: 'Ghost',
        lastName: 'Prospect',
        email: RECIPIENT,
        company: 'Dead Company',
        assignedToId: user.id,
        campaignId: campaign.id,
        sequenceId: sequence.id,
        sequenceStep: 1,
        sequenceStatus: 'active',
      },
    });

    userId = user.id;
    accountId = account.id;
    leadId = lead.id;
    sequenceId = sequence.id;
  });
}

async function openStep() {
  return run(async () => {
    const enrollment = await prisma.sequenceEnrollment.create({
      data: {
        tenantId: T,
        leadId,
        sequenceId,
        status: 'active',
        currentStep: 1,
        occupancyKey: `${T}:${leadId}`,
        nextActionAt: new Date(),
      },
    });
    const task = await prisma.task.create({
      data: {
        tenantId: T,
        leadId,
        userId,
        type: 'email',
        title: 'Step 1',
        dueDate: new Date(),
        status: 'pending',
        sequenceId,
        sequenceStep: 1,
        lockedAt: new Date(),
      },
    });
    const message = await prisma.outboundMessage.create({
      data: {
        tenantId: T,
        leadId,
        accountId,
        to: RECIPIENT,
        subject: 'Step 1',
        body: 'Hello',
        idempotencyKey: `bounce-${crypto.randomUUID()}`,
        status: OUTBOUND_STATUS.PENDING,
        sequenceId,
        sequenceStepOrder: 1,
      },
    });
    return { enrollment, task, message };
  });
}

async function attempt(outboundMessageId: string, taskId: string, enrollmentId: string) {
  try {
    await run(() =>
      handleEmailSend({
        outboundMessageId,
        accountId,
        to: RECIPIENT,
        subject: 'Step 1',
        body: 'Hello',
        leadId,
        sequenceStepRef: {
          taskId,
          leadId,
          actorUserId: userId,
          sequenceId,
          sequenceStep: 1,
          enrollmentId,
        },
      } as never)
    );
  } catch {
    // The handler rethrows so BullMQ retries. What was recorded is the subject here.
  }
}

const readMessage = (id: string) =>
  run(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id } }));
const readLead = () => run(() => prisma.lead.findUniqueOrThrow({ where: { id: leadId } }));
const suppressions = () =>
  run(() => prisma.suppressionEntry.findMany({ where: { tenantId: T } }));

/** The outbound ids the sweep asked to be sent again. */
const redrivenIds = (): string[] =>
  enqueueReschedule.mock.calls
    .map((call) => (call[1] as { outboundMessageId?: string })?.outboundMessageId)
    .filter((id): id is string => Boolean(id));

describe.skipIf(!hasDb)('an address the provider rejects is never written to again', () => {
  beforeAll(seed);

  beforeEach(async () => {
    enqueueReschedule.mockClear();
    sendCalls = 0;
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.notification.deleteMany({ where: { tenantId: T } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.lead.update({
        where: { id: leadId },
        data: {
          emailInvalid: false,
          tags: [],
          sequenceStep: 1,
          sequenceStatus: 'active',
          sequenceId,
        },
      });
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { dailySendCount: 0, dailySendDate: today() },
      });
    });
  });

  it('suppresses the address tenant-wide when the mailbox does not exist', async () => {
    sendBehaviour = async () => {
      throw new Error('550 5.1.1 The email account that you tried to reach does not exist');
    };
    const { message, enrollment, task } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    const entries = await suppressions();
    expect(entries).toHaveLength(1);
    expect(entries[0].email).toBe(RECIPIENT);
    expect(entries[0].reason).toBe('hard_bounce');
    expect(
      entries[0].campaignId,
      'tenant-wide, or the next campaign writes to the same dead address'
    ).toBeNull();

    const lead = await readLead();
    expect(lead.emailInvalid).toBe(true);
    expect(lead.tags).toContain('invalid-email');

    const enrollmentAfter = await run(() =>
      prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollment.id } })
    );
    expect(enrollmentAfter.status).toBe('paused');
  });

  it('puts a dead address beyond the reach of the redrive sweep', async () => {
    // The whole point. `failed` is claimable, so a dead address parked there is a bounce on a
    // schedule — up to the redrive cap, each one counted by the provider.
    sendBehaviour = async () => {
      throw new Error('550 5.1.1 user unknown');
    };
    const { message, enrollment, task } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    expect((await readMessage(message.id)).status).toBe(OUTBOUND_STATUS.PERMANENTLY_FAILED);

    await run(() =>
      prisma.outboundMessage.update({
        where: { id: message.id },
        data: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      })
    );
    enqueueReschedule.mockClear();
    await run(() => handleRepair({ types: ['stale-pending-outbound'] }));

    // Asserted against this message rather than the call count: the sweep is not tenant-scoped
    // and the shared test database always holds other suites' rows, so "never called" would be
    // a statement about the fixtures rather than about this address.
    expect(
      redrivenIds(),
      'a sweep that re-drives a dead address is a bounce generator'
    ).not.toContain(message.id);
  });

  it('does not suppress when the refusal was our own sending limit', async () => {
    // The 2026-09-21 wording, verbatim. 228 live prospects came back with this, and reading it
    // as a bounce would have deleted all of them, silently and permanently.
    sendBehaviour = async () => {
      throw new Error(
        "Can't send mail - all recipients were rejected: 550 5.4.6 Sender Hourly Quota Exceeded"
      );
    };
    const { message, enrollment, task } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    expect(await suppressions(), 'our quota is not the prospect’s fault').toHaveLength(0);
    expect((await readLead()).emailInvalid).toBe(false);
    expect(
      (await readMessage(message.id)).status,
      'still claimable, because this one deserves another try'
    ).toBe(OUTBOUND_STATUS.FAILED);
  });

  it('still re-drives a message refused by our own quota', async () => {
    sendBehaviour = async () => {
      throw new Error('550 5.4.6 Sender Hourly Quota Exceeded');
    };
    const { message, enrollment, task } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    await run(() =>
      prisma.outboundMessage.update({
        where: { id: message.id },
        data: { createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) },
      })
    );
    enqueueReschedule.mockClear();
    await run(() => handleRepair({ types: ['stale-pending-outbound'] }));

    expect(redrivenIds(), 'our own quota is temporary — this one deserves another try').toContain(
      message.id
    );
  });

  it('refuses a later send to a suppressed address without calling the provider', async () => {
    sendBehaviour = async () => {
      throw new Error('550 5.1.1 user unknown');
    };
    const first = await openStep();
    await attempt(first.message.id, first.task.id, first.enrollment.id);

    // A second cadence, a second message — the shape of "another campaign picks up the lead".
    await run(async () => {
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceStep: 1, sequenceStatus: 'active' },
      });
    });
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    sendCalls = 0;
    const second = await openStep();
    await attempt(second.message.id, second.task.id, second.enrollment.id);

    expect(sendCalls, 'the provider must never hear about this address again').toBe(0);
    expect(
      (await readMessage(second.message.id)).status,
      'terminal, so the sweep does not keep re-queueing a send that can only be refused'
    ).toBe(OUTBOUND_STATUS.PERMANENTLY_FAILED);
  });
});
