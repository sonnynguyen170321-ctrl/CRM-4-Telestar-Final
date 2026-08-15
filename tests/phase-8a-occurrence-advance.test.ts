import { vi, describe, it, expect, beforeEach } from 'vitest';

const sessionUser = { current: null as unknown };

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    requireAuth: async () => sessionUser.current,
    requireRole: async () => sessionUser.current,
    getSessionUser: async () => sessionUser.current,
  };
});

/** The same stateful queue the resume suite uses: what exists matters, not how often we called. */
const { jobStore, fakeQueue } = vi.hoisted(() => {
  interface Rec {
    state: string;
    delay: number;
    payload: { taskId: string; expectedEnrollmentId?: string };
    promoted: boolean;
  }
  const jobStore = new Map<string, Rec>();
  const fakeQueue = {
    async add(
      _name: string,
      data: { taskId: string; expectedEnrollmentId?: string },
      opts: { jobId: string; delay?: number }
    ) {
      const delay = opts.delay ?? 0;
      jobStore.set(opts.jobId, {
        state: delay > 0 ? 'delayed' : 'waiting',
        delay,
        payload: data,
        promoted: jobStore.get(opts.jobId)?.promoted ?? false,
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
        },
        async remove() {
          jobStore.delete(id);
        },
        async promote() {
          rec.promoted = true;
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

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { occupancyKeyFor } from '@/lib/sequences/occupancy';
import { launchAIOutreach } from '@/lib/prospects/outreach';
import { advanceSequence } from '@/lib/sequences/engine';
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { ensureOccurrenceStepTask } from '@/lib/sequences/occurrenceTask';
import { handleExecuteTask } from '@/workers/sequence';
import { POST as bulkAction } from '@/app/api/sequences/[id]/enrollments/bulk-action/route';
import type { SessionUser } from '@/lib/auth';

/**
 * Occurrence identity where it used to leak: the run-now producers, and the CRM state writes that
 * `advanceSequence` performs once a step completes.
 */
describe('Phase 8a — occurrence identity through run-now and advancement', () => {
  let tenantId: string;
  let leadId: string;
  let sequenceId: string;
  let userA: SessionUser;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId, bypassRls: true }, fn);

  const addStep = (order: number, delayDays: number) =>
    prisma.sequenceStep.create({
      data: {
        tenantId,
        sequenceId,
        order,
        channel: 'email',
        delayDays,
        instructions: `Touch ${order}`,
        autoComplete: true,
      },
    });

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

  const launch = async () => {
    const order = await makeWorkOrder();
    const result = await launchAIOutreach(userA, { leadId, sequenceId, workOrderId: order.id });
    return result.enrollment.enrollmentId;
  };

  /** End the AI cadence and start a human one on the same sequence — the replacement race. */
  const replaceWith = async (enrollmentId: string) => {
    await prisma.sequenceEnrollment.updateMany({
      where: { id: enrollmentId },
      data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
    });
    return prisma.sequenceEnrollment.create({
      data: {
        tenantId,
        leadId,
        sequenceId,
        status: 'active',
        currentStep: 1,
        occupancyKey: occupancyKeyFor(tenantId, leadId),
      },
    });
  };

  const bulk = (action: string, enrollmentIds: string[]) =>
    bulkAction(
      new NextRequest('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ action, enrollmentIds }),
      }),
      { params: Promise.resolve({ id: sequenceId }) }
    );

  beforeEach(async () => {
    jobStore.clear();

    tenantId = `t8oa-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Advance' } });

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const user = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'SDR',
          lastName: 'User',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'director',
        },
      });
      userA = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: 'director',
        tenantId,
      };
      sessionUser.current = userA;

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
      await addStep(1, 0);

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
  // 3A — run-now carries the occurrence
  // =========================================================================
  it('bulk run-now promotes the occurrence job instead of manufacturing a legacy one', async () => {
    await inTenant(async () => {
      // A genuinely delayed first touch, so there is something to fast-forward.
      await prisma.sequenceStep.updateMany({
        where: { sequenceId, order: 1 },
        data: { delayDays: 2 },
      });
      const enrollmentId = await launch();
      const [delayedId] = Array.from(jobStore.keys());
      expect(jobStore.get(delayedId)!.state).toBe('delayed');
      expect(jobStore.get(delayedId)!.payload.expectedEnrollmentId).toBe(enrollmentId);

      const res = await bulk('run-now', [enrollmentId]);
      expect(res.status).toBe(200);
      expect((await res.json()).processedCount).toBe(1);

      // The delayed job was promoted — same identity, same payload. A `{ taskId }`-only enqueue
      // hashes differently and would have produced a second, occurrence-less execution.
      expect(jobStore.size).toBe(1);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(1);
      const rec = jobStore.get(delayedId)!;
      expect(rec.promoted).toBe(true);
      expect(rec.payload.taskId).toBe(enrollmentStepTaskId(enrollmentId, 1));
      expect(rec.payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);

  it('a run-now job from a replaced occurrence refuses and sends nothing', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      await bulk('run-now', [enrollmentId]);
      const [jobId] = Array.from(jobStore.keys());
      const payload = jobStore.get(jobId)!.payload;

      // The replacement starts before the promoted job is executed.
      const replacement = await replaceWith(enrollmentId);

      const outcome = await handleExecuteTask(payload);

      expect(outcome.status).toBe('skipped');
      expect((outcome as { reason?: string }).reason).toBe('occurrence_no_longer_active');
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(0);
      const live = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.id } });
      expect(live.status).toBe('active');
      expect(live.currentStep).toBe(1);
    });
  }, 120_000);

  it('bulk run-now refuses a task that belongs to a different occurrence', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      // The occurrence's task stays, but the enrollment asking to run it is a different one.
      const replacement = await replaceWith(enrollmentId);
      jobStore.clear();

      const res = await bulk('run-now', [replacement.id]);

      expect((await res.json()).processedCount).toBe(0);
      expect(jobStore.size).toBe(0);
    });
  }, 120_000);

  // =========================================================================
  // The occurrence-aware step-task helper maintenance delegates to
  // =========================================================================
  const repairCurrentStep = async (enrollmentId: string) => {
    const enr = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: enr.leadId } });
    const sequence = await prisma.sequence.findUniqueOrThrow({ where: { id: enr.sequenceId } });
    const step = await prisma.sequenceStep.findFirstOrThrow({
      where: { sequenceId: enr.sequenceId, order: enr.currentStep },
    });
    return ensureOccurrenceStepTask({
      enrollment: enr,
      lead,
      sequence,
      step,
      baseDate: new Date(Date.now() - step.delayDays * 86_400_000),
    });
  };

  it('rebuilds a missing current-step task under the occurrence identity', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      await prisma.task.deleteMany({ where: { tenantId, leadId } });
      jobStore.clear();

      const taskId = await repairCurrentStep(enrollmentId);

      expect(taskId).toBe(enrollmentStepTaskId(enrollmentId, 1));
      const tasks = await prisma.task.findMany({ where: { tenantId, leadId } });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].status).toBe('pending');
      const jobs = Array.from(jobStore.values());
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload.taskId).toBe(taskId);
      expect(jobs[0].payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);

  it('a repeated repair produces no duplicate task or job', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      await prisma.task.deleteMany({ where: { tenantId, leadId } });
      jobStore.clear();

      await repairCurrentStep(enrollmentId);
      await repairCurrentStep(enrollmentId);

      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(1);
      expect(jobStore.size).toBe(1);
    });
  }, 120_000);

  it('refuses to repair an occurrence that was replaced, leaving no executable job', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      const enr = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      const sequence = await prisma.sequence.findUniqueOrThrow({ where: { id: sequenceId } });
      const step = await prisma.sequenceStep.findFirstOrThrow({ where: { sequenceId, order: 1 } });
      await prisma.task.deleteMany({ where: { tenantId, leadId } });
      jobStore.clear();
      await prisma.jobRun.deleteMany({ where: { tenantId } });

      // The sweep read the enrollment, then a human took the lead.
      const replacement = await replaceWith(enrollmentId);
      const before = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });

      await expect(
        ensureOccurrenceStepTask({ enrollment: enr, lead, sequence, step, baseDate: new Date() })
      ).rejects.toThrow(/no longer the active enrollment/);

      // Strict scheduling refuses before anything reaches the queue, and before the lead cache is
      // rewritten on the replacement's behalf.
      expect(jobStore.size).toBe(0);
      expect(await prisma.jobRun.count({ where: { tenantId } })).toBe(0);
      const after = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(after.nextTaskDue?.getTime()).toBe(before.nextTaskDue?.getTime());
      expect(
        (await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.id } }))
          .nextActionAt
      ).toBeNull();
    });
  }, 120_000);

  it('a repaired task that runs after a replacement is refused by the worker', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      await prisma.task.deleteMany({ where: { tenantId, leadId } });
      jobStore.clear();
      await repairCurrentStep(enrollmentId);
      const [payload] = Array.from(jobStore.values()).map((j) => j.payload);

      await replaceWith(enrollmentId);

      const outcome = await handleExecuteTask(payload);

      expect(outcome.status).toBe('skipped');
      expect((outcome as { reason?: string }).reason).toBe('occurrence_no_longer_active');
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(0);
    });
  }, 120_000);

  // =========================================================================
  // 3B — advancement writes only to the exact occurrence
  // =========================================================================
  it('does not advance when the expected occurrence is already terminal', async () => {
    await inTenant(async () => {
      await addStep(2, 1);
      const enrollmentId = await launch();
      await prisma.sequenceEnrollment.updateMany({
        where: { id: enrollmentId },
        data: { status: 'unenrolled', completedAt: new Date(), occupancyKey: null },
      });
      const tasksBefore = await prisma.task.count({ where: { tenantId, leadId } });

      await advanceSequence({ leadId, sequenceId, sequenceStep: 1 }, userA.id, enrollmentId);

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.currentStep).toBe(1);
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(tasksBefore);
    });
  }, 120_000);

  it('a stale occurrence cannot advance, complete, or re-task the cadence that replaced it', async () => {
    await inTenant(async () => {
      await addStep(2, 1);
      const enrollmentId = await launch();
      const replacement = await replaceWith(enrollmentId);
      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceId, sequenceStep: 1, sequenceStatus: 'active' },
      });
      const tasksBefore = await prisma.task.count({ where: { tenantId, leadId } });
      jobStore.clear();

      await advanceSequence({ leadId, sequenceId, sequenceStep: 1 }, userA.id, enrollmentId);

      const live = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.id } });
      expect(live.status).toBe('active');
      expect(live.currentStep).toBe(1);
      expect(live.completedAt).toBeNull();
      expect(live.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));

      // The lead cache still describes the replacement, and no step-2 task or job appeared.
      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.sequenceId).toBe(sequenceId);
      expect(lead.sequenceStep).toBe(1);
      expect(lead.sequenceStatus).toBe('active');
      expect(await prisma.task.count({ where: { tenantId, leadId } })).toBe(tasksBefore);
      expect(jobStore.size).toBe(0);
    });
  }, 120_000);

  it('the exact occurrence advances, keeping the identity on the next step', async () => {
    await inTenant(async () => {
      await addStep(2, 1);
      const enrollmentId = await launch();
      jobStore.clear();

      await advanceSequence({ leadId, sequenceId, sequenceStep: 1 }, userA.id, enrollmentId);

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.currentStep).toBe(2);
      expect(row.status).toBe('active');
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).sequenceStep).toBe(2);

      const step2 = await prisma.task.findUnique({
        where: { id: enrollmentStepTaskId(enrollmentId, 2) },
      });
      expect(step2).not.toBeNull();
      const jobs = Array.from(jobStore.values());
      expect(jobs).toHaveLength(1);
      expect(jobs[0].payload.taskId).toBe(enrollmentStepTaskId(enrollmentId, 2));
      expect(jobs[0].payload.expectedEnrollmentId).toBe(enrollmentId);
    });
  }, 120_000);

  it('steps 1 → 2 → 3 all keep the occurrence in the task id and the job payload', async () => {
    await inTenant(async () => {
      await addStep(2, 1);
      await addStep(3, 2);
      const enrollmentId = await launch();
      jobStore.clear();

      for (const completed of [1, 2]) {
        await advanceSequence({ leadId, sequenceId, sequenceStep: completed }, userA.id, enrollmentId);
      }

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.currentStep).toBe(3);

      for (const order of [2, 3]) {
        expect(
          await prisma.task.findUnique({ where: { id: enrollmentStepTaskId(enrollmentId, order) } })
        ).not.toBeNull();
      }
      const jobs = Array.from(jobStore.values());
      expect(jobs).toHaveLength(2);
      for (const job of jobs) {
        expect(job.payload.expectedEnrollmentId).toBe(enrollmentId);
      }
      expect(jobs.map((j) => j.payload.taskId).sort()).toEqual(
        [enrollmentStepTaskId(enrollmentId, 2), enrollmentStepTaskId(enrollmentId, 3)].sort()
      );
    });
  }, 120_000);

  it('final-step completion terminalizes the exact occurrence and releases its occupancy', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();

      await advanceSequence({ leadId, sequenceId, sequenceStep: 1 }, userA.id, enrollmentId);

      const row = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      expect(row.status).toBe('completed');
      expect(row.completedAt).not.toBeNull();
      expect(row.occupancyKey).toBeNull();

      const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
      expect(lead.sequenceId).toBeNull();
      expect(lead.sequenceStatus).toBeNull();
      expect(
        await prisma.activity.count({ where: { leadId, type: 'sequence_completed' } })
      ).toBe(1);
    });
  }, 120_000);

  it('a stale final step cannot complete the replacement enrollment', async () => {
    await inTenant(async () => {
      const enrollmentId = await launch();
      const replacement = await replaceWith(enrollmentId);
      await prisma.lead.update({
        where: { id: leadId },
        data: { sequenceId, sequenceStep: 1, sequenceStatus: 'active' },
      });

      await advanceSequence({ leadId, sequenceId, sequenceStep: 1 }, userA.id, enrollmentId);

      const live = await prisma.sequenceEnrollment.findUniqueOrThrow({ where: { id: replacement.id } });
      expect(live.status).toBe('active');
      expect(live.completedAt).toBeNull();
      expect(live.occupancyKey).toBe(occupancyKeyFor(tenantId, leadId));
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).sequenceId).toBe(
        sequenceId
      );
      expect(await prisma.activity.count({ where: { leadId, type: 'sequence_completed' } })).toBe(0);
    });
  }, 120_000);
});
