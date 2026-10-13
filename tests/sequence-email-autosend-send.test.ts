import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * Every way a sequence email step ends has to end its task too.
 *
 * Until now a step could finish four ways and only one of them touched the task: an accepted send
 * completed it, but a refused send, a barred step, a capped mailbox and a composer send left it
 * pending - overdue, with a Complete button that advanced the cadence past an email nobody got.
 * Real Postgres and the real handlers; the provider and the queues are fakes.
 */

let sendBehaviour: () => Promise<string | undefined> = async () => `provider-${crypto.randomUUID()}`;

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/email/EmailService', () => ({
  EmailService: { fromAccount: vi.fn().mockResolvedValue({ send: async () => sendBehaviour() }) },
}));
vi.mock('@/lib/emailSafety', () => ({
  effectiveDryRun: () => false,
  isGlobalEmailPaused: () => false,
  isCanaryRecipientAllowed: () => true,
  isAutosendEnabled: () => true,
  isDryRun: () => false,
}));
vi.mock('@/lib/bullmq/queues', async () => {
  const { fakeQueues } = await import('./helpers/fakeQueue');
  return fakeQueues();
});

const enqueued = vi.hoisted(() => ({ calls: [] as Array<{ type: string; payload: any }> }));
vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: vi.fn(async (type: string, payload: unknown) => {
    enqueued.calls.push({ type, payload });
    return 'job-1';
  }),
  enqueueReschedule: vi.fn(async (type: string, payload: unknown) => {
    enqueued.calls.push({ type: `${type}:reschedule`, payload });
    return 'job-1';
  }),
  enqueueImmediate: vi.fn().mockResolvedValue('job-1'),
}));

const authUser = vi.hoisted(() => ({ current: null as SessionUser | null }));
vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  const { NextResponse } = await import('next/server');
  return {
    ...actual,
    requireAuth: async () => authUser.current ?? NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
});

import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { handleExecuteTask } from '@/workers/sequence';
import { handleEmailSend } from '@/workers/email';
import { POST as sendRoute } from '@/app/api/email/send/route';
import { resumeEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { OUTBOUND_STATUS } from '@/lib/email/idempotency';
import { resetFakeQueue } from './helpers/fakeQueue';
import { seedAutosendTenant, seedCadence, type AutosendTenant, type Cadence } from './helpers/autosendFixture';

let t: AutosendTenant;

beforeEach(async () => {
  resetFakeQueue();
  enqueued.calls.length = 0;
  sendBehaviour = async () => `provider-${crypto.randomUUID()}`;
  t = await seedAutosendTenant('autosend-send');
  authUser.current = t.user;
});

const readTask = (id: string) => t.inTenant(() => prisma.task.findUniqueOrThrow({ where: { id } }));
const readEnrollment = (id: string) => t.inTenant(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id } }));
const readLead = (id: string) => t.inTenant(() => prisma.lead.findUniqueOrThrow({ where: { id } }));

/** The email-send job the sequence worker (or the composer route) handed to the mail worker. */
const lastEmailJob = () => {
  const job = [...enqueued.calls].reverse().find((c) => c.type === 'email.send');
  if (!job) throw new Error('no email.send job was enqueued');
  return job.payload;
};

const runMailWorker = async (payload: unknown) => {
  try {
    return await t.inTenant(() => handleEmailSend(payload as never));
  } catch {
    // The handler rethrows a refusal so BullMQ can retry; what the cadence recorded is the subject.
    return undefined;
  }
};

const execute = (c: Cadence) => t.inTenant(() => handleExecuteTask({ taskId: c.taskId, expectedEnrollmentId: c.enrollmentId }));

describe('an automatic step completes its task on a confirmed send', () => {
  it('queues the send without closing the task, then closes it and advances once the provider accepts', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });

    expect(await execute(c)).toMatchObject({ status: 'queued' });
    expect((await readTask(c.taskId)).status, 'queued is not sent').toBe('pending');
    expect((await readEnrollment(c.enrollmentId)).currentStep).toBe(1);

    await runMailWorker(lastEmailJob());

    expect(await readTask(c.taskId)).toMatchObject({ status: 'completed', lockedAt: null });
    expect((await readEnrollment(c.enrollmentId)).currentStep).toBe(2);
    expect((await readLead(c.leadId)).emailSentCount).toBe(1);
    const sent = await t.inTenant(() => prisma.outboundMessage.findFirstOrThrow({ where: { leadId: c.leadId } }));
    expect(sent).toMatchObject({ status: 'sent', sequenceId: c.sequenceId, sequenceStepOrder: 1 });
  });
});

