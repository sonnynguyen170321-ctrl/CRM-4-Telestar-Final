import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { priorityForSlaClass, slaClassForWorkOrderType, type AgentSlaClass } from '@/lib/agent/priorities';
import { prisma } from '@/lib/prisma';
import { canAccessLead, canReferenceCampaign } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { activateWorkOrder, type ActivateResult } from './service';

/** The actor may not act on the object this order targets. */
export class WorkOrderAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkOrderAccessError';
  }
}

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
/**
 * The actor must be allowed to act on what the order targets, checked before activation.
 *
 * `lib/workorders/authorization.ts` documents object authorization as the domain services' job
 * *at execution*, and that remains true for what the agent then does. It leaves a gap this
 * closes: dispatch is not a read. It activates the order, can claim a lease, pins a playbook
 * version and queues a job — and measurement showed an SDR dispatching a work order targeting a
 * peer's lead at **HTTP 200 with a job queued**. "Execution will refuse eventually" is not an
 * answer when the unauthorized caller has already committed a state transition and spent queue
 * capacity; research is charged per provider attempt, so the refusal can arrive after the money.
 *
 * Reuses `canAccessLead` and `canReferenceCampaign` rather than adding a work-order permission
 * model. The lead axis is the specific one: an order naming a lead is authorized by that lead,
 * and only an order with no lead falls back to its campaign.
 */
async function assertActorMayDispatch(
  workOrderId: string,
  tenantId: string,
  actorUserId: string
): Promise<void> {
  const order = await prisma.workOrder.findFirst({
    where: { id: workOrderId, tenantId },
    select: { leadId: true, campaignId: true },
  });
  // A missing order is `activateWorkOrder`'s error to raise, with its own not-found semantics.
  if (!order) return;
  if (!order.leadId && !order.campaignId) return; // tenant-wide order; nothing object-scoped to check

  const actorRow = await prisma.user.findFirst({
    where: { id: actorUserId, tenantId },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, tenantId: true, isActive: true },
  });
  // Read fresh, never from a session snapshot: a deactivated actor must not be able to dispatch
  // on the strength of a token minted while they were still active.
  if (!actorRow || !actorRow.isActive) {
    throw new WorkOrderAccessError('The actor is not an active user in this tenant');
  }
  const actor = actorRow as unknown as SessionUser;

  if (order.leadId) {
    const lead = await prisma.lead.findFirst({
      where: { id: order.leadId, tenantId },
      select: { assignedToId: true, campaignId: true },
    });
    if (!lead || !(await canAccessLead(actor, lead))) {
      throw new WorkOrderAccessError('The actor cannot act on the lead this work order targets');
    }
    return;
  }

  if ((await canReferenceCampaign(actor, order.campaignId!)) !== 'ok') {
    throw new WorkOrderAccessError('The actor cannot act on the campaign this work order targets');
  }
}

export async function dispatchWorkOrder(input: DispatchInput): Promise<DispatchResult> {
  await assertActorMayDispatch(input.workOrderId, input.tenantId, input.actorUserId);

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
