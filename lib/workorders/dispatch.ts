import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { priorityForSlaClass, slaClassForWorkOrderType, type AgentSlaClass } from '@/lib/agent/priorities';
import { activateWorkOrder, type ActivateResult } from './service';

/**
 * Activation → queue (Revenue AI Phase 6b).
 *
 * Deliberately **not** folded into `activateWorkOrder`. Activation is a domain transition with
 * database-only consequences, and it is exercised by suites that have no Redis; making it
 * enqueue would drag a broker into every test that activates an order and into every code path
 * that only wants the state change. This is the seam where the two meet, and it is the only
 * place that knows both.
 *
 * Order is activate-then-enqueue, and that order is load-bearing: a job that arrived before the
 * status was `active` would find a draft and refuse itself. The reverse failure — activated but
 * never enqueued — is visible (`active` with no `JobRun`) and re-dispatchable, which is the
 * better of the two.
 */

export interface DispatchResult extends ActivateResult {
  /** The `JobRun` id, which is also the BullMQ job id. Null when activation changed nothing. */
  jobId: string | null;
  slaClass: AgentSlaClass;
  priority: number;
}

export interface DispatchInput {
  workOrderId: string;
  tenantId: string;
  /** Whose authority the execution runs under. */
  actorUserId: string;
  leaseTtlSeconds?: number;
  now?: Date;
}

/**
 * Activate a work order and queue its execution.
 *
 * Conflicts, lease claims and playbook pinning all happen inside `activateWorkOrder` and throw
 * before anything is enqueued — a refused activation must not leave a job behind to find a work
 * order that was never allowed to run.
 */
export async function dispatchWorkOrder(input: DispatchInput): Promise<DispatchResult> {
  const activation = await activateWorkOrder({
    workOrderId: input.workOrderId,
    tenantId: input.tenantId,
    leaseTtlSeconds: input.leaseTtlSeconds,
    now: input.now,
  });

  const slaClass = slaClassForWorkOrderType(activation.workOrder.type);
  const priority = priorityForSlaClass(slaClass);

  // An already-active order is not re-queued. Its job is either still in flight or already ran,
  // and adding a second would race the first for the same lease.
  if (!activation.changed) {
    return { ...activation, jobId: null, slaClass, priority };
  }

  const jobId = await enqueue(
    JobType.AGENT_EXECUTE_WORK_ORDER,
    {
      workOrderId: input.workOrderId,
      actorUserId: input.actorUserId,
      claimToken: activation.claimToken ?? undefined,
    },
    {
      tenantId: input.tenantId,
      priority,
      // Keyed on the work order, so a redelivered dispatch collapses onto one job rather than
      // queueing a second execution of the same order.
      dedupeKey: `agent-work-order:${input.tenantId}:${input.workOrderId}`,
    }
  );

  return { ...activation, jobId, slaClass, priority };
}
