import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import type { SessionUser } from '@/lib/auth';

/**
 * An email the CRM sends itself is not an errand to tick off.
 *
 * Completing a sequence task advances the cadence. For an email step that sends itself that meant a
 * rep could press Complete before the job had run: step 2 was scheduled and the prospect never got
 * step 1. These tests pin what replaces it - the list says what the CRM is doing with the email,
 * Complete is refused until the send is confirmed (or the rep says they sent it elsewhere), and
 * Skip cancels the queued send. Real Postgres; the queue is an in-memory fake.
 */

vi.mock('@/auth', () => ({ auth: vi.fn(), handlers: {}, signIn: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/bullmq/queues', async () => {
  const { fakeQueues } = await import('./helpers/fakeQueue');
  return fakeQueues();
});

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
import { PUT as putTask, GET as getTaskRoute } from '@/app/api/tasks/[id]/route';
import { POST as bulkRoute } from '@/app/api/tasks/bulk/route';
import { getTasks } from '@/lib/tasks/service';
import { attachEmailStepInfo, deriveEmailStepInfo } from '@/lib/sequences/autoSendState';
import { rescheduleSequenceTask } from '@/lib/bullmq/rescheduleSequenceTask';
import { fakeQueue, resetFakeQueue } from './helpers/fakeQueue';
import { seedAutosendTenant, seedCadence, type AutosendTenant } from './helpers/autosendFixture';

let t: AutosendTenant;

beforeEach(async () => {
  resetFakeQueue();
  t = await seedAutosendTenant('autosend-tasks');
  authUser.current = t.user;
});

const put = (taskId: string, body: Record<string, unknown>) =>
  putTask(
    new NextRequest(`http://localhost/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: taskId }) }
  );

const bulk = (body: Record<string, unknown>) =>
  bulkRoute(
    new NextRequest('http://localhost/api/tasks/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );

/** Schedule the execution job the way the engine does, so a Skip has something to cancel. */
async function scheduleJob(taskId: string, enrollmentId: string) {
  await rescheduleSequenceTask({ taskId, expectedEnrollmentId: enrollmentId, targetDueAt: new Date(Date.now() + 3_600_000), tenantId: t.tenantId });
}

const readTask = (id: string) => t.inTenant(() => prisma.task.findUniqueOrThrow({ where: { id } }));
const readEnrollment = (id: string) => t.inTenant(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id } }));

describe('what the list says about an email the CRM sends itself', () => {
  const base = {
    task: { status: 'pending', dueDate: new Date('2026-10-14T09:30:00Z'), lockedAt: null, outcome: null, notes: null },
    step: { autoComplete: true, templateId: 'tpl' },
    sequenceName: 'Cold outreach',
    stepOrder: 2,
    enrollment: { status: 'active', pausedReason: null, holdReason: null },
    outbound: null,
  };

  it('is scheduled, with its time, while it waits', () => {
    const info = deriveEmailStepInfo(base);
    expect(info).toMatchObject({ automatic: true, state: 'scheduled', label: 'Sending automatically', scheduledAt: '2026-10-14T09:30:00.000Z' });
  });

  it('is held, with the reason, while something blocks it', () => {
    const info = deriveEmailStepInfo({ ...base, enrollment: { ...base.enrollment, holdReason: 'daily_quota_exhausted' } });
    expect(info.state).toBe('held');
    expect(info.label).toBe('Held: Mailbox reached today’s limit — goes tomorrow');
  });

  it('is sending once the mail worker has it, and checking when the provider\'s answer is unknown', () => {
    expect(deriveEmailStepInfo({ ...base, task: { ...base.task, lockedAt: new Date() } }).label).toBe('Sending now');
    const checking = deriveEmailStepInfo({ ...base, outbound: { status: 'reconciliation_required', errorMessage: null } });
    expect(checking).toMatchObject({ state: 'checking', label: 'Checking delivery' });
  });

  it('is failed, with the reason, when the provider refused it', () => {
    const closed = deriveEmailStepInfo({ ...base, task: { ...base.task, status: 'skipped', outcome: 'send_failed', notes: '550 5.7.1 rejected' } });
    expect(closed).toMatchObject({ state: 'failed', label: 'Failed: 550 5.7.1 rejected' });
    const paused = deriveEmailStepInfo({
      ...base,
      enrollment: { status: 'paused', pausedReason: 'send_failed', holdReason: null },
      outbound: { status: 'failed', errorMessage: 'mailbox full' },
    });
    expect(paused).toMatchObject({ state: 'failed', label: 'Failed: mailbox full' });
  });

  it('says a barred step was not sent, rather than that it failed', () => {
    const info = deriveEmailStepInfo({ ...base, task: { ...base.task, status: 'skipped', outcome: 'send_blocked', notes: 'The address is on the suppression list' } });
    expect(info.label).toBe('Not sent: The address is on the suppression list');
  });

  it('is sent once the task is completed, and says so when the rep sent it elsewhere', () => {
    expect(deriveEmailStepInfo({ ...base, task: { ...base.task, status: 'completed' } }).label).toBe('Sent ✓');
    expect(deriveEmailStepInfo({ ...base, task: { ...base.task, status: 'completed', outcome: 'sent_outside_crm' } }).label).toBe('Sent outside the CRM ✓');
  });

  it('is not automatic without a template, even with the switch on', () => {
    expect(deriveEmailStepInfo({ ...base, step: { autoComplete: true, templateId: null } })).toMatchObject({ automatic: false, state: null });
    expect(deriveEmailStepInfo({ ...base, step: { autoComplete: false, templateId: 'tpl' } })).toMatchObject({ automatic: false, state: null });
  });

  it('reads the live rows: scheduled, held by the enrollment, failed by a pause, checking by the message', async () => {
    const scheduled = await seedCadence(t, { autoComplete: true, withTemplate: true });
    const held = await seedCadence(t, { autoComplete: true, withTemplate: true });
    const failed = await seedCadence(t, { autoComplete: true, withTemplate: true });
    const manual = await seedCadence(t, { autoComplete: false, withTemplate: false });
    await t.inTenant(async () => {
      await prisma.sequenceEnrollment.update({ where: { id: held.enrollmentId }, data: { holdReason: 'mailbox_paused' } });
      await prisma.sequenceEnrollment.update({ where: { id: failed.enrollmentId }, data: { status: 'paused', pausedReason: 'send_failed' } });
    });

    const tasks = await t.inTenant(async () =>
      attachEmailStepInfo(await prisma.task.findMany({ where: { id: { in: [scheduled.taskId, held.taskId, failed.taskId, manual.taskId] } } }))
    );
    const state = (id: string) => tasks.find((x) => x.id === id)?.emailStep;

    expect(state(scheduled.taskId)).toMatchObject({ automatic: true, state: 'scheduled', stepOrder: 1 });
    expect(state(held.taskId)).toMatchObject({ automatic: true, state: 'held' });
    expect(state(failed.taskId)).toMatchObject({ automatic: true, state: 'failed' });
    expect(state(manual.taskId)).toMatchObject({ automatic: false, state: null });
  });

  it('is on the task list and the single-task read', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true, name: 'Cold outreach' });

    const list = await t.inTenant(() => getTasks(t.user, { tab: 'all' }));
    expect(list.find((x) => x.id === c.taskId)?.emailStep).toMatchObject({ automatic: true, sequenceName: 'Cold outreach' });

    const res = await t.inTenant(() =>
      getTaskRoute(new NextRequest(`http://localhost/api/tasks/${c.taskId}`), { params: Promise.resolve({ id: c.taskId }) })
    );
    expect((await res.json()).emailStep).toMatchObject({ automatic: true, state: 'scheduled' });
  });
});

