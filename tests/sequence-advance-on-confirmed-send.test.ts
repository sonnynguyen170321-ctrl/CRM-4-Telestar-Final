import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import crypto from 'crypto';

/**
 * A cadence step settles on what the provider did, not on what we asked it to do.
 *
 * `workers/sequence.ts` used to enqueue the send and then, unconditionally and in the next four
 * statements, complete the task, increment `Lead.emailSentCount` and `AbTestVariant.sentCount`,
 * and call `advanceSequence`. Every one of those recorded an outcome at *enqueue* time.
 *
 * On 2026-09-21 the provider refused 228 messages at once (`550 5.4.6 Sender Hourly Quota
 * Exceeded` — all 278 due jobs fired inside one minute at 02:00). The CRM had already booked
 * 228 completed tasks and 228 enrollments at step 2. It believed 228 first emails had landed,
 * and would have sent follow-ups saying "just circling back" to prospects who had never been
 * written to. 251 leads carried a non-zero `emailSentCount` with no sent row behind it.
 *
 * These tests pin the two halves of the fix:
 *
 *  - the step advances only after a confirmed send, and a definitive refusal gives the step
 *    back and pauses the cadence for a human to decide (`lib/sequences/stepOutcome.ts`);
 *  - the mailbox's hourly ceiling is checked against real sent rows before a slot is reserved,
 *    so the burst that triggered the refusal cannot re-form.
 *
 * Real Postgres and the real handler, following `tests/email-quota-release.test.ts`: the settle
 * path is compare-and-set SQL, and a mocked client cannot prove an UPDATE matched the row it
 * was meant to match.
 */

let sendBehaviour: () => Promise<string | undefined> = async () => `provider-${crypto.randomUUID()}`;

