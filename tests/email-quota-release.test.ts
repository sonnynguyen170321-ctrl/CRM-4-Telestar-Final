import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * A daily send slot is spent by a send, never by an attempt.
 *
 * `atomicReserveQuota` increments `EmailAccount.dailySendCount` *before* the provider call,
 * and it has to: the increment is the concurrency guard that stops two workers both deciding
 * there is room for the last send of the day. That makes the counter a reservation, and every
 * path that abandons an attempt after taking one owes the slot back.
 *
 * Nothing gave it back. `failed` is in `CLAIMABLE_STATUSES`, so a message the provider refuses
 * is not finished — it is retried, claims again, and reserves a *second* slot. The first is
 * gone. Measured on production 2026-09-18: `Judy@itelestar.com`, cap 80, counter 80, and
 * exactly 50 messages actually sent that day. Same on 09-17. Roughly 30 sends of capacity
 * destroyed per day, which is why 278 imported leads sat in a queue that never drained and the
 * operator reported having to send by hand.
 *
 * The distinction these tests pin is the one that makes the fix safe rather than merely
 * generous. `not_sent` means the provider refused and nothing left the building, so the slot
 * returns. `ambiguous` means a timeout or a dropped socket, where the prospect may well have
 * the message; that slot stays spent, because handing it back would let the mailbox exceed the
 * real cap — the single thing a cap exists to prevent.
 *
 * Real Postgres and the real handler, following `tests/email-send-once-invariant.test.ts`: the
 * counter is raw SQL behind the tenant extension, and a mocked client cannot prove an UPDATE
 * matched the row it was supposed to match.
 */

let sendBehaviour: () => Promise<string | undefined> = async () => `provider-${crypto.randomUUID()}`;

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn().mockResolvedValue({
      send: async () => sendBehaviour(),
    }),
  },
}));

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn().mockResolvedValue('job-1'),
  enqueueReschedule: vi.fn().mockResolvedValue('job-1'),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
}));

// The send has to be a real one. The dry-run short circuit marks the row sent without ever
// reaching the provider, and would make every assertion here vacuous.
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

let hasDb = false;
try {
  if (process.env.DATABASE_URL) {
    await prisma.$queryRaw`SELECT 1`;
    hasDb = true;
  }
} catch {
  hasDb = false;
}

const T = 'quota-release-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);

let accountId = '';
let leadId = '';

/** Midnight local, the same boundary `atomicReserveQuota` and `releaseQuota` compare against. */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function seed() {
  await run(async () => {
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
    await prisma.lead.deleteMany({ where: { tenantId: T } });
    await prisma.campaign.deleteMany({ where: { tenantId: T } });
    await prisma.client.deleteMany({ where: { tenantId: T } });
    await prisma.emailAccount.deleteMany({ where: { tenantId: T } });
    await prisma.user.deleteMany({ where: { tenantId: T } });
    await prisma.tenant.deleteMany({ where: { id: T } });

    await prisma.tenant.create({ data: { id: T, name: 'Quota Release' } });
    const user = await prisma.user.create({
      data: {
        tenantId: T,
        email: 'owner@quota.test',
        firstName: 'Owner',
        lastName: 'Quota',
        role: 'sdr',
        password: 'x',
        isActive: true,
      },
    });
    const account = await prisma.emailAccount.create({
      data: {
        tenantId: T,
        userId: user.id,
        email: 'sender@quota.test',
        provider: 'imap_smtp',
        isActive: true,
        dailyCap: 10,
        dailySendCount: 0,
        dailySendDate: today(),
      },
    });
    const client = await prisma.client.create({
      data: {
        tenantId: T,
        name: 'Quota Client',
        industry: 'Logistics',
        contactName: 'Chris Contact',
        contactEmail: 'chris@quota.test',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: T, clientId: client.id, name: 'Quota Campaign', startDate: new Date() },
    });
    const lead = await prisma.lead.create({
      data: {
        tenantId: T,
        firstName: 'Pat',
        lastName: 'Prospect',
        email: 'prospect@quota.test',
        company: 'Prospect Co',
        assignedToId: user.id,
        campaignId: campaign.id,
      },
    });
    accountId = account.id;
    leadId = lead.id;
  });
}

async function createMessage(key: string) {
  return run(() =>
    prisma.outboundMessage.create({
      data: {
        tenantId: T,
        leadId,
        accountId,
        to: 'prospect@quota.test',
        subject: 'Quota',
        body: 'Hello',
        idempotencyKey: key,
        status: OUTBOUND_STATUS.PENDING,
      },
    })
  );
}

async function sendCount(): Promise<number> {
  const account = await run(() =>
    prisma.emailAccount.findUniqueOrThrow({
      where: { id: accountId },
      select: { dailySendCount: true },
    })
  );
  return account.dailySendCount;
}

/** Drive the handler the way the queue does, swallowing the rethrow a failed send performs. */
async function attempt(outboundMessageId: string) {
  try {
    await run(() =>
      handleEmailSend({
        outboundMessageId,
        accountId,
        to: 'prospect@quota.test',
        subject: 'Quota',
        body: 'Hello',
        leadId,
      } as never)
    );
  } catch {
    // The handler rethrows so BullMQ retries. What happens to the counter is the subject here.
  }
}

