import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * An in-memory BullMQ queue with real *state*, so a test can count what actually exists rather
 * than count calls. The Phase 8a resume questions are all of the form "how many effective future
 * executions are there", and a call-counting spy cannot answer that.
 */
const { jobStore, fakeQueue } = vi.hoisted(() => {
  interface Rec {
    state: string;
    delay: number;
    payload: { taskId: string; expectedEnrollmentId?: string };
    moved: number;
    adds: number;
  }
  const jobStore = new Map<string, Rec>();
  const fakeQueue = {
    async add(
      _name: string,
      data: { taskId: string; expectedEnrollmentId?: string },
      opts: { jobId: string; delay?: number }
    ) {
      const delay = opts.delay ?? 0;
      const prior = jobStore.get(opts.jobId);
      jobStore.set(opts.jobId, {
        state: delay > 0 ? 'delayed' : 'waiting',
        delay,
        payload: data,
        moved: prior?.moved ?? 0,
        adds: (prior?.adds ?? 0) + 1,
      });
      return { id: opts.jobId };
    },
    async getJob(id: string) {
      const rec = jobStore.get(id);
      if (!rec) return undefined;
      return {
        id,
        async getState() {
          return rec.state;
        },
        async changeDelay(delay: number) {
          rec.delay = delay;
          rec.state = delay > 0 ? 'delayed' : 'waiting';
          rec.moved += 1;
        },
        async remove() {
          if (rec.state === 'active') throw new Error('Job is locked by a worker');
          jobStore.delete(id);
        },
        async promote() {
          rec.state = 'waiting';
        },
      };
    },
  };
  return { jobStore, fakeQueue };
});