vi.mock('@/lib/email/EmailService', () => ({
  EmailService: {
    fromAccount: vi.fn().mockResolvedValue({
      send: async () => sendBehaviour(),
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
const { finalizeSequenceStep } = await import('@/lib/sequences/stepOutcome');
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

const T = 'step-outcome-tenant';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);

function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

let userId = '';
let accountId = '';
let leadId = '';
let sequenceId = '';

async function seed() {
  await run(async () => {
    await prisma.activity.deleteMany({ where: { tenantId: T } });
    await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
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

    await prisma.tenant.create({ data: { id: T, name: 'Step Outcome' } });
    const user = await prisma.user.create({
      data: {
        tenantId: T,
        email: 'owner@stepoutcome.test',
        firstName: 'Owner',
        lastName: 'Step',
        role: 'sdr',
        password: 'x',
        isActive: true,
      },
    });
    const account = await prisma.emailAccount.create({
      data: {
        tenantId: T,
        userId: user.id,
        email: 'sender@stepoutcome.test',
        provider: 'imap_smtp',
        isActive: true,
        dailyCap: 100,
        // 0 means "no hourly ceiling"; the burst tests raise it to a real number.
        hourlyCap: 0,
        dailySendCount: 0,
        dailySendDate: today(),
      },
    });
    const client = await prisma.client.create({
      data: {
        tenantId: T,
        name: 'Step Client',
        industry: 'Logistics',
        contactName: 'Chris Contact',
        contactEmail: 'chris@stepoutcome.test',
      },
    });
    const campaign = await prisma.campaign.create({
      data: { tenantId: T, clientId: client.id, name: 'Step Campaign', startDate: new Date() },
    });
    // Two steps, so advancing from step 1 has somewhere to go rather than ending the cadence.
    const sequence = await prisma.sequence.create({
      data: {
        tenantId: T,
        name: 'Step Sequence',
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
        firstName: 'Pat',
        lastName: 'Prospect',
        email: 'prospect@stepoutcome.test',
        company: 'Prospect Co',
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

/** One cadence occurrence, one open step-1 task, one claimable message — where a send starts. */
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
        to: 'prospect@stepoutcome.test',
        subject: 'Step 1',
        body: 'Hello',
        idempotencyKey: `step-${crypto.randomUUID()}`,
        status: OUTBOUND_STATUS.PENDING,
        sequenceId,
        sequenceStepOrder: 1,
      },
    });
    return { enrollment, task, message };
  });
}

/** Reset the lead and clear the occupancy so a second cadence occurrence can be opened. */
async function reopenLead() {
  await run(async () => {
    await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
    await prisma.lead.update({
      where: { id: leadId },
      data: { sequenceStep: 1, sequenceStatus: 'active', sequenceId },
    });
  });
}

async function attempt(outboundMessageId: string, taskId: string, enrollmentId: string) {
  try {
    await run(() =>
      handleEmailSend({
        outboundMessageId,
        accountId,
        to: 'prospect@stepoutcome.test',
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
    // The handler rethrows so BullMQ retries. What the cadence recorded is the subject here.
  }
}

const readTask = (id: string) => run(() => prisma.task.findUniqueOrThrow({ where: { id } }));
const readEnrollment = (id: string) =>
  run(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id } }));
const readMessage = (id: string) =>
  run(() => prisma.outboundMessage.findUniqueOrThrow({ where: { id } }));
const readLead = () => run(() => prisma.lead.findUniqueOrThrow({ where: { id: leadId } }));

describe.skipIf(!hasDb)('a cadence step settles on the provider outcome', () => {
  beforeAll(seed);

  beforeEach(async () => {
    enqueueReschedule.mockClear();
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceStep: 1, sequenceStatus: 'active', sequenceId, emailSentCount: 0 },
      });
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { dailySendCount: 0, dailySendDate: today(), hourlyCap: 0 },
      });
    });
  });

  it('advances the cadence once the provider has accepted the message', async () => {
    const { task, message, enrollment } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    expect((await readMessage(message.id)).status).toBe(OUTBOUND_STATUS.SENT);
    expect((await readTask(task.id)).status).toBe('completed');
    expect((await readEnrollment(enrollment.id)).currentStep).toBe(2);
    expect((await readLead()).emailSentCount).toBe(1);
  });

  it('gives the step back and pauses the cadence when the provider refuses', async () => {
    // A sender-side refusal: nothing reached the prospect, so nothing about the cadence may
    // move. This is the exact shape of the 228. Deliberately *not* a recipient-side refusal —
    // that one also suppresses the address and ends the message terminally, which is
    // `tests/bounce-suppression.test.ts`.
    sendBehaviour = async () => {
      throw new Error('550 5.4.6 Sender Hourly Quota Exceeded');
    };
    const { task, message, enrollment } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    const settledTask = await readTask(task.id);
    const after = await readEnrollment(enrollment.id);
    expect((await readMessage(message.id)).status).toBe(OUTBOUND_STATUS.FAILED);
    expect(settledTask.status, 'a refused send leaves its step open').toBe('pending');
    expect(settledTask.lockedAt, 'and unlocked, so a redrive can claim it').toBeNull();
    expect(after.status).toBe('paused');
    expect(after.pausedReason).toBe('send_failed');
    expect(
      after.currentStep,
      'step 2 must never reference a step 1 the prospect never received'
    ).toBe(1);
    expect((await readLead()).emailSentCount).toBe(0);
  });

  it('leaves an ambiguous outcome unsettled rather than guessing', async () => {
    // A dropped socket may already have been accepted. Completing the step would claim a send
    // that might not exist; pausing would strand a cadence that may be fine. The row goes to
    // `reconciliation_required` and the maintenance sweep decides once there is evidence.
    sendBehaviour = async () => {
      throw new Error('socket hang up');
    };
    const { task, message, enrollment } = await openStep();
    await attempt(message.id, task.id, enrollment.id);

    const after = await readEnrollment(enrollment.id);
    expect((await readMessage(message.id)).status).toBe(OUTBOUND_STATUS.RECONCILIATION_REQUIRED);
    expect((await readTask(task.id)).status).toBe('pending');
    expect(after.status).toBe('active');
    expect(after.currentStep).toBe(1);
  });

  it('still advances a step whose task was closed but whose cadence never moved', async () => {
    // The crash window: the task completes, then the process dies before `advanceSequence`.
    // Returning early on "task already completed" would strand that cadence permanently — the
    // step looks done, the enrollment never moves, and no sweep re-opens a completed task. So
    // the counters hang off the compare-and-set and the advance does not.
    const { task, enrollment } = await openStep();
    await run(async () => {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'completed', completedAt: new Date(), lockedAt: null },
      });
      await prisma.lead.update({ where: { id: leadId }, data: { emailSentCount: 1 } });
    });

    await finalizeSequenceStep({
      taskId: task.id,
      leadId,
      actorUserId: userId,
      sequenceId,
      sequenceStep: 1,
      enrollmentId: enrollment.id,
    });

    expect((await readEnrollment(enrollment.id)).currentStep).toBe(2);
    expect(
      (await readLead()).emailSentCount,
      'the send was already counted; converging on the advance must not count it again'
    ).toBe(1);
  });

  it('does not advance twice when the same send is re-driven', async () => {
    const { task, message, enrollment } = await openStep();
    await attempt(message.id, task.id, enrollment.id);
    await attempt(message.id, task.id, enrollment.id);

    expect((await readEnrollment(enrollment.id)).currentStep).toBe(2);
    expect(
      (await readLead()).emailSentCount,
      'one delivered email is one send, however many times the job ran'
    ).toBe(1);
  });
});

