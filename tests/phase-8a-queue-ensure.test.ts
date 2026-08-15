import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * The queue side of a launch, with the queue itself faulted deliberately.
 *
 * Only the BullMQ *queue objects* are stubbed — the `JobRun` mirror, the enrollment, the task and
 * the launch stages are all real rows, because they are exactly what these tests are about.
 */
const queueAdd = vi.fn();
const queueGetJob = vi.fn();
const fakeQueue = { add: queueAdd, getJob: queueGetJob };

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
import { ensureJob } from '@/lib/bullmq/ensureJob';
import { JobType } from '@/lib/bullmq/types';
import { launchAIOutreach, launchEnrollmentId } from '@/lib/prospects/outreach';
import { enrollmentFirstTaskId } from '@/lib/sequences/enrollment';
import { handleExecuteTask } from '@/workers/sequence';
import { pauseEnrollmentOccurrence, resumeEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { advanceSequence } from '@/lib/sequences/engine';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import type { SessionUser } from '@/lib/auth';

describe('Phase 8a — durable queue ensure', () => {
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

  const launch = (workOrderId: string) =>
    launchAIOutreach(userA, { leadId, sequenceId, workOrderId });

  beforeEach(async () => {
    queueAdd.mockReset().mockResolvedValue({ id: 'job' });
    queueGetJob.mockReset().mockResolvedValue(null);

    tenantId = `t8q-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Queue' } });

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
      // autoComplete: this is the step that needs a delayed execution job.
      await prisma.sequenceStep.create({
        data: {
          tenantId,
          sequenceId,
          order: 1,
          channel: 'email',
          delayDays: 0,
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
  // ensureJob on its own
  // =========================================================================
  it('creates the JobRun and the job when neither exists', async () => {
    await inTenant(async () => {
      const result = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });

      expect(result.outcome).toBe('created');
      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
    });
  }, 60_000);

  it('does nothing when the JobRun is queued and the job is present', async () => {
    await inTenant(async () => {
      const first = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });
      queueGetJob.mockResolvedValue({ id: first.jobId });
      queueAdd.mockClear();

      const second = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });

      expect(second.outcome).toBe('already_scheduled');
      expect(second.jobId).toBe(first.jobId);
      expect(queueAdd).not.toHaveBeenCalled();
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
    });
  }, 60_000);

  it('repairs a job that vanished from the queue, without rewriting the JobRun', async () => {
    await inTenant(async () => {
      const first = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });
      const before = await prisma.jobRun.findUniqueOrThrow({ where: { id: first.jobId } });

      queueGetJob.mockResolvedValue(null); // lost before execution
      queueAdd.mockClear();

      const repaired = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });

      expect(repaired.outcome).toBe('repaired');
      expect(queueAdd).toHaveBeenCalledTimes(1);
      expect(queueAdd.mock.calls[0][2].jobId).toBe(first.jobId);

      const after = await prisma.jobRun.findUniqueOrThrow({ where: { id: first.jobId } });
      expect(after.enqueuedAt.getTime()).toBe(before.enqueuedAt.getTime());
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
    });
  }, 60_000);

  for (const status of ['running', 'completed']) {
    it(`never resets a JobRun that is already ${status}`, async () => {
      await inTenant(async () => {
        const first = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });
        await prisma.jobRun.update({
          where: { id: first.jobId },
          data: { status, attempts: 2, startedAt: new Date() },
        });
        queueAdd.mockClear();

        const again = await ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-1' }, { tenantId });

        expect(again.outcome).toBe('already_executed');
        expect(queueAdd).not.toHaveBeenCalled();
        const row = await prisma.jobRun.findUniqueOrThrow({ where: { id: first.jobId } });
        expect(row.status).toBe(status);
        expect(row.attempts).toBe(2);
      });
    }, 60_000);
  }

  it('converges when several ensures race for the same durable job', async () => {
    await inTenant(async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          ensureJob(JobType.SEQUENCE_EXECUTE_TASK, { taskId: 'task-race' }, { tenantId })
        )
      );

      // No caller saw a raw uniqueness error, and they all mean the same job.
      expect(new Set(results.map((r) => r.jobId)).size).toBe(1);
      expect(new Set(results.map((r) => r.dedupeKey)).size).toBe(1);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
    });
  }, 60_000);

  // =========================================================================
  // The launch, with the queue failing
  // =========================================================================
  it('does not complete the launch when the queue add fails, and the retry repairs it', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      queueAdd.mockRejectedValueOnce(new Error('Redis unreachable'));

      await expect(launch(order.id)).rejects.toThrow('Redis unreachable');

      const launchRow = await prisma.sequenceLaunch.findUniqueOrThrow({
        where: { tenantId_workOrderId: { tenantId, workOrderId: order.id } },
      });
      // The task row exists, so the stage says so — and the launch is not completed.
      expect(launchRow.stage).toBe('task_created');
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);

      const enrollmentId = launchEnrollmentId(launchRow.id);
      expect(await prisma.task.findUnique({ where: { id: enrollmentFirstTaskId(enrollmentId) } })).not.toBeNull();

      // Queue restored.
      queueAdd.mockResolvedValue({ id: 'job' });
      const retry = await launch(order.id);

      expect(retry.stage).toBe('completed');
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
      expect(
        await prisma.sequenceEnrollment.count({ where: { tenantId, leadId, status: 'active' } })
      ).toBe(1);
      expect(
        await prisma.activity.count({ where: { leadId, type: 'sequence_enrolled' } })
      ).toBe(1);
    });
  }, 90_000);

  it('a crash after a successful enqueue but before completion converges without resetting the job', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      await launch(order.id);

      const jobRun = await prisma.jobRun.findFirstOrThrow({ where: { tenantId } });
      // Pretend the worker picked it up, then rewind the launch to before completion.
      await prisma.jobRun.update({
        where: { id: jobRun.id },
        data: { status: 'running', startedAt: new Date() },
      });
      await prisma.sequenceLaunch.updateMany({
        where: { tenantId, workOrderId: order.id },
        data: { stage: 'task_created' },
      });
      queueAdd.mockClear();
      queueGetJob.mockResolvedValue({ id: jobRun.id });

      const retry = await launch(order.id);

      expect(retry.stage).toBe('completed');
      expect(queueAdd).not.toHaveBeenCalled();
      const after = await prisma.jobRun.findUniqueOrThrow({ where: { id: jobRun.id } });
      expect(after.status).toBe('running');
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
    });
  }, 90_000);

  it('needs no execution job for a manual first step', async () => {
    await inTenant(async () => {
      await prisma.sequenceStep.updateMany({ where: { sequenceId }, data: { autoComplete: false } });
      const order = await makeWorkOrder();

      const result = await launch(order.id);

      expect(result.stage).toBe('completed');
      expect(queueAdd).not.toHaveBeenCalled();
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
    });
  }, 90_000);


  // =========================================================================
  // Occurrence identity survives the queue boundary
  // =========================================================================
  it('the strict launch puts the enrollment occurrence into the job payload', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const result = await launch(order.id);

      const payload = queueAdd.mock.calls[0][1] as { taskId: string; expectedEnrollmentId?: string };
      expect(payload.taskId).toBe(result.taskId);
      expect(payload.expectedEnrollmentId).toBe(result.enrollment.enrollmentId);
    });
  }, 90_000);

  it('an old job refuses to execute under the enrollment that replaced it', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const first = await launch(order.id);
      const oldTaskId = first.taskId!;
      const oldEnrollmentId = first.enrollment.enrollmentId;

      // The AI cadence ends, and a human starts a new one on the SAME sequence.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: oldEnrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      const replacement = await prisma.sequenceEnrollment.create({
        data: {
          tenantId,
          leadId,
          sequenceId,
          status: 'active',
          currentStep: 1,
          occupancyKey: `${tenantId}:${leadId}`,
        },
      });

      // The old queued job finally runs.
      const outcome = await handleExecuteTask({
        taskId: oldTaskId,
        expectedEnrollmentId: oldEnrollmentId,
      });

      expect(outcome.status).toBe('skipped');
      expect((outcome as { reason?: string }).reason).toBe('occurrence_no_longer_active');

      // The replacement was not touched, and nothing outbound was produced.
      const live = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: replacement.id },
      });
      expect(live.status).toBe('active');
      expect(live.nextActionAt).toBeNull();
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(0);
    });
  }, 90_000);

  it('a job with no occurrence id keeps the legacy matching', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const first = await launch(order.id);

      // No `expectedEnrollmentId` — the pre-Phase-8a payload shape.
      const outcome = await handleExecuteTask({ taskId: first.taskId! });
      expect((outcome as { reason?: string }).reason).not.toBe('occurrence_no_longer_active');
    });
  }, 90_000);


  // =========================================================================
  // Resume leaves a runnable cadence
  // =========================================================================
  it('resume repairs the schedule after the paused job already fired', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const launched = await launch(order.id);
      const enrollmentId = launched.enrollment.enrollmentId;

      await pauseEnrollmentOccurrence({
        enrollmentId,
        leadId,
        sequenceId,
        reason: 'manual',
        actorUserId: userA.id,
      });

      // The original delayed job fires against a skipped task and the worker exits, leaving the
      // JobRun settled — nothing remains to execute this cadence.
      const jobRun = await prisma.jobRun.findFirstOrThrow({ where: { tenantId } });
      await prisma.jobRun.update({ where: { id: jobRun.id }, data: { status: 'completed' } });
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { nextActionAt: null },
      });
      await prisma.lead.update({ where: { id: leadId }, data: { nextTaskDue: null } });
      queueAdd.mockClear();

      const resumed = await resumeEnrollmentOccurrence({
        enrollmentId,
        leadId,
        sequenceId,
        tenantId,
      });
      expect(resumed.ok).toBe(true);

      // One task, made due again, with the schedule and a fresh execution job restored.
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
      const task = await prisma.task.findFirstOrThrow({ where: { tenantId, leadId } });
      expect(task.status).toBe('pending');

      const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
      expect(enrollment.nextActionAt).not.toBeNull();
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).nextTaskDue).not.toBeNull();

      expect(queueAdd).toHaveBeenCalledTimes(1);
      const payload = queueAdd.mock.calls[0][1] as { expectedEnrollmentId?: string };
      expect(payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 90_000);

  it('resume before the original job fires does not duplicate the job or the task', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();
      const launched = await launch(order.id);
      const enrollmentId = launched.enrollment.enrollmentId;
      const jobRun = await prisma.jobRun.findFirstOrThrow({ where: { tenantId } });

      await pauseEnrollmentOccurrence({
        enrollmentId,
        leadId,
        sequenceId,
        reason: 'manual',
        actorUserId: userA.id,
      });

      // The delayed job is still sitting in the queue, unfired.
      const changeDelay = vi.fn();
      queueGetJob.mockResolvedValue({
        id: jobRun.id,
        getState: async () => 'delayed',
        changeDelay,
      });
      queueAdd.mockClear();

      const first = await resumeEnrollmentOccurrence({ enrollmentId, leadId, sequenceId, tenantId });
      expect(first.ok).toBe(true);
      // A second attempt: the occurrence is fully active, so nothing is written or scheduled.
      const second = await resumeEnrollmentOccurrence({ enrollmentId, leadId, sequenceId, tenantId });
      expect(second.ok).toBe(true);
      expect(second.outcome).toBe('already_active');

      // The original job was *moved* to the resumed time rather than joined by a second one, so
      // it can no longer fire ahead of the resumed schedule.
      expect(changeDelay).toHaveBeenCalledTimes(1);
      expect(queueAdd).not.toHaveBeenCalled();
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
    });
  }, 90_000);

  it('carries the occurrence into the next step, and an old step-2 job cannot run under a replacement', async () => {
    await inTenant(async () => {
      // A two-step sequence so there is a step 2 to schedule.
      await prisma.sequenceStep.create({
        data: {
          tenantId,
          sequenceId,
          order: 2,
          channel: 'email',
          delayDays: 2,
          instructions: 'Follow up',
          autoComplete: true,
        },
      });

      const order = await makeWorkOrder();
      const launched = await launch(order.id);
      const enrollmentId = launched.enrollment.enrollmentId;
      queueAdd.mockClear();

      // Step 1 completes and the cadence advances.
      await advanceSequence(
        { leadId, sequenceId, sequenceStep: 1 },
        userA.id,
        enrollmentId
      );

      const step2Payload = queueAdd.mock.calls
        .map((call) => call[1] as { taskId: string; expectedEnrollmentId?: string })
        .find((p) => p.expectedEnrollmentId === enrollmentId);
      expect(step2Payload).toBeDefined();
      expect(step2Payload!.taskId).toBe(enrollmentStepTaskId(enrollmentId, 2));

      // The AI cadence ends; a human starts a new one on the same sequence.
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      const replacement = await prisma.sequenceEnrollment.create({
        data: {
          tenantId,
          leadId,
          sequenceId,
          status: 'active',
          currentStep: 1,
          occupancyKey: `${tenantId}:${leadId}`,
        },
      });

      const outcome = await handleExecuteTask(step2Payload!);

      expect(outcome.status).toBe('skipped');
      expect((outcome as { reason?: string }).reason).toBe('occurrence_no_longer_active');
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.id } }))
          .nextActionAt
      ).toBeNull();
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(0);
    });
  }, 120_000);

  // =========================================================================
  // Same-work-order concurrency, with exact totals
  // =========================================================================
  it('four concurrent launches of one work order converge to exactly one of everything', async () => {
    await inTenant(async () => {
      const order = await makeWorkOrder();

      const results = await Promise.allSettled(
        Array.from({ length: 4 }, () => launch(order.id))
      );

      // A rejection is only acceptable if it is a typed domain refusal — never a raw database
      // error leaking out of a race.
      for (const result of results) {
        if (result.status === 'rejected') {
          expect(['LaunchNotAllowedError', 'SequenceEnrollmentError']).toContain(
            (result.reason as Error).name
          );
        }
      }
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

      const launchRow = await prisma.sequenceLaunch.findUniqueOrThrow({
        where: { tenantId_workOrderId: { tenantId, workOrderId: order.id } },
      });
      const enrollmentId = launchEnrollmentId(launchRow.id);

      expect(await prisma.sequenceLaunch.count({ where: { tenantId, workOrderId: order.id } })).toBe(1);
      expect(await prisma.sequenceEnrollment.count({ where: { tenantId, id: enrollmentId } })).toBe(1);
      expect(
        await prisma.sequenceEnrollment.count({
          where: { tenantId, leadId, status: { in: ['active', 'paused'] } },
        })
      ).toBe(1);
      expect(await prisma.activity.count({ where: { leadId, type: 'sequence_enrolled' } })).toBe(1);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
      expect(
        await prisma.prospectTransition.count({
          where: { tenantId, leadId, kind: 'ai_managed_started' },
        })
      ).toBe(1);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
    });
  }, 120_000);
});
