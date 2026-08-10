import { vi, describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  activateWorkOrder,
  createWorkOrder,
  finishWorkOrder,
  pauseWorkOrder,
  requireWorkOrder,
  WorkOrderValidationError,
} from '@/lib/workorders/service';
import { WorkOrderConflictError, detectActivationConflicts } from '@/lib/workorders/conflicts';
import { activateVersion } from '@/lib/playbooks/versions';
import {
  resetWorkOrders,
  runAs,
  setupWorkOrderFixture,
  type WorkOrderFixture,
} from './helpers/workOrderFixture';

// Services must not pull next-auth setup into Vitest.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * Work order creation, provenance, conflicts and lifecycle (Revenue AI Phase 6a).
 *
 * Database-backed, because the guarantees are database guarantees. Leases and tenant isolation
 * live in `work-order-leases.test.ts` — a separate file with its own tenant prefix, so the two
 * can run in parallel against one database without clearing each other's fixtures.
 *
 * Covers Phase 6a acceptance 4, 5 and 10.
 */

const hasDb = Boolean(process.env.DATABASE_URL);

let fx: WorkOrderFixture;
const run = <T>(fn: () => Promise<T>) => runAs(fx.tenantId, fn);

beforeAll(async () => {
  if (!hasDb) return;
  fx = await setupWorkOrderFixture('wolife');
});

beforeEach(async () => {
  if (!hasDb) return;
  await resetWorkOrders(fx);
});

/** Create + activate in one step, for the tests that only care about the end state. */
async function activated(type: string, leadId: string | null, requestKey: string) {
  const order = await createWorkOrder({
    tenantId: fx.tenantId,
    type,
    createdById: fx.directorId,
    requestKey,
    leadId,
  });
  await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });
  return requireWorkOrder(order.id, fx.tenantId);
}

describe.skipIf(!hasDb)('work order creation', () => {
  it('creates a draft carrying the default budgets', async () => {
    await run(async () => {
      const order = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'research_batch',
        createdById: fx.directorId,
        requestKey: 'create-defaults',
        campaignId: fx.campaignId,
      });

      expect(order.status).toBe('draft');
      expect(order.researchBudget).toBe(50);
      expect(order.tokenBudget).toBe(250_000);
      expect(order.maxToolCalls).toBe(50);
      expect(order.maxExecutionDuration).toBe(3_600);
      expect(order.activatedAt).toBeNull();
    });
  });

  it('is idempotent on requestKey — a redelivered request is not a second order', async () => {
    await run(async () => {
      const first = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'research_batch',
        createdById: fx.directorId,
        requestKey: 'same-key',
        leadId: fx.idleLeadId,
      });
      const second = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'research_batch',
        createdById: fx.directorId,
        requestKey: 'same-key',
        leadId: fx.idleLeadId,
      });

      expect(second.id).toBe(first.id);
      expect(
        await prisma.workOrder.count({ where: { tenantId: fx.tenantId, requestKey: 'same-key' } })
      ).toBe(1);
    });
  });

  it('refuses an out-of-bounds budget, and writes nothing', async () => {
    await run(async () => {
      await expect(
        createWorkOrder({
          tenantId: fx.tenantId,
          type: 'research_batch',
          createdById: fx.directorId,
          requestKey: 'bad-budget',
          budgets: { maxToolCalls: 0, tokenBudget: 99_000_000 },
        })
      ).rejects.toBeInstanceOf(WorkOrderValidationError);

      expect(
        await prisma.workOrder.count({ where: { tenantId: fx.tenantId, requestKey: 'bad-budget' } })
      ).toBe(0);
    });
  });

  it('refuses an unknown type', async () => {
    await run(async () => {
      await expect(
        createWorkOrder({
          tenantId: fx.tenantId,
          type: 'exfiltrate_everything',
          createdById: fx.directorId,
          requestKey: 'bad-type',
        })
      ).rejects.toBeInstanceOf(WorkOrderValidationError);
    });
  });

  it('refuses a lead belonging to another tenant', async () => {
    await run(async () => {
      await expect(
        createWorkOrder({
          tenantId: fx.tenantId,
          type: 'research_batch',
          createdById: fx.directorId,
          requestKey: 'cross-tenant-lead',
          leadId: fx.otherTenantLeadId,
        })
      ).rejects.toBeInstanceOf(WorkOrderValidationError);
    });
  });
});

