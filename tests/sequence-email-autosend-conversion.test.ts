import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one-off that turns email steps with a template into steps the CRM sends itself.
 *
 * What it must get right is not the flag flip, it is what happens to the tasks already waiting:
 * hundreds of overdue steps must not become hundreds of sends in one minute, and running it twice
 * must not schedule anything twice. Real Postgres; the queue is an in-memory fake.
 */

vi.mock('@/lib/bullmq/queues', async () => {
  const { fakeQueues } = await import('./helpers/fakeQueue');
  return fakeQueues();
});

import { prisma } from '@/lib/prisma';
import { applyAutoSendConversion, planAutoSendConversion } from '@/lib/sequences/autoSendConversion';
import { tenantStorage } from '@/lib/tenant-context';
import { fakeQueue, resetFakeQueue } from './helpers/fakeQueue';
import { seedAutosendTenant, seedCadence, type AutosendTenant } from './helpers/autosendFixture';

let t: AutosendTenant;

beforeEach(async () => {
  resetFakeQueue();
  t = await seedAutosendTenant('autosend-conv');
});

const jobRuns = () =>
  tenantStorage.run({ tenantId: t.tenantId, bypassRls: true }, () =>
    prisma.jobRun.count({ where: { tenantId: t.tenantId, jobName: 'sequence.execute-task' } })
  );

describe('the dry run', () => {
  it('lists email steps with a template that are manual, and writes nothing', async () => {
    const manualWithTemplate = await seedCadence(t, { autoComplete: false, withTemplate: true, name: 'Convertible' });
    await seedCadence(t, { autoComplete: false, withTemplate: false, name: 'No template' });

    const plan = await t.inTenant(() => planAutoSendConversion(t.tenantId));

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      sequenceId: manualWithTemplate.sequenceId,
      sequenceName: 'Convertible',
      stepOrder: 1,
      willConvert: true,
      pendingTasks: 1,
      unscheduledTasks: 1,
      activeEnrollments: 1,
      mailbox: 'ok',
    });
    const step = await t.inTenant(() => prisma.sequenceStep.findUniqueOrThrow({ where: { id: manualWithTemplate.stepId } }));
    expect(step.autoComplete, 'a dry run changes nothing').toBe(false);
    expect(await jobRuns()).toBe(0);
    expect(fakeQueue.jobs.size).toBe(0);
  });

  it('says when the sequence has no mailbox to send from', async () => {
    await seedCadence(t, { autoComplete: false, withTemplate: true, noSender: true });

    const plan = await t.inTenant(() => planAutoSendConversion(t.tenantId));

    expect(plan[0].mailbox).toBe('none_chosen');
  });

  it('leaves out archived sequences', async () => {
    const c = await seedCadence(t, { autoComplete: false, withTemplate: true });
    await t.inTenant(() => prisma.sequence.update({ where: { id: c.sequenceId }, data: { isArchived: true } }));

    expect(await t.inTenant(() => planAutoSendConversion(t.tenantId))).toHaveLength(0);
  });
});