describe.skipIf(!hasDb)('daily send quota is spent by sends, not by attempts', () => {
  beforeAll(seed);

  beforeEach(async () => {
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { dailySendCount: 0, dailySendDate: today() },
      });
    });
  });

  it('spends one slot when the message is actually sent', async () => {
    const msg = await createMessage(`ok-${crypto.randomUUID()}`);
    await attempt(msg.id);

    expect(await sendCount()).toBe(1);
    const after = await run(() =>
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } })
    );
    expect(after.status).toBe(OUTBOUND_STATUS.SENT);
  });

  it('returns the slot when the provider refuses the message outright', async () => {
    // `invalid recipient` classifies as `not_sent`: nothing was queued for delivery, and the
    // row goes back into the claimable pool, so its reservation must go back with it.
    sendBehaviour = async () => {
      throw new Error('550 invalid recipient');
    };
    const msg = await createMessage(`refused-${crypto.randomUUID()}`);
    await attempt(msg.id);

    const after = await run(() =>
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } })
    );
    expect(after.status).toBe(OUTBOUND_STATUS.FAILED);
    expect(
      await sendCount(),
      'a refused message never reached the prospect — it must not cost the mailbox a send'
    ).toBe(0);
  });

  it('keeps the slot spent when the outcome is ambiguous', async () => {
    // A dropped socket may already have been accepted by the provider. Returning this slot
    // would let the mailbox send past its real cap, which is the failure a cap prevents.
    sendBehaviour = async () => {
      throw new Error('socket hang up');
    };
    const msg = await createMessage(`ambiguous-${crypto.randomUUID()}`);
    await attempt(msg.id);

    const after = await run(() =>
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } })
    );
    expect(after.status).toBe(OUTBOUND_STATUS.RECONCILIATION_REQUIRED);
    expect(
      await sendCount(),
      'the message may be with the prospect, so the slot stays spent'
    ).toBe(1);
  });

  it('does not let a refused message plus its retry cost two slots', async () => {
    // This is the production shape: 48 messages reached `sent` on their second attempt, and
    // each had paid for the first. One message, one delivered email, one slot.
    let calls = 0;
    sendBehaviour = async () => {
      calls += 1;
      if (calls === 1) throw new Error('550 message rejected');
      return `provider-${crypto.randomUUID()}`;
    };

    const msg = await createMessage(`retry-${crypto.randomUUID()}`);
    await attempt(msg.id);
    await attempt(msg.id);

    const after = await run(() =>
      prisma.outboundMessage.findUniqueOrThrow({ where: { id: msg.id } })
    );
    expect(after.status).toBe(OUTBOUND_STATUS.SENT);
    expect(calls).toBe(2);
    expect(
      await sendCount(),
      'one message that eventually sent must cost exactly one slot, however many attempts it took'
    ).toBe(1);
  });

  it('does not reach back across midnight to discount a day that has rolled over', async () => {
    // A release landing after the day boundary would discount today for yesterday's attempt.
    // The reservation is dated, so a stale release finds nothing to give back.
    sendBehaviour = async () => {
      throw new Error('550 invalid recipient');
    };
    const yesterday = new Date(today().getTime() - 24 * 3600 * 1000);
    await run(() =>
      prisma.emailAccount.update({
        where: { id: accountId },
        data: { dailySendCount: 7, dailySendDate: yesterday },
      })
    );

    const msg = await createMessage(`rollover-${crypto.randomUUID()}`);
    await attempt(msg.id);

    // The reservation itself rolled the day over and started today at 1; the release then
    // returns that one slot, and yesterday's 7 are not carried into today by either.
    //
    // The date is asserted as "moved on from yesterday" rather than as an exact instant.
    // `dailySendDate` is a bare `DateTime`, so Postgres stores it without a zone and Prisma
    // reads it back as UTC; on a machine that is not on UTC the round trip shifts by the
    // offset. That is harmless because reserve and release both compare against the same
    // locally computed midnight, and production runs UTC — but pinning the raw instant here
    // would make this test fail by timezone rather than by behaviour.
    const account = await run(() =>
      prisma.emailAccount.findUniqueOrThrow({
        where: { id: accountId },
        select: { dailySendCount: true, dailySendDate: true },
      })
    );
    expect(account.dailySendDate!.getTime()).toBeGreaterThan(yesterday.getTime());
    expect(
      account.dailySendCount,
      "yesterday's 7 sends must not follow the mailbox into today"
    ).toBe(0);
  });

  it('never mints capacity, however many times a release runs', async () => {
    // A floor at zero, so a double release cannot hand the mailbox sends it never had.
    sendBehaviour = async () => {
      throw new Error('550 invalid recipient');
    };
    const first = await createMessage(`floor-a-${crypto.randomUUID()}`);
    const second = await createMessage(`floor-b-${crypto.randomUUID()}`);
    await attempt(first.id);
    await attempt(second.id);

    expect(await sendCount()).toBe(0);
  });
});
