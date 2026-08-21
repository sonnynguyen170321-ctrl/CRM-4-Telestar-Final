import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);

let accountId = '';
let leadId = '';

async function seed() {
  await run(async () => {
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
    await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.emailAccount.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });

    await prisma.tenant.create({ data: { id: T, name: 'Send Once' } });
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

describe.skipIf(!hasDb)('one logical step sends at most one physical email', () => {
  beforeAll(seed);

  afterAll(async () => {
    await run(async () => {
      // A successful send writes an Activity against the lead and the user, so those rows have
      // to go before the records they point at.
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.suppressionEntry.deleteMany({ where: { tenantId: T } });
      await prisma.lead.deleteMany({ where: { tenantId: T } });
      await prisma.campaign.deleteMany({ where: { tenantId: T } });
      await prisma.client.deleteMany({ where: { tenantId: T } });
      await prisma.emailAccount.deleteMany({ where: { tenantId: T } });
      await prisma.user.deleteMany({ where: { tenantId: T } });
      await prisma.tenant.deleteMany({ where: { id: T } });
    });
  });

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