describe('applying it', () => {
  it('turns auto-send on and schedules the overdue task in the future, not now', async () => {
    const c = await seedCadence(t, { autoComplete: false, withTemplate: true });
    const before = Date.now();

    const result = await t.inTenant(async () =>
      applyAutoSendConversion(await planAutoSendConversion(t.tenantId), { tenantId: t.tenantId, spreadMinutes: 120 })
    );

    expect(result).toMatchObject({ convertedSteps: 1, rescheduled: 1, skipped: [] });
    const step = await t.inTenant(() => prisma.sequenceStep.findUniqueOrThrow({ where: { id: c.stepId } }));
    expect(step.autoComplete).toBe(true);

    const task = await t.inTenant(() => prisma.task.findUniqueOrThrow({ where: { id: c.taskId } }));
    expect(task.dueDate.getTime(), 'an overdue task is not sent the moment the switch flips').toBeGreaterThanOrEqual(before);
    expect(task.status).toBe('pending');

    // One execution job, carrying the occurrence, delayed to the new due time.
    expect(await jobRuns()).toBe(1);
    const [job] = [...fakeQueue.jobs.values()];
    expect(job.data).toEqual({ taskId: c.taskId, expectedEnrollmentId: c.enrollmentId });
    expect(job.opts.delay ?? 0).toBeGreaterThanOrEqual(0);

    const enrollment = await t.inTenant(() => prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: c.enrollmentId } }));
    expect(enrollment.nextActionAt?.getTime()).toBe(task.dueDate.getTime());
  });

  it('spreads many overdue tasks instead of stacking them on one instant', async () => {
    const many = await Promise.all(
      Array.from({ length: 12 }, () => seedCadence(t, { autoComplete: false, withTemplate: true }))
    );

    await t.inTenant(async () =>
      applyAutoSendConversion(await planAutoSendConversion(t.tenantId), { tenantId: t.tenantId, spreadMinutes: 240 })
    );

    const tasks = await t.inTenant(() => prisma.task.findMany({ where: { id: { in: many.map((m) => m.taskId) } } }));
    const distinct = new Set(tasks.map((x) => x.dueDate.getTime()));
    expect(distinct.size, 'a deterministic per-lead offset separates them').toBeGreaterThan(6);
  });

  it('keeps a task that is not yet due on its own date', async () => {
    const dueDate = new Date(Date.now() + 3 * 86_400_000);
    const c = await seedCadence(t, { autoComplete: false, withTemplate: true, dueDate });

    await t.inTenant(async () => applyAutoSendConversion(await planAutoSendConversion(t.tenantId), { tenantId: t.tenantId }));

    const task = await t.inTenant(() => prisma.task.findUniqueOrThrow({ where: { id: c.taskId } }));
    expect(task.dueDate.getTime()).toBe(dueDate.getTime());
  });

  it('is idempotent: a second run lists nothing and schedules nothing', async () => {
    await seedCadence(t, { autoComplete: false, withTemplate: true });
    await t.inTenant(async () => applyAutoSendConversion(await planAutoSendConversion(t.tenantId), { tenantId: t.tenantId }));
    const jobsAfterFirst = fakeQueue.jobs.size;

    const secondPlan = await t.inTenant(() => planAutoSendConversion(t.tenantId));
    const second = await t.inTenant(() => applyAutoSendConversion(secondPlan, { tenantId: t.tenantId }));

    expect(secondPlan).toEqual([]);
    expect(second).toMatchObject({ convertedSteps: 0, rescheduled: 0 });
    expect(fakeQueue.jobs.size).toBe(jobsAfterFirst);
    expect(await jobRuns()).toBe(1);
  });

  it('finishes a run that stopped half-way: a converted step whose task has no job is scheduled', async () => {
    const c = await seedCadence(t, { autoComplete: true, withTemplate: true });

    const plan = await t.inTenant(() => planAutoSendConversion(t.tenantId));

    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ willConvert: false, unscheduledTasks: 1 });
    const result = await t.inTenant(() => applyAutoSendConversion(plan, { tenantId: t.tenantId }));
    expect(result).toMatchObject({ convertedSteps: 0, rescheduled: 1 });
    expect(fakeQueue.jobs.size).toBe(1);
    expect([...fakeQueue.jobs.values()][0].data).toMatchObject({ taskId: c.taskId });
  });

  it('does not touch a task that is already being sent', async () => {
    const c = await seedCadence(t, { autoComplete: false, withTemplate: true });
    await t.inTenant(() => prisma.task.update({ where: { id: c.taskId }, data: { lockedAt: new Date() } }));

    const result = await t.inTenant(async () => applyAutoSendConversion(await planAutoSendConversion(t.tenantId), { tenantId: t.tenantId }));

    expect(result.rescheduled).toBe(0);
    expect(result.skipped).toEqual([{ taskId: c.taskId, reason: 'already being sent' }]);
    expect(fakeQueue.jobs.size).toBe(0);
  });
});

describe('tenant isolation', () => {
  it('never sees or changes another tenant\'s steps', async () => {
    const other = await seedAutosendTenant('autosend-conv-b');
    const theirs = await seedCadence(other, { autoComplete: false, withTemplate: true });
    const mine = await seedCadence(t, { autoComplete: false, withTemplate: true });

    const plan = await t.inTenant(() => planAutoSendConversion(t.tenantId));
    expect(plan.map((p) => p.stepId)).toEqual([mine.stepId]);
    await t.inTenant(() => applyAutoSendConversion(plan, { tenantId: t.tenantId }));

    const theirStep = await other.inTenant(() => prisma.sequenceStep.findUniqueOrThrow({ where: { id: theirs.stepId } }));
    expect(theirStep.autoComplete).toBe(false);
    const theirTask = await other.inTenant(() => prisma.task.findUniqueOrThrow({ where: { id: theirs.taskId } }));
    expect(theirTask.dueDate.getTime()).toBeLessThan(Date.now());
  });
});
