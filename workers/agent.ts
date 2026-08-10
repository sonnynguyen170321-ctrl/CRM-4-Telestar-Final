import { createAppWorker } from '@/lib/bullmq';
import { JobType, QUEUES } from '@/lib/bullmq/types';
import type { AgentExecuteWorkOrderPayload } from '@/lib/bullmq/types';
import { executeWorkOrder, type ExecuteWorkOrderResult } from '@/lib/workorders/execution';
import { planWorkOrderSteps } from '@/lib/workorders/plan';
import { requireWorkOrder } from '@/lib/workorders/service';
import { releaseLease } from '@/lib/workorders/leases';
import { leaseModeForType, type WorkOrderType } from '@/lib/workorders/types';

/**
 * The agent worker (Revenue AI Phase 6b).
 *
 * Thin on purpose. It resolves a plan, hands it to `executeWorkOrder`, and gives the lease back
 * — every decision worth making lives in the domain services underneath, where it can be tested
 * without a broker. A worker that made its own authorization or budget judgements would be a
 * second implementation of both, reachable only through Redis.
 *
 * `createAppWorker` wraps this in `wrapProcessor`, so the `JobRun` mirror, tenant resolution and
 * lifecycle transitions come from the existing infrastructure rather than an agent-specific job
 * store. That is the reuse the phase requires: `JobRun` already answers "what is this worker
 * doing" for every other queue, and an agent-only answer would need its own observability.
 *
 * ## The lease is released here, not in the execution loop
 *
 * Execution can end four ways — completed, paused for budget, paused for approval, refused — and
 * three of them should give the lead back. Only `awaiting_approval` keeps it, because that order
 * is still the one working this lead while a human decides. Putting the release at the worker
 * boundary means a thrown error also unwinds it, which a release inside the loop would miss.
 */

/** Concurrency 1: two executions of one work order would race for the same lease anyway. */
const AGENT_CONCURRENCY = 1;

export async function handleExecuteWorkOrder(
  payload: AgentExecuteWorkOrderPayload,
  tenantId: string
): Promise<ExecuteWorkOrderResult> {
  const order = await requireWorkOrder(payload.workOrderId, tenantId);
  const steps = await planWorkOrderSteps(order);

  let result: ExecuteWorkOrderResult;
  try {
    result = await executeWorkOrder({
      workOrderId: payload.workOrderId,
      tenantId,
      actorUserId: payload.actorUserId,
      steps,
    });
  } catch (err) {
    // A thrown execution still has to give the lead back, or a crash mid-plan strands it until
    // the lease expires. The job itself still fails, so BullMQ retries and `JobRun` records why.
    await releaseHeldLease(payload, tenantId, order.leadId, order.type as WorkOrderType);
    throw err;
  }

  if (result.pausedReason !== 'awaiting_approval') {
    await releaseHeldLease(payload, tenantId, order.leadId, order.type as WorkOrderType);
  }

  return result;
}

async function releaseHeldLease(
  payload: AgentExecuteWorkOrderPayload,
  tenantId: string,
  leadId: string | null,
  type: WorkOrderType
): Promise<void> {
  // Nothing to release for a campaign-scoped order, a shared-mode one, or a job that was never
  // handed a token — and a release without the current token is correctly refused anyway.
  if (!leadId || !payload.claimToken) return;
  if (leaseModeForType(type) !== 'exclusive') return;

  await releaseLease({
    tenantId,
    leadId,
    workOrderId: payload.workOrderId,
    claimToken: payload.claimToken,
  });
}

export function createAgentWorker() {
  return createAppWorker(
    QUEUES.AGENT,
    async (job) => {
      if (job.name !== JobType.AGENT_EXECUTE_WORK_ORDER) return;
      const payload = job.data as AgentExecuteWorkOrderPayload;
      const order = await requireWorkOrderForJob(payload.workOrderId);
      return handleExecuteWorkOrder(payload, order.tenantId);
    },
    { concurrency: AGENT_CONCURRENCY }
  );
}

/**
 * Read the order without knowing its tenant yet.
 *
 * `wrapProcessor` has already entered the job's tenant context from `JobRun`, so a scoped read
 * resolves correctly; this exists to turn the row into the tenant id the domain services want
 * passed explicitly.
 */
async function requireWorkOrderForJob(workOrderId: string) {
  const { prisma } = await import('@/lib/prisma');
  const order = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
    select: { tenantId: true },
  });
  if (!order) throw new Error(`Work order ${workOrderId} not found`);
  return order;
}