describe('a refused send settles the task', () => {
  it('skips it as send_failed with the reason, pauses the cadence, and a resume brings it back clean', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    sendBehaviour = async () => {
      throw new Error('550 5.7.1 Message rejected by sender policy');
    };
    await execute(c);
    await runMailWorker(lastEmailJob());

    const task = await readTask(c.taskId);
    expect(task).toMatchObject({ status: 'skipped', outcome: 'send_failed', lockedAt: null });
    expect(task.notes).toContain('sender policy');
    expect(await readEnrollment(c.enrollmentId)).toMatchObject({ status: 'paused', pausedReason: 'send_failed', currentStep: 1 });

    // The rep fixes the problem and resumes: the same step is runnable again, without the old reason.
    // The earlier failed message is cleared so this run can send (a message that failed definitively is terminal).
    await t.inTenant(() => prisma.outboundMessage.deleteMany({ where: { leadId: c.leadId } }));
    const resumed = await t.inTenant(() =>
      resumeEnrollmentOccurrence({ enrollmentId: c.enrollmentId, leadId: c.leadId, sequenceId: c.sequenceId, tenantId: t.tenantId })
    );
    expect(resumed.ok).toBe(true);
    expect(await readTask(c.taskId)).toMatchObject({ status: 'pending', outcome: null, notes: null });
  });
});

describe('a barred step settles the task', () => {
  it('closes it with the reason when the bar is final (the lead is archived)', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => prisma.lead.update({ where: { id: c.leadId }, data: { archivedAt: new Date() } }));

    expect(await execute(c)).toMatchObject({ status: 'skipped', reason: 'lead_archived' });

    expect(await readTask(c.taskId)).toMatchObject({ status: 'skipped', outcome: 'send_blocked' });
    expect(enqueued.calls.filter((x) => x.type === 'email.send')).toHaveLength(0);
  });

  it('waits and looks again when the bar can be lifted (the campaign is paused)', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => prisma.campaign.update({ where: { id: t.campaignId }, data: { status: 'paused' } }));

    const result = await execute(c);

    expect(result).toMatchObject({ status: 'deferred', reason: 'campaign_paused' });
    const task = await readTask(c.taskId);
    expect(task.status, 'not closed: resuming the campaign must pick it up').toBe('pending');
    expect(task.dueDate.getTime(), 'the due date moves to the recheck').toBeGreaterThan(Date.now() + 5 * 3_600_000);
    expect((await readEnrollment(c.enrollmentId)).holdReason).toBe('campaign_paused');
    expect(enqueued.calls.some((x) => x.type === 'sequence.execute-task:reschedule')).toBe(true);
  });

  it('leaves it pending, with the hold recorded, when the lead replied (the rep may hand them back)', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => prisma.lead.update({ where: { id: c.leadId }, data: { stage: 'replied' } }));

    expect(await execute(c)).toMatchObject({ status: 'skipped', reason: 'lead_replied' });

    expect((await readTask(c.taskId)).status).toBe('pending');
    expect((await readEnrollment(c.enrollmentId)).holdReason).toBe('lead_replied');
  });
});

describe('a worker deferral moves the task\'s due date', () => {
  it('moves it to the resume time when the mailbox hourly cap is reached', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(async () => {
      await prisma.emailAccount.update({ where: { id: t.accountId }, data: { hourlyCap: 1 } });
      // One message already went out from this mailbox in the last hour.
      await prisma.outboundMessage.create({
        data: {
          tenantId: t.tenantId, leadId: c.leadId, accountId: t.accountId, to: 'x@y.test', subject: 's', body: 'b',
          idempotencyKey: `earlier-${crypto.randomUUID()}`, status: OUTBOUND_STATUS.SENT, sentAt: new Date(),
        },
      });
    });
    await execute(c);

    const result = await runMailWorker(lastEmailJob());

    expect(result).toMatchObject({ deferred: true, reason: 'hourly_quota' });
    const task = await readTask(c.taskId);
    expect(task.status).toBe('pending');
    expect(task.dueDate.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect((await readEnrollment(c.enrollmentId)).nextActionAt?.getTime()).toBe(task.dueDate.getTime());
  });

  it('moves it when the provider says its own limit was reached', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    sendBehaviour = async () => {
      throw new Error('550 5.4.6 Sender Hourly Quota Exceeded');
    };
    await execute(c);

    const result = await runMailWorker(lastEmailJob());

    expect(result).toMatchObject({ deferred: true, reason: 'provider_limit' });
    const task = await readTask(c.taskId);
    expect(task.status, 'a deferral is not a failure').toBe('pending');
    expect(task.dueDate.getTime()).toBeGreaterThan(Date.now() + 30 * 60_000);
    expect((await readEnrollment(c.enrollmentId)).status).toBe('active');
  });
});

