import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';

/**
 * Activation → queue (Revenue AI Phase 6b).
 *
 * `enqueue` is mocked so the suite needs no Redis; everything below it — activation, conflict
 * detection, lease claiming, playbook pinning — is real, because the claim under test is that a
 * *refused* activation enqueues nothing and a successful one enqueues exactly one job at the
 * declared priority.
 *
 * Covers Phase 6b acceptance: activation enqueues through the existing BullMQ system, at the
 * SLA-derived priority, and a duplicate dispatch does not queue a second execution.
 */

const mockEnqueue = vi.fn();

vi.mock('@/lib/bullmq/enqueue', () => ({
  enqueue: (...args: unknown[]) => mockEnqueue(...args),
  enqueueReschedule: vi.fn(),
  enqueueImmediate: vi.fn(),
}));

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const { prisma } = await import('@/lib/prisma');
const { dispatchWorkOrder } = await import('@/lib/workorders/dispatch');
const { createWorkOrder, requireWorkOrder } = await import('@/lib/workorders/service');
const { WorkOrderConflictError } = await import('@/lib/workorders/conflicts');
const { JobType } = await import('@/lib/bullmq/types');
const { AGENT_SLA_PRIORITY } = await import('@/lib/agent/priorities');
const { resetWorkOrders, runAs, setupWorkOrderFixture } = await import(
  './helpers/workOrderFixture'
);
type WorkOrderFixture = Awaited<ReturnType<typeof setupWorkOrderFixture>>;

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('wodisp');
});

beforeEach(async () => {
  if (!hasDb) return;
  mockEnqueue.mockReset();
  mockEnqueue.mockResolvedValue('job-1');
  await resetWorkOrders(fx);
});

const draft = (type: string, requestKey: string, leadId: string | null = fx.idleLeadId) =>
  createWorkOrder({
    tenantId: fx.tenantId,
    type,
    createdById: fx.directorId,
    requestKey,
    leadId,
  });

describe.skipIf(!hasDb)('dispatch enqueues through the existing queue system', () => {
  it('activates and queues one job carrying the work order and actor', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'disp-basic');
      const result = await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      expect(result.changed).toBe(true);
      expect(mockEnqueue).toHaveBeenCalledTimes(1);

      const [jobType, payload, opts] = mockEnqueue.mock.calls[0];
      expect(jobType).toBe(JobType.AGENT_EXECUTE_WORK_ORDER);
      expect(payload).toMatchObject({
        workOrderId: order.id,
        actorUserId: fx.directorId,
      });
      expect(opts).toMatchObject({ tenantId: fx.tenantId });

      expect((await requireWorkOrder(order.id, fx.tenantId)).status).toBe('active');
    });
  });

  it('hands the execution its lease token so it can renew and release', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'disp-token');
      await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      const [, payload] = mockEnqueue.mock.calls[0];
      expect((payload as { claimToken?: string }).claimToken).toBeTruthy();
    });
  });

  it('queues at the work order priority for prospect-facing work', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'disp-priority-wo');
      const result = await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      expect(result.slaClass).toBe('work_order');
      expect(result.priority).toBe(AGENT_SLA_PRIORITY.work_order);
      expect(mockEnqueue.mock.calls[0][2]).toMatchObject({
        priority: AGENT_SLA_PRIORITY.work_order,
      });
    });
  });

  it('queues batch work behind it, at bulk research priority', async () => {
    await run(async () => {
      const order = await draft('research_batch', 'disp-priority-bulk', null);
      const result = await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      expect(result.slaClass).toBe('bulk_research');
      expect(result.priority).toBe(AGENT_SLA_PRIORITY.bulk_research);
      // The ordering that matters: bulk research must never be queued ahead of ordinary work.
      expect(result.priority).toBeGreaterThan(AGENT_SLA_PRIORITY.work_order);
    });
  });

  it('keys the job on the work order, so a redelivered dispatch collapses to one', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'disp-dedupe');
      await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      const opts = mockEnqueue.mock.calls[0][2] as { dedupeKey?: string };
      expect(opts.dedupeKey).toBe(`agent-work-order:${fx.tenantId}:${order.id}`);
    });
  });

  it('does not queue a second execution for an already-active order', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'disp-twice');
      await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });
      const second = await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      expect(second.changed).toBe(false);
      expect(second.jobId).toBeNull();
      // A second job would race the first for the same lease.
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });
  });
});

describe.skipIf(!hasDb)('a refused activation leaves no job behind', () => {
  it('enqueues nothing when the lead is held by competing work', async () => {
    await run(async () => {
      const incumbent = await draft('outreach_launch', 'disp-incumbent');
      await dispatchWorkOrder({
        workOrderId: incumbent.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });
      mockEnqueue.mockClear();

      const challenger = await draft('reengagement', 'disp-challenger');
      await expect(
        dispatchWorkOrder({
          workOrderId: challenger.id,
          tenantId: fx.tenantId,
          actorUserId: fx.directorId,
        })
      ).rejects.toBeInstanceOf(WorkOrderConflictError);

      // A job for an order that was never allowed to run would find a draft and refuse itself,
      // after occupying a queue slot and a retry budget.
      expect(mockEnqueue).not.toHaveBeenCalled();
      expect((await requireWorkOrder(challenger.id, fx.tenantId)).status).toBe('draft');
    });
  });

  it('enqueues nothing when a human owns the prospect', async () => {
    await run(async () => {
      const order = await draft('reengagement', 'disp-human-managed', fx.humanManagedLeadId);
      await expect(
        dispatchWorkOrder({
          workOrderId: order.id,
          tenantId: fx.tenantId,
          actorUserId: fx.directorId,
        })
      ).rejects.toBeInstanceOf(WorkOrderConflictError);
      expect(mockEnqueue).not.toHaveBeenCalled();
    });
  });

  it('records the pinned playbook version before the job is queued', async () => {
    await run(async () => {
      const order = await draft('outreach_launch', 'disp-provenance');
      const result = await dispatchWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        actorUserId: fx.directorId,
      });

      // The worker reads provenance from the row, so it has to be there before the job can be
      // picked up — which is why activation happens first and enqueue second.
      expect(result.playbookVersionId).toBe(fx.versionOneId);
      const stored = await prisma.workOrder.findFirstOrThrow({
        where: { id: order.id, tenantId: fx.tenantId },
      });
      expect(stored.playbookVersionId).toBe(fx.versionOneId);
    });
  });
});