describe.skipIf(!hasDb)('the mailbox hourly ceiling is enforced before a slot is reserved', () => {
  beforeAll(seed);

  beforeEach(async () => {
    enqueueReschedule.mockClear();
    sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
    await run(async () => {
      await prisma.activity.deleteMany({ where: { tenantId: T } });
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { dailySendCount: 0, dailySendDate: today(), hourlyCap: 1 },
      });
      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceStep: 1, sequenceStatus: 'active', sequenceId, emailSentCount: 0 },
      });
    });
  });

  it('defers the send past the hour instead of letting the provider refuse it', async () => {
    const first = await openStep();
    await attempt(first.message.id, first.task.id, first.enrollment.id);
    expect((await readMessage(first.message.id)).status).toBe(OUTBOUND_STATUS.SENT);

    // The ceiling counts real sent rows rather than a counter column, so it cannot drift away
    // from what the provider actually saw.
    await reopenLead();
    const second = await openStep();
    enqueueReschedule.mockClear();
    await attempt(second.message.id, second.task.id, second.enrollment.id);

    const msg = await readMessage(second.message.id);
    expect(msg.status, 'a deferred send stays claimable').toBe(OUTBOUND_STATUS.PENDING);
    expect(msg.sentAt).toBeNull();
    expect(
      enqueueReschedule,
      'the deferral must carry its own job or the message is lost'
    ).toHaveBeenCalled();
    expect((await readTask(second.task.id)).status, 'a deferral is not an outcome').toBe('pending');
    expect((await readEnrollment(second.enrollment.id)).currentStep).toBe(1);
  });

  it('does not spend a daily slot on a send the hourly ceiling refuses', async () => {
    // The gate sits *before* `atomicReserveQuota`. Reserving first and deferring after is how
    // capacity leaked before PR #185, and an hourly defer would re-open the same hole.
    const first = await openStep();
    await attempt(first.message.id, first.task.id, first.enrollment.id);
    await reopenLead();

    const second = await openStep();
    await attempt(second.message.id, second.task.id, second.enrollment.id);

    const account = await run(() =>
      prisma.emailAccount.findUniqueOrThrow({
        where: { id: accountId },
        select: { dailySendCount: true },
      })
    );
    expect(account.dailySendCount, 'one send happened, so one daily slot is spent').toBe(1);
  });
});