describe('a manual email step written in the composer', () => {
  const send = (body: Record<string, unknown>) =>
    t.inTenant(() =>
      sendRoute(
        new NextRequest('http://localhost/api/email/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      )
    );
  const composed = (c: Cadence, extra: Record<string, unknown> = {}) => ({
    accountId: t.accountId,
    to: c.email,
    leadId: c.leadId,
    subject: 'Quick question',
    body: 'Hello there',
    taskId: c.taskId,
    clientRequestId: crypto.randomUUID(),
    ...extra,
  });

  it('closes the task and advances the cadence only after the provider confirms', async () => {
    const c = await seedCadence(t, { autoComplete: false, withTemplate: false });

    const res = await send(composed(c));
    expect(res.status).toBe(200);

    // Queued, not sent: the step has not moved, and the message carries the step it belongs to.
    expect((await readTask(c.taskId)).status).toBe('pending');
    expect((await readEnrollment(c.enrollmentId)).currentStep).toBe(1);
    const outbound = await t.inTenant(() => prisma.outboundMessage.findFirstOrThrow({ where: { leadId: c.leadId } }));
    expect(outbound).toMatchObject({ sequenceId: c.sequenceId, sequenceStepOrder: 1 });
    expect(lastEmailJob().sequenceStepRef).toMatchObject({
      taskId: c.taskId, sequenceId: c.sequenceId, sequenceStep: 1, enrollmentId: c.enrollmentId, actorUserId: t.userId,
    });

    await runMailWorker(lastEmailJob());

    expect((await readTask(c.taskId)).status).toBe('completed');
    expect((await readEnrollment(c.enrollmentId)).currentStep).toBe(2);
    expect((await readLead(c.leadId)).emailSentCount).toBe(1);
  });

  it('does not close the task when the provider refuses it: the step is settled as failed', async () => {
    const c = await seedCadence(t, { autoComplete: false, withTemplate: false });
    sendBehaviour = async () => {
      throw new Error('550 5.7.1 Message rejected by sender policy');
    };
    await send(composed(c));
    await runMailWorker(lastEmailJob());

    expect(await readTask(c.taskId)).toMatchObject({ status: 'skipped', outcome: 'send_failed' });
    expect((await readEnrollment(c.enrollmentId)).currentStep, 'never past an email nobody received').toBe(1);
  });

  it('refuses a step the CRM sends itself', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });

    const res = await send(composed(c));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'auto_send_pending' });
    expect(await t.inTenant(() => prisma.outboundMessage.count({ where: { leadId: c.leadId } }))).toBe(0);
  });

  it('refuses a task that is already closed, and one for a different lead', async () => {
    const closed = await seedCadence(t, { autoComplete: false, withTemplate: false });
    await t.inTenant(() => prisma.task.update({ where: { id: closed.taskId }, data: { status: 'completed' } }));
    const other = await seedCadence(t, { autoComplete: false, withTemplate: false });

    expect((await send(composed(closed))).status).toBe(409);
    expect((await send(composed(other, { leadId: closed.leadId, to: closed.email }))).status).toBe(400);
  });

  it('does not accept a task id from another tenant', async () => {
    const mine = await seedCadence(t, { autoComplete: false, withTemplate: false });
    const other = await seedAutosendTenant('autosend-send-b');
    const theirs = await seedCadence(other, { autoComplete: false, withTemplate: false });
    authUser.current = other.user;

    // The scoped path (no bypass), as a real request runs: the session's tenant filters every read.
    const res = await tenantStorage.run({ tenantId: other.tenantId }, () =>
      sendRoute(
        new NextRequest('http://localhost/api/email/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...composed(mine), accountId: other.accountId, leadId: theirs.leadId, to: theirs.email }),
        })
      )
    );

    expect(res.status).toBe(404);
    expect((await readTask(mine.taskId)).status).toBe('pending');
    expect(await t.inTenant(() => prisma.outboundMessage.count({ where: { leadId: mine.leadId } }))).toBe(0);
  });
});