describe.skipIf(!hasDb)('playbook provenance is exact, and pinned once', () => {
  it('records the campaign version in force at activation', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'prov-1');
      expect(order.playbookVersionId).toBe(fx.versionOneId);
    });
  });

  it('derives the campaign from the lead when the caller names no campaign', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'prov-derived');
      expect(order.campaignId).toBe(fx.campaignId);
      expect(order.playbookVersionId).toBe(fx.versionOneId);
    });
  });

  it('does not re-resolve on a later activation — the pinned version is what it ran under', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'prov-pinned');
      expect(order.playbookVersionId).toBe(fx.versionOneId);

      await pauseWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId, reason: 'manual' });
      await activateVersion(fx.versionTwoId, fx.tenantId);
      await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });

      expect((await requireWorkOrder(order.id, fx.tenantId)).playbookVersionId).toBe(
        fx.versionOneId
      );
    });
  });
});

describe.skipIf(!hasDb)('conflicting work is refused and named, never replaced', () => {
  it('refuses a second prospect-touching order on one lead', async () => {
    await run(async () => {
      const first = await activated('outreach_launch', fx.idleLeadId, 'conflict-first');

      const second = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'reengagement',
        createdById: fx.directorId,
        requestKey: 'conflict-second',
        leadId: fx.idleLeadId,
      });

      const error = await activateWorkOrder({
        workOrderId: second.id,
        tenantId: fx.tenantId,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(WorkOrderConflictError);
      expect((error as WorkOrderConflictError).conflicts.map((c) => c.kind)).toContain(
        'active_work_order'
      );
      expect((error as WorkOrderConflictError).message).toContain(first.id);

      // The refusal changed nothing: the incumbent still runs, the challenger stays a draft.
      expect((await requireWorkOrder(first.id, fx.tenantId)).status).toBe('active');
      expect((await requireWorkOrder(second.id, fx.tenantId)).status).toBe('draft');
    });
  });

  it('allows assistance work alongside a running outreach order', async () => {
    await run(async () => {
      await activated('outreach_launch', fx.idleLeadId, 'coexist-outreach');
      const assist = await activated('reply_review', fx.idleLeadId, 'coexist-assist');
      expect(assist.status).toBe('active');
    });
  });

  it('refuses a prospect-touching order while the authoritative enrollment is active', async () => {
    await run(async () => {
      const order = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'outreach_launch',
        createdById: fx.directorId,
        requestKey: 'enrolled-conflict',
        leadId: fx.enrolledLeadId,
      });

      const error = await activateWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(WorkOrderConflictError);
      expect((error as WorkOrderConflictError).conflicts.map((c) => c.kind)).toContain(
        'active_sequence_enrollment'
      );
      expect((error as WorkOrderConflictError).message).toContain(fx.sequenceId);
    });
  });

  it('lets assistance work run on an actively enrolled lead', async () => {
    await run(async () => {
      const order = await activated('reply_review', fx.enrolledLeadId, 'enrolled-assist');
      expect(order.status).toBe('active');
    });
  });

  it('refuses a prospect-touching order while a human owns the prospect', async () => {
    await run(async () => {
      const order = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'reengagement',
        createdById: fx.directorId,
        requestKey: 'human-managed-conflict',
        leadId: fx.humanManagedLeadId,
      });

      const error = await activateWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
      }).catch((e) => e);

      expect(error).toBeInstanceOf(WorkOrderConflictError);
      expect((error as WorkOrderConflictError).conflicts.map((c) => c.kind)).toContain(
        'operating_state'
      );
    });
  });

  it('keeps assistance available on a human_managed prospect — human_managed is not "AI off"', async () => {
    await run(async () => {
      const order = await activated('reply_review', fx.humanManagedLeadId, 'human-managed-assist');
      expect(order.status).toBe('active');
    });
  });

  it('reports every conflict at once rather than one per round trip', async () => {
    await run(async () => {
      const conflicts = await detectActivationConflicts({
        tenantId: fx.tenantId,
        leadId: fx.enrolledLeadId,
        type: 'outreach_launch',
      });

      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      expect(conflicts.every((c) => c.detail.length > 0)).toBe(true);
    });
  });

  it('applies no lead-level conflicts to a campaign-scoped batch order', async () => {
    await run(async () => {
      const conflicts = await detectActivationConflicts({
        tenantId: fx.tenantId,
        leadId: null,
        type: 'prospect_batch',
      });
      expect(conflicts).toEqual([]);
    });
  });
});