describe.skipIf(!hasDb)('a refused message stays reachable by a repair sweep', () => {
  beforeAll(seed);

  beforeEach(async () => {
    enqueueReschedule.mockClear();
    await run(async () => {
      await prisma.outboundMessage.deleteMany({ where: { tenantId: T } });
      await prisma.task.deleteMany({ where: { tenantId: T } });
      await prisma.sequenceEnrollment.deleteMany({ where: { tenantId: T } });
      await prisma.emailAccount.update({
        where: { id: accountId },
        data: { dailySendCount: 0, dailySendDate: today(), hourlyCap: 0 },
      });
      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceStep: 1, sequenceStatus: 'active', sequenceId, emailSentCount: 0 },
      });
    });
  });

  /** Old enough for the staleness cutoff, so the sweep considers it abandoned. */
  const ANCIENT = new Date(Date.now() - 3 * 60 * 60 * 1000);

  it('re-drives a failed message that no queue is holding any more', async () => {
    // `repairStalePendingOutbound` scanned only `pending`. `failed` is in `CLAIMABLE_STATUSES`
    // and means the prospect was definitely not written to, so a failed row is retryable — but
    // being in no sweep's query, nothing ever retried it. On 2026-09-21 that stranded 228
    // messages with `delayed=0` and `wait=0`: not one of them would ever have been sent again.
    const { message, task, enrollment } = await openStep();
    await run(() =>
      prisma.outboundMessage.update({
        where: { id: message.id },
        data: {
          status: OUTBOUND_STATUS.FAILED,
          errorMessage: '550 5.4.6 Sender Hourly Quota Exceeded',
          attemptCount: 1,
          createdAt: ANCIENT,
        },
      })
    );

    await run(() => handleRepair({ types: ['stale-pending-outbound'] }));

    // Matched to this message rather than to `calls[0]`: the sweep is not tenant-scoped, and the
    // shared test database always holds other suites' rows, so the first call is whichever row
    // happened to sort first.
    const payload = enqueueReschedule.mock.calls
      .map((call) => call[1] as Record<string, unknown>)
      .find((p) => p?.outboundMessageId === message.id);
    expect(payload, 'a failed send must be re-driven, not abandoned').toBeDefined();
    // The redrive starts from the stored row, so the step reference has to be rebuilt — without
    // it the recovered message would send and leave its step open forever.
    expect(payload!.sequenceStepRef).toMatchObject({
      taskId: task.id,
      leadId,
      sequenceStep: 1,
      enrollmentId: enrollment.id,
    });
  });

  it('leaves a message alone once it has exhausted its redrives', async () => {
    // Past the cap the decision belongs to a human. Re-driving forever would hide a permanently
    // bad address behind an infinite retry, and a sweep that loops is its own incident.
    const { message } = await openStep();
    await run(() =>
      prisma.outboundMessage.update({
        where: { id: message.id },
        data: { status: OUTBOUND_STATUS.FAILED, attemptCount: 5, createdAt: ANCIENT },
      })
    );

    await run(() => handleRepair({ types: ['stale-pending-outbound'] }));

    // Again matched to this message: the sweep sees every tenant's rows in a shared database.
    expect(
      enqueueReschedule.mock.calls.map((call) => (call[1] as { outboundMessageId?: string })?.outboundMessageId)
    ).not.toContain(message.id);
  });

  /**
   * The third outcome, and the one with nowhere else to go.
   *
   * `workers/email.ts` settles nothing while a send is ambiguous, because the prospect may or
   * may not have the message. That is right — but it means the step stays open, and the only
   * thing that ever learns the answer is `reconcileAmbiguousSends`. If that sweep does not
   * settle the step, the cadence is stuck forever with nothing left to wake it: the task never
   * completes, the follow-up never fires, and no human is told. Same silence as 2026-09-21,
   * reached by a different road.
   */
  describe('and an ambiguous one is settled when the sweep learns the answer', () => {
    it('advances the cadence when delivery evidence turns up', async () => {
      const { message, task, enrollment } = await openStep();
      await run(() =>
        prisma.outboundMessage.update({
          where: { id: message.id },
          data: {
            status: OUTBOUND_STATUS.RECONCILIATION_REQUIRED,
            providerMessageId: `provider-${crypto.randomUUID()}`,
            claimedAt: ANCIENT,
          },
        })
      );

      await run(() => handleRepair({ types: ['outbound-reconcile'] }));

      expect((await readMessage(message.id)).status).toBe(OUTBOUND_STATUS.SENT);
      expect((await readTask(task.id)).status).toBe('completed');
      expect((await readEnrollment(enrollment.id)).currentStep).toBe(2);
    });

    it('pauses the cadence when the grace window closes with no answer', async () => {
      // Not retried, so the follow-up must not go out behind it. A paused enrollment carries a
      // reason an SDR can act on; an active one silently stalled does not.
      const { message, task, enrollment } = await openStep();
      await run(() =>
        prisma.outboundMessage.update({
          where: { id: message.id },
          data: {
            status: OUTBOUND_STATUS.RECONCILIATION_REQUIRED,
            claimedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
          },
        })
      );

      await run(() => handleRepair({ types: ['outbound-reconcile'] }));

      const after = await readEnrollment(enrollment.id);
      expect((await readMessage(message.id)).status).toBe('permanently_failed');
      expect((await readTask(task.id)).status).toBe('pending');
      expect(after.status).toBe('paused');
      expect(after.pausedReason).toBe('send_failed');
      expect(after.currentStep).toBe(1);
    });
  });
});
