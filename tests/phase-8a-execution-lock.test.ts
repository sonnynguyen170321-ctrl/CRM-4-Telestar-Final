import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const { jobStore, fakeQueue } = vi.hoisted(() => {
  const jobStore = new Map<string, { payload: unknown; name: string }>();
  const fakeQueue = {
    async add(name: string, data: unknown, opts: { jobId: string }) {
      jobStore.set(opts.jobId, { payload: data, name });
      return { id: opts.jobId };
    },
    async getJob() {
      return undefined;
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
import { enrollmentStepTaskId } from '@/lib/sequences/identity';
import { handleExecuteTask } from '@/workers/sequence';

/**
 * The execution lock, raced against a real database.
 *
 * `updateMany({ where: { id, status: 'pending' } })` matched for *both* runners — the row stays
 * pending until much later — so the "lock" excluded nobody and a double execution could send
 * twice, bump the counters twice and advance the cadence twice. Adding `lockedAt: null` turns it
 * into a real compare-and-set, which only a genuine concurrent run can demonstrate: a mocked
 * `count: 0` proves the caller handles a lost lock, not that the lock is exclusive.
 */
describe('Phase 8a — task execution lock', () => {
  let tenantId: string;
  let leadId: string;
  let sequenceId: string;
  let enrollmentId: string;
  let templateId: string;
  let taskId: string;
  let variantAId: string;
  let variantBId: string;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    tenantStorage.run({ tenantId, bypassRls: true }, fn);

  beforeEach(async () => {
    jobStore.clear();
    // Pinned to a Wednesday inside working hours: the eligibility engine's weekend policy would
    // otherwise defer this test on a real weekend rather than run it.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-12T10:00:00Z'));

    tenantId = `t8el-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Lock' } });

    await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const user = await prisma.user.create({
        data: {
          id: `u-${randomUUID()}`,
          tenantId,
          email: `sdr.${randomUUID()}@acme.test`,
          firstName: 'Sam',
          lastName: 'Rep',
          password: '$2a$10$abcdefghijklmnopqrstuu',
          role: 'sdr',
        },
      });

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
          startDate: new Date('2026-01-01T00:00:00Z'),
          status: 'active',
        },
      });

      const template = await prisma.template.create({
        data: {
          tenantId,
          name: 'Opener',
          channel: 'email',
          subject: 'Hi {{firstName}}',
          body: 'Body for {{company}}',
          createdById: user.id,
        },
      });
      templateId = template.id;
      const a = await prisma.abTestVariant.create({
        data: { tenantId, templateId, version: 'A', subject: 'A subject', body: 'A body' },
      });
      const b = await prisma.abTestVariant.create({
        data: { tenantId, templateId, version: 'B', subject: 'B subject', body: 'B body' },
      });
      variantAId = a.id;
      variantBId = b.id;

      const sequence = await prisma.sequence.create({
        data: { tenantId, name: 'Auto Seq', createdById: user.id },
      });
      sequenceId = sequence.id;
      for (const order of [1, 2]) {
        await prisma.sequenceStep.create({
          data: {
            tenantId,
            sequenceId,
            order,
            channel: 'email',
            delayDays: order === 1 ? 0 : 2,
            instructions: `Touch ${order}`,
            autoComplete: true,
            templateId,
          },
        });
      }

      await prisma.emailAccount.create({
        data: {
          tenantId,
          userId: user.id,
          email: `sdr.${randomUUID()}@telestar.test`,
          provider: 'imap_smtp',
          isActive: true,
          dailyCap: 100,
          dailySendCount: 0,
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
          sequenceId,
          sequenceStep: 1,
          sequenceStatus: 'active',
          timezone: 'UTC',
        },
      });
      leadId = lead.id;

      enrollmentId = `enr-${randomUUID()}`;
      await prisma.sequenceEnrollment.create({
        data: {
          id: enrollmentId,
          tenantId,
          leadId,
          sequenceId,
          status: 'active',
          currentStep: 1,
          occupancyKey: occupancyKeyFor(tenantId, leadId),
        },
      });

      taskId = enrollmentStepTaskId(enrollmentId, 1);
      await prisma.task.create({
        data: {
          id: taskId,
          tenantId,
          leadId,
          userId: user.id,
          type: 'email',
          title: 'Step 1: Email — Auto Seq',
          dueDate: new Date('2026-08-12T09:00:00Z'),
          sequenceId,
          sequenceStep: 1,
          priority: 'medium',
        },
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Hold both runners at the lock until both have arrived.
   *
   * `Promise.all` alone is not a race: the two identical await-chains interleave however the
   * driver happens to schedule them, and the first can finish the whole send before the second
   * reaches the claim — at which point `status: 'pending'` excludes it on its own and the test
   * passes against the broken lock too. The barrier makes both issue the UPDATE while the row is
   * still pending, which is the only state where `lockedAt` has to do the excluding.
   */
  function barrierAtLock(participants: number) {
    let arrived = 0;
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const original = prisma.task.updateMany.bind(prisma.task);
    const barrier = async (args: { data?: { lockedAt?: unknown } }) => {
      if (args?.data?.lockedAt instanceof Date) {
        arrived += 1;
        if (arrived >= participants) open();
        await gate;
      }
      return original(args as Parameters<typeof original>[0]);
    };
    return vi.spyOn(prisma.task, 'updateMany').mockImplementation(barrier as never);
  }

  it('lets exactly one of two simultaneous executions through', async () => {
    await inTenant(async () => {
      const spy = barrierAtLock(2);
      const results = await Promise.all([
        handleExecuteTask({ taskId, expectedEnrollmentId: enrollmentId }),
        handleExecuteTask({ taskId, expectedEnrollmentId: enrollmentId }),
      ]);
      spy.mockRestore();

      const completed = results.filter((r) => r.status === 'completed');
      const blocked = results.filter(
        (r) => (r as { reason?: string }).reason === 'concurrency_lock_failed'
      );
      expect(completed).toHaveLength(1);
      expect(blocked).toHaveLength(1);

      // One of everything downstream of the lock.
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(1);
      const emailJobs = Array.from(jobStore.values()).filter((j) => j.name === 'email.send');
      expect(emailJobs).toHaveLength(1);
      expect((await prisma.lead.findUniqueOrThrow({ where: { id: leadId } })).emailSentCount).toBe(1);

      const variants = await prisma.abTestVariant.findMany({
        where: { id: { in: [variantAId, variantBId] } },
      });
      expect(variants.reduce((sum, v) => sum + v.sentCount, 0)).toBe(1);

      // One advancement, and one step-2 task carrying the occurrence.
      const enrollment = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
      });
      expect(enrollment.currentStep).toBe(2);
      const step2Tasks = await prisma.task.findMany({
        where: { tenantId, leadId, sequenceStep: 2 },
      });
      expect(step2Tasks).toHaveLength(1);
      expect(step2Tasks[0].id).toBe(enrollmentStepTaskId(enrollmentId, 2));
    });
  }, 120_000);

  it('refuses a task already claimed by another owner of the lock', async () => {
    await inTenant(async () => {
      // The maintenance repair sweep holds the claim.
      await prisma.task.update({ where: { id: taskId }, data: { lockedAt: new Date() } });

      const result = await handleExecuteTask({ taskId, expectedEnrollmentId: enrollmentId });

      expect(result).toEqual({ status: 'ignored', reason: 'concurrency_lock_failed' });
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(0);
    });
  }, 120_000);

  it('sends nothing when the same occurrence advanced past this step before the send', async () => {
    await inTenant(async () => {
      // The entry validation passes; the cadence then advances while eligibility work runs.
      const original = prisma.emailAccount.findFirst.bind(prisma.emailAccount);
      const advanceThenRead = async (args: unknown) => {
        await prisma.sequenceEnrollment.update({
          where: { id: enrollmentId },
          data: { currentStep: 2 },
        });
        return original(args as Parameters<typeof original>[0]);
      };
      const spy = vi
        .spyOn(prisma.emailAccount, 'findFirst')
        .mockImplementation(advanceThenRead as never);

      const result = await handleExecuteTask({ taskId, expectedEnrollmentId: enrollmentId });
      spy.mockRestore();

      expect(result).toMatchObject({ status: 'skipped', reason: 'occurrence_step_changed' });
      expect(await prisma.outboundMessage.count({ where: { tenantId } })).toBe(0);
      expect(Array.from(jobStore.values()).filter((j) => j.name === 'email.send')).toHaveLength(0);
      // The lock is released rather than stranding the task claimed.
      expect((await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).lockedAt).toBeNull();
    });
  }, 120_000);
});