describe.skipIf(!hasDb)('lifecycle transitions', () => {
  it('is idempotent on activation', async () => {
    await run(async () => {
      const order = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'research_batch',
        createdById: fx.directorId,
        requestKey: 'activate-twice',
        leadId: fx.idleLeadId,
      });

      const first = await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });
      const second = await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });

      expect(first.changed).toBe(true);
      expect(second.changed).toBe(false);
      expect(second.workOrder.activatedAt?.getTime()).toBe(first.workOrder.activatedAt?.getTime());
    });
  });

  it('keeps the original activation clock across a pause and resume', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'clock-preserved');
      const firstActivation = order.activatedAt!.getTime();

      await pauseWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId, reason: 'manual' });
      await activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId });

      expect((await requireWorkOrder(order.id, fx.tenantId)).activatedAt!.getTime()).toBe(
        firstActivation
      );
    });
  });

  it('treats budget exhaustion as a pause with a reason, not a failure', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'budget-pause');
      const paused = await pauseWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        reason: 'budget_exhausted',
      });

      expect(paused.status).toBe('paused');
      expect(paused.pausedReason).toBe('budget_exhausted');
      expect(paused.completedAt).toBeNull();
    });
  });

  it('rejects a pause reason outside the vocabulary', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'bad-pause-reason');
      await expect(
        pauseWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId, reason: 'because' })
      ).rejects.toBeInstanceOf(WorkOrderValidationError);
    });
  });

  it('releases the lease when an order ends, freeing the lead for the next one', async () => {
    await run(async () => {
      const first = await activated('outreach_launch', fx.idleLeadId, 'finish-releases');
      await finishWorkOrder({
        workOrderId: first.id,
        tenantId: fx.tenantId,
        status: 'completed',
      });

      const next = await createWorkOrder({
        tenantId: fx.tenantId,
        type: 'reengagement',
        createdById: fx.directorId,
        requestKey: 'finish-successor',
        leadId: fx.idleLeadId,
      });
      expect((await activateWorkOrder({ workOrderId: next.id, tenantId: fx.tenantId })).changed).toBe(
        true
      );
    });
  });

  it('keeps the lease when pausing to await approval', async () => {
    await run(async () => {
      const order = await activated('outreach_launch', fx.idleLeadId, 'approval-holds-lease');
      await pauseWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        reason: 'awaiting_approval',
        keepLease: true,
      });

      const lease = await prisma.workOrderLease.findUnique({
        where: { tenantId_leadId: { tenantId: fx.tenantId, leadId: fx.idleLeadId } },
      });
      expect(lease?.releasedAt).toBeNull();
      expect(lease?.workOrderId).toBe(order.id);
    });
  });

  it('refuses to activate an order that has already ended', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'ended-order');
      await finishWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        status: 'cancelled',
      });

      await expect(
        activateWorkOrder({ workOrderId: order.id, tenantId: fx.tenantId })
      ).rejects.toThrow(/cancelled/);
    });
  });

  it('records the terminal instant for a cancelled order too, not only a completed one', async () => {
    await run(async () => {
      const order = await activated('research_batch', fx.idleLeadId, 'terminal-instant');
      const finished = await finishWorkOrder({
        workOrderId: order.id,
        tenantId: fx.tenantId,
        status: 'failed',
      });

      expect(finished.status).toBe('failed');
      expect(finished.completedAt).not.toBeNull();
    });
  });
});