describe('Complete on an email the CRM sends itself', () => {
  it('is refused with auto_send_pending, and nothing moves', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });

    const res = await t.inTenant(() => put(c.taskId, { status: 'completed' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'auto_send_pending' });
    expect((await readTask(c.taskId)).status).toBe('pending');
    expect((await readEnrollment(c.enrollmentId)).currentStep, 'the cadence did not advance past an email nobody sent').toBe(1);
    expect(await t.inTenant(() => prisma.task.count({ where: { leadId: c.leadId, sequenceStep: 2 } }))).toBe(0);
  });

  it('goes through when the rep says they sent it outside the CRM: logged, advanced, job removed', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => scheduleJob(c.taskId, c.enrollmentId));
    expect(fakeQueue.jobs.size).toBe(1);

    const res = await t.inTenant(() => put(c.taskId, { status: 'completed', sentOutsideCrm: true }));

    expect(res.status).toBe(200);
    const task = await readTask(c.taskId);
    expect(task).toMatchObject({ status: 'completed', outcome: 'sent_outside_crm' });
    expect((await readEnrollment(c.enrollmentId)).currentStep).toBe(2);
    expect(fakeQueue.removed, 'the queued send must not fire after the rep said they sent it').toHaveLength(1);
    const activity = await t.inTenant(() => prisma.activity.findFirst({ where: { leadId: c.leadId, type: 'email_task_completed' } }));
    expect(activity?.description).toContain('outside the CRM');
    expect(activity?.metadata).toMatchObject({ sentOutsideCrm: true });
  });

  it('is refused once the message is with the mail worker, even with sentOutsideCrm', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() =>
      prisma.outboundMessage.create({
        data: {
          tenantId: t.tenantId, leadId: c.leadId, accountId: t.accountId, to: c.email, subject: 's', body: 'b',
          idempotencyKey: `manual-task:${c.taskId}`, status: 'pending', sequenceId: c.sequenceId, sequenceStepOrder: 1,
        },
      })
    );

    const res = await t.inTenant(() => put(c.taskId, { status: 'completed', sentOutsideCrm: true }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'send_in_flight' });
    expect((await readTask(c.taskId)).status).toBe('pending');
  });

  it('is unchanged for a manual email step (no template): the rep may complete it', async () => {
    const c = await seedCadence(t, { autoComplete: false, withTemplate: false });

    const res = await t.inTenant(() => put(c.taskId, { status: 'completed' }));

    expect(res.status).toBe(200);
    expect((await readTask(c.taskId)).status).toBe('completed');
  });
});