vi.mock('@/lib/bullmq/queues', () => ({
  sequenceQueue: () => fakeQueue,
  emailQueue: () => fakeQueue,
  importQueue: () => fakeQueue,
  syncQueue: () => fakeQueue,
  maintenanceQueue: () => fakeQueue,
  agentQueue: () => fakeQueue,
}));

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { launchAIOutreach } from '@/lib/prospects/outreach';
import { pauseEnrollmentOccurrence, resumeEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { rescheduleSequenceTask } from '@/lib/bullmq/rescheduleSequenceTask';
import type { SessionUser } from '@/lib/auth';

/**
 * Resume, treated as a crash-recoverable operation rather than a single call.
 *
 * The paused→active flip is durable the moment it commits and everything after it is not, so a
 * resume that dies half-way has to be finishable — and finishable to the *same* schedule, not to a
 * new one computed from whenever the retry happens to run.
 */
describe('Phase 8a — resume convergence', () => {
  let tenantId: string;
  let leadId: string;
  let sequenceId: string;
  let userA: SessionUser;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId, bypassRls: true }, fn);

  const makeWorkOrder = () =>
    prisma.workOrder.create({
      data: {
        tenantId,
        type: 'outreach_launch',
        status: 'active',
        requestKey: `req-${randomUUID()}`,
        leadId,
        createdById: userA.id,
        researchBudget: 10,
        tokenBudget: 1000,
        maxToolCalls: 5,
        maxExecutionDuration: 300,
        activatedAt: new Date(),
      },
    });

  /** A launched, then paused, cadence — the state every case here starts from. */
  const launchAndPause = async () => {
    const order = await makeWorkOrder();
    const launched = await launchAIOutreach(userA, { leadId, sequenceId, workOrderId: order.id });
    const enrollmentId = launched.enrollment.enrollmentId;
    await pauseEnrollmentOccurrence({
      enrollmentId,
      leadId,
      sequenceId,
      reason: 'manual',
      actorUserId: userA.id,
    });
    return { enrollmentId, taskId: enrollmentStepTaskId(enrollmentId, 1) };
  };

  const resume = (enrollmentId: string) =>
    resumeEnrollmentOccurrence({ enrollmentId, leadId, sequenceId, tenantId });

  const jobRunCount = () => prisma.jobRun.count({ where: { tenantId } });
  const liveJobs = () => Array.from(jobStore.values());

  beforeEach(async () => {
    jobStore.clear();

    tenantId = `t8rc-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Resume' } });

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const user = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'SDR',
          lastName: 'User',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });
      userA = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'sdr',
        tenantId,
      };

      const client = await prisma.client.create({
        data: {
          id: `c-${randomUUID()}`,
          tenantId,
          name: 'Client',
          industry: 'SaaS',
          contactName: 'Buyer',
          contactEmail: `buyer.${randomUUID()}@acme.test`,
        },
      });
      const campaign = await prisma.campaign.create({
        data: {
          id: `camp-${randomUUID()}`,
          tenantId,
          clientId: client.id,
          name: 'Outbound',
          startDate: new Date(),
        },
      });

      const sequence = await prisma.sequence.create({
        data: { tenantId, name: 'Auto Seq', createdById: user.id },
      });
      sequenceId = sequence.id;
      await prisma.sequenceStep.create({
        data: {
          tenantId,
          sequenceId,
          order: 1,
          channel: 'email',
          delayDays: 1,
          instructions: 'Opening touch',
          autoComplete: true,
        },
      });

      const lead = await prisma.lead.create({
        data: {
          tenantId,
          firstName: 'Alice',
          lastName: 'Smith',
          email: `alice.${randomUUID()}@acme.test`,
          company: 'Acme',
          assignedToId: user.id,
          campaignId: campaign.id,
          operatingState: 'ready_for_outreach',
          sequenceId,
        },
      });
      leadId = lead.id;
    });
  });

  // =========================================================================
  // BLOCKER 1 — a resume interrupted after any durable write still converges
  // =========================================================================

  /**
   * Rebuild the durable state a crash at `crashAfter` would have left, starting from a paused
   * cadence. Step 1 is the status CAS alone; each higher number adds the next durable write that
   * `finishResume` performs, in order. The completion watermark is never written, because that is
   * precisely what a crashed resume fails to do.
   */
  const crashedResume = async (
    enrollmentId: string,
    taskId: string,
    crashAfter: number,
    resumeAt: Date,
    intendedDue: Date | null
  ) => {
    // 1. paused → active. Durable, and everything below it is not.
    await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollmentId },
      data: {
        status: 'active',
        pausedReason: null,
        lastTransitionAt: resumeAt,
        // The completion watermark still holds whatever the *last* scheduling wrote — for a real
        // crashed resume, the launch's. It is older than the resume transition, which is exactly
        // what marks the bookkeeping as unfinished.
        lastEvaluatedAt: new Date(resumeAt.getTime() - 60_000),
        occupancyKey: occupancyKeyFor(tenantId, leadId),
      },
    });
    if (crashAfter >= 2) {
      await prisma.lead.updateMany({
        where: { id: leadId },
        data: { sequenceStatus: 'active', sequenceStep: 1 },
      });
    }
    if (crashAfter >= 3) {
      await prisma.task.update({ where: { id: taskId }, data: { status: 'pending' } });
    }
    if (crashAfter >= 4 && intendedDue) {
      await prisma.task.update({ where: { id: taskId }, data: { dueDate: intendedDue } });
    }
    if (crashAfter >= 5 && intendedDue) {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { nextActionAt: intendedDue },
      });
      await prisma.lead.update({ where: { id: leadId }, data: { nextTaskDue: intendedDue } });
    }
    if (crashAfter >= 6 && intendedDue) {
      const scheduled = await rescheduleSequenceTask({
        taskId,
        expectedEnrollmentId: enrollmentId,
        targetDueAt: intendedDue,
        tenantId,
      });
      expect(scheduled.ok).toBe(true);
    }
  };

  /** Everything a fully resumed occurrence must be true of, whatever crashed on the way there. */
  const assertConverged = async (enrollmentId: string, taskId: string) => {
    const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    expect(row.status).toBe('active');
    expect(row.pausedReason).toBeNull();
    expect(row.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));
    expect(row.currentStep).toBe(1);
    expect(row.nextActionAt).not.toBeNull();

    const tasks = await prisma.task.findMany({ where: { tenantId, leadId } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskId);
    expect(tasks[0].status).toBe('pending');
    expect(tasks[0].dueDate.getTime()).toBe(row.nextActionAt!.getTime());

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.sequenceStatus).toBe('active');
    expect(lead.nextTaskDue?.getTime()).toBe(row.nextActionAt!.getTime());

    // Exactly one effective future execution, carrying the occurrence.
    const jobs = liveJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload.taskId).toBe(taskId);
    expect(jobs[0].payload.expectedEnrollmentId).toBe(enrollmentId);
    return row.nextActionAt!;
  };

  for (const crashAfter of [1, 2, 3, 4, 5, 6]) {
    it(`converges after a crash at durable write ${crashAfter}, without shifting the due time`, async () => {
      await inTenant(async () => {
        const { enrollmentId, taskId } = await launchAndPause();
        jobStore.clear();
        await prisma.jobRun.deleteMany({ where: { tenantId } });

        // A resume identity fixed in the past. Every recovery must land on the schedule this
        // implies, not on one derived from the retry's own clock.
        const resumeAt = new Date(Date.now() - 90 * 60 * 1000);

        // Pass 1 rebuilds only what a crash at step 1 leaves, so the repair computes the
        // intended due time; later steps replay it to build their own pre-crash state.
        await crashedResume(enrollmentId, taskId, 1, resumeAt, null);
        const first = await resume(enrollmentId);
        expect(first.ok).toBe(true);
        expect(first.outcome).toBe('repaired');
        const intendedDue = await assertConverged(enrollmentId, taskId);

        if (crashAfter > 1) {
          // Rewind to the deeper crash point and repair again.
          jobStore.clear();
          await prisma.jobRun.deleteMany({ where: { tenantId } });
          await prisma.task.update({
            where: { id: taskId },
            data: { status: 'skipped', dueDate: new Date(0) },
          });
          await prisma.sequenceEnrollment.update({
            where: { id: enrollmentId },
            data: { nextActionAt: null, lastEvaluatedAt: new Date(resumeAt.getTime() - 60_000) },
          });
          await prisma.lead.update({
            where: { id: leadId },
            data: { nextTaskDue: null, sequenceStatus: 'paused' },
          });

          await crashedResume(enrollmentId, taskId, crashAfter, resumeAt, intendedDue);
          const again = await resume(enrollmentId);
          expect(again.ok).toBe(true);
          expect(again.outcome).toBe('repaired');
          const due = await assertConverged(enrollmentId, taskId);
          // The whole point: recovery reproduces the intended result rather than a new schedule.
          expect(due.getTime()).toBe(intendedDue.getTime());
        }
      });
    }, 120_000);
  }

  it('a resume that finished but never returned is a no-op on retry', async () => {
    await inTenant(async () => {
      const { enrollmentId, taskId } = await launchAndPause();
      jobStore.clear();
      await prisma.jobRun.deleteMany({ where: { tenantId } });

      const first = await resume(enrollmentId);
      expect(first.ok).toBe(true);
      expect(first.outcome).toBe('resumed');
      const due = await assertConverged(enrollmentId, taskId);
      const jobRunsBefore = await jobRunCount();

      // Crash point 7: everything durable is in place; only the response was lost.
      const retry = await resume(enrollmentId);

      expect(retry.ok).toBe(true);
      expect(retry.outcome).toBe('already_active');
      const after = await assertConverged(enrollmentId, taskId);
      expect(after.getTime()).toBe(due.getTime());
      expect(await jobRunCount()).toBe(jobRunsBefore);
    });
  }, 120_000);

  it('a healthy active cadence is never mistaken for an interrupted resume', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const launched = await launchAIOutreach(userA, { leadId, sequenceId, workOrderId: order.id });
      const enrollmentId = launched.enrollment.enrollmentId;
      const jobsBefore = liveJobs().length;
      const tasksBefore = await prisma.task.count({ where: { tenantId, leadId } });
      const before = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });

      const result = await resume(enrollmentId);

      expect(result.ok).toBe(true);
      expect(result.outcome).toBe('already_active');
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(tasksBefore);
      expect(liveJobs()).toHaveLength(jobsBefore);
      const after = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(after.nextActionAt?.getTime()).toBe(before.nextActionAt?.getTime());
    });
  }, 120_000);

  it('still refuses a terminal occurrence rather than resurrecting it', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });

      const result = await resume(enrollmentId);

      expect(result.ok).toBe(false);
      expect(result.refusal).toBe('not_paused');
    });
  }, 120_000);

  // =========================================================================
  // A resume that cannot produce a runnable step must refuse, not settle
  // =========================================================================

  /** How far the watermark is from the resume identity — negative means "still unfinished". */
  const watermarkLag = async (enrollmentId: string) => {
    const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    return {
      row,
      settled: Boolean(
        row.lastTransitionAt && row.lastEvaluatedAt && row.lastEvaluatedAt >= row.lastTransitionAt
      ),
    };
  };

  it('refuses when the current step was deleted while paused, and converges once it is restored', async () => {
    await inTenant(async () => {
      const { enrollmentId, taskId } = await launchAndPause();
      jobStore.clear();
      await prisma.jobRun.deleteMany({ where: { tenantId } });

      const step = await prisma.sequenceStep.findFirstOrThrow({ where: { sequenceId, order: 1 } });
      const stepFields = {
        tenantId,
        sequenceId,
        order: step.order,
        channel: step.channel,
        delayDays: step.delayDays,
        delayHours: step.delayHours,
        instructions: step.instructions,
        autoComplete: step.autoComplete,
      };
      await prisma.sequenceStep.delete({ where: { id: step.id } });

      const refused = await resume(enrollmentId);

      expect(refused.ok).toBe(false);
      expect(refused.refusal).toBe('step_missing');

      // The occurrence stays detectably unfinished: the watermark never crossed the resume
      // identity, so this is repairable rather than a healthy-looking dead cadence.
      const { settled } = await watermarkLag(enrollmentId);
      expect(settled).toBe(false);

      // Nothing prospect-facing exists: the task is still skipped and no job was created.
      expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('skipped');
      expect(await jobRunCount()).toBe(0);
      expect(jobStore.size).toBe(0);

      // The operator restores the step; a later retry finishes the interrupted resume.
      await prisma.sequenceStep.create({ data: stepFields });
      const retry = await resume(enrollmentId);

      expect(retry.ok).toBe(true);
      expect(retry.outcome).toBe('repaired');
      await assertConverged(enrollmentId, taskId);
      expect((await watermarkLag(enrollmentId)).settled).toBe(true);
    });
  }, 120_000);

  it('refuses when the sequence itself was archived while paused', async () => {
    await inTenant(async () => {
      const { enrollmentId, taskId } = await launchAndPause();
      jobStore.clear();
      await prisma.jobRun.deleteMany({ where: { tenantId } });
      await prisma.sequence.update({ where: { id: sequenceId }, data: { isArchived: true } });

      const refused = await resume(enrollmentId);

      expect(refused.ok).toBe(false);
      expect(refused.refusal).toBe('sequence_inactive');
      expect((await watermarkLag(enrollmentId)).settled).toBe(false);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('skipped');
      expect(await jobRunCount()).toBe(0);
    });
  }, 120_000);

  it('refuses when the sequence was deactivated while paused', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      jobStore.clear();
      await prisma.jobRun.deleteMany({ where: { tenantId } });
      await prisma.sequence.update({ where: { id: sequenceId }, data: { isActive: false } });

      const refused = await resume(enrollmentId);

      expect(refused.ok).toBe(false);
      expect(refused.refusal).toBe('sequence_inactive');
      expect((await watermarkLag(enrollmentId)).settled).toBe(false);
      expect(await jobRunCount()).toBe(0);
    });
  }, 120_000);

  it('a refused resume stays refused on retry rather than drifting into a healthy-looking cadence', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      const step = await prisma.sequenceStep.findFirstOrThrow({ where: { sequenceId, order: 1 } });
      await prisma.sequenceStep.delete({ where: { id: step.id } });

      const first = await resume(enrollmentId);
      const second = await resume(enrollmentId);

      expect(first.refusal).toBe('step_missing');
      // The second call comes in against an *active* row — it must still detect the unfinished
      // resume rather than answer `already_active`.
      expect(second.ok).toBe(false);
      expect(second.refusal).toBe('step_missing');
      expect((await watermarkLag(enrollmentId)).settled).toBe(false);
    });
  }, 120_000);

  it('settles a manual step, which is runnable by a human rather than by a job', async () => {
    await inTenant(async () => {
      await prisma.sequenceStep.updateMany({
        where: { sequenceId, order: 1 },
        data: { autoComplete: false },
      });
      const { enrollmentId, taskId } = await launchAndPause();
      jobStore.clear();

      const resumed = await resume(enrollmentId);

      expect(resumed.ok).toBe(true);
      expect((await watermarkLag(enrollmentId)).settled).toBe(true);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).status).toBe('pending');
      // No execution job, and its absence is not a failure for a manual step.
      expect(jobStore.size).toBe(0);
    });
  }, 120_000);

  // =========================================================================
  // BLOCKER 2 — exactly one effective future schedule
  // =========================================================================

  it('moves the original delayed job instead of adding a second one', async () => {
    await inTenant(async () => {
      const { enrollmentId, taskId } = await launchAndPause();

      // The launch's delayed job is still sitting in the queue, unfired.
      const [originalId] = Array.from(jobStore.keys());
      const originalDelay = jobStore.get(originalId)!.delay;
      expect(jobStore.get(originalId)!.state).toBe('delayed');

      await new Promise((r) => setTimeout(r, 50));

      const resumed = await resume(enrollmentId);
      expect(resumed.ok).toBe(true);

      // One JobRun, one BullMQ job, same identity — its fire time moved rather than a rival
      // execution appearing beside it.
      expect(await jobRunCount()).toBe(1);
      expect(jobStore.size).toBe(1);
      const rec = jobStore.get(originalId)!;
      expect(rec.moved).toBe(1);
      expect(rec.adds).toBe(1);
      expect(rec.delay).not.toBe(originalDelay);
      expect(rec.payload.expectedEnrollmentId).toBe(enrollmentId);

      // And it can no longer fire at the pre-pause moment.
      const due = (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).dueDate;
      expect(Math.abs(Date.now() + rec.delay - due.getTime())).toBeLessThan(5_000);
    });
  }, 120_000);

  it('issues exactly one fresh job when the original already completed', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      const [originalId] = Array.from(jobStore.keys());

      // The delayed job fired against the skipped task and the worker exited.
      await prisma.jobRun.update({ where: { id: originalId }, data: { status: 'completed' } });
      jobStore.get(originalId)!.state = 'completed';

      const resumed = await resume(enrollmentId);
      expect(resumed.ok).toBe(true);

      // The settled original is left truthful; one new job exists.
      expect((await prisma.jobRun.findUniqueOrThrow({ where: { id: originalId } })).status).toBe(
        'completed'
      );
      expect(await jobRunCount()).toBe(2);
      const runnable = liveJobs().filter((j) => j.state !== 'completed');
      expect(runnable).toHaveLength(1);
      expect(runnable[0].payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);

  it('repairs a job that vanished from the queue under the same identity', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      const [originalId] = Array.from(jobStore.keys());
      jobStore.delete(originalId); // lost before execution; the mirror still says queued

      const resumed = await resume(enrollmentId);
      expect(resumed.ok).toBe(true);

      expect(await jobRunCount()).toBe(1);
      expect(jobStore.size).toBe(1);
      expect(jobStore.has(originalId)).toBe(true);
      expect(jobStore.get(originalId)!.payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);

  it('refuses rather than scheduling beside an execution already in flight', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      const [originalId] = Array.from(jobStore.keys());
      await prisma.jobRun.update({ where: { id: originalId }, data: { status: 'running' } });

      const resumed = await resume(enrollmentId);

      expect(resumed.ok).toBe(false);
      expect(resumed.refusal).toBe('execution_in_flight');
      expect(await jobRunCount()).toBe(1);
      expect(jobStore.size).toBe(1);

      // The refusal leaves the occurrence mid-resume, so the next attempt finishes it.
      await prisma.jobRun.update({ where: { id: originalId }, data: { status: 'queued' } });
      const retry = await resume(enrollmentId);
      expect(retry.ok).toBe(true);
      expect(retry.outcome).toBe('repaired');
      expect(jobStore.size).toBe(1);
    });
  }, 120_000);

  it('replaces a waiting job rather than letting it fire at the old time', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      const [originalId] = Array.from(jobStore.keys());
      jobStore.get(originalId)!.state = 'waiting'; // due imminently, not yet claimed

      const resumed = await resume(enrollmentId);
      expect(resumed.ok).toBe(true);

      expect(await jobRunCount()).toBe(1);
      expect(jobStore.size).toBe(1);
      const rec = jobStore.get(originalId)!;
      expect(rec.state).toBe('delayed');
      expect(rec.payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);

  it('a retry after a successful resume adds no further job', async () => {
    await inTenant(async () => {
      const { enrollmentId } = await launchAndPause();
      const [originalId] = Array.from(jobStore.keys());
      await prisma.jobRun.update({ where: { id: originalId }, data: { status: 'completed' } });
      jobStore.get(originalId)!.state = 'completed';

      await resume(enrollmentId);
      const runsAfterFirst = await jobRunCount();
      const jobsAfterFirst = jobStore.size;

      // Same occurrence, same intended target → the same job, not another one.
      const again = await resume(enrollmentId);
      expect(again.outcome).toBe('already_active');

      expect(await jobRunCount()).toBe(runsAfterFirst);
      expect(jobStore.size).toBe(jobsAfterFirst);
    });
  }, 120_000);

  it('concurrent resume repairs converge on one effective schedule', async () => {
    await inTenant(async () => {
      const { enrollmentId, taskId } = await launchAndPause();
      const [originalId] = Array.from(jobStore.keys());
      await prisma.jobRun.update({ where: { id: originalId }, data: { status: 'completed' } });
      jobStore.get(originalId)!.state = 'completed';

      const results = await Promise.all([
        resume(enrollmentId),
        resume(enrollmentId),
        resume(enrollmentId),
      ]);
      for (const result of results) expect(result.ok).toBe(true);

      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
      const runnable = liveJobs().filter((j) => j.state !== 'completed');
      expect(runnable).toHaveLength(1);
      expect(runnable[0].payload.taskId).toBe(taskId);
      expect(runnable[0].payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);
});