describe('Skip on an email the CRM sends itself', () => {
  it('cancels the queued send and closes the task without advancing', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => scheduleJob(c.taskId, c.enrollmentId));

    const res = await t.inTenant(() => put(c.taskId, { status: 'skipped' }));

    expect(res.status).toBe(200);
    expect((await readTask(c.taskId)).status).toBe('skipped');
    expect(fakeQueue.removed).toHaveLength(1);
    expect(fakeQueue.jobs.size).toBe(0);
    expect((await readEnrollment(c.enrollmentId)).currentStep).toBe(1);
  });

  it('is refused while the send is already with the mail worker', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(async () => {
      await prisma.task.update({ where: { id: c.taskId }, data: { lockedAt: new Date() } });
      await prisma.outboundMessage.create({
        data: {
          tenantId: t.tenantId, leadId: c.leadId, accountId: t.accountId, to: c.email, subject: 's', body: 'b',
          idempotencyKey: `manual-task:${c.taskId}`, status: 'sending', sequenceId: c.sequenceId, sequenceStepOrder: 1,
        },
      });
    });

    const res = await t.inTenant(() => put(c.taskId, { status: 'skipped' }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'send_in_flight' });
    expect((await readTask(c.taskId)).status).toBe('pending');
  });
});

describe('bulk complete', () => {
  it('refuses the automatic step, completes the manual one, and says why', async () => {
    const auto = await seedCadence(t, { autoComplete: true, withTemplate: true });
    const manual = await seedCadence(t, { autoComplete: false, withTemplate: false });

    const res = await t.inTenant(() => bulk({ action: 'complete', taskIds: [auto.taskId, manual.taskId] }));
    const data = await res.json();

    expect(data.updated).toBe(1);
    expect(data.failed).toEqual([expect.objectContaining({ taskId: auto.taskId, code: 'auto_send_pending' })]);
    expect((await readTask(auto.taskId)).status).toBe('pending');
    expect((await readTask(manual.taskId)).status).toBe('completed');
  });

  it('completes the automatic step when the rep says they sent it outside the CRM', async () => {
    const auto = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => scheduleJob(auto.taskId, auto.enrollmentId));

    const res = await t.inTenant(() => bulk({ action: 'complete', taskIds: [auto.taskId], sentOutsideCrm: true }));

    expect((await res.json()).updated).toBe(1);
    expect(await readTask(auto.taskId)).toMatchObject({ status: 'completed', outcome: 'sent_outside_crm' });
    expect(fakeQueue.removed).toHaveLength(1);
  });

  it('cancels the queued send on skip', async () => {
    const auto = await seedCadence(t, { autoComplete: true, withTemplate: true });
    await t.inTenant(() => scheduleJob(auto.taskId, auto.enrollmentId));

    const res = await t.inTenant(() => bulk({ action: 'skip', taskIds: [auto.taskId] }));

    expect((await res.json()).updated).toBe(1);
    expect(fakeQueue.removed).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  it('another tenant\'s rep cannot complete, skip or read the task, and it does not move', async () => {
    const mine = await seedCadence(t, { autoComplete: true, withTemplate: true });
    const other = await seedAutosendTenant('autosend-tasks-b');
    authUser.current = other.user;

    // The scoped path (no bypass), as a real request runs: the session's tenant filters every read.
    const scoped = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: other.tenantId }, fn);

    const completed = await scoped(() => put(mine.taskId, { status: 'completed', sentOutsideCrm: true }));
    const skipped = await scoped(() => put(mine.taskId, { status: 'skipped' }));
    const read = await scoped(() =>
      getTaskRoute(new NextRequest(`http://localhost/api/tasks/${mine.taskId}`), { params: Promise.resolve({ id: mine.taskId }) })
    );
    const viaBulk = await scoped(() => bulk({ action: 'complete', taskIds: [mine.taskId], sentOutsideCrm: true }));

    expect(completed.status).toBe(404);
    expect(skipped.status).toBe(404);
    expect(read.status).toBe(404);
    expect((await viaBulk.json()).updated).toBe(0);
    expect((await readTask(mine.taskId)).status).toBe('pending');
    expect((await readEnrollment(mine.enrollmentId)).currentStep).toBe(1);
  });
});
