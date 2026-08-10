import { prisma } from '@/lib/prisma';
import type { WorkOrder } from '@prisma/client';
import {
  detectActivationConflicts,
  WorkOrderConflictError,
  type WorkOrderConflict,
} from './conflicts';
import { claimLease, releaseLeasesForWorkOrder } from './leases';
import {
  isWorkOrderType,
  isWorkOrderPausedReason,
  leaseModeForType,
  validateBudgets,
  withBudgetDefaults,
  type BudgetViolation,
  type WorkOrderBudgets,
  type WorkOrderPausedReason,
  type WorkOrderType,
} from './types';

/**
 * Work order lifecycle (Revenue AI Phase 6a).
 *
 * `draft → active → (paused ⇄ active) → completed | cancelled | failed`.
 *
 * This is the only module that writes `WorkOrder.status`, for the same reason
 * `lib/prospects/transitions.ts` is the only writer of `Lead.operatingState`: a status a route
 * can set directly is a status whose invariants are enforced nowhere.
 *
 * ## Why not a transaction
 *
 * The Neon HTTP driver has no interactive transactions and `lib/prisma.ts`'s `$extends`
 * wrappers defeat array batching — the constraint that already shaped `lib/admin/transferWork.ts`
 * and `lib/playbooks/versions.ts`. Activation is therefore ordered, idempotent and its
 * intermediate states are detectable rather than atomic:
 *
 *   1. refuse on conflict — nothing written
 *   2. resolve and pin the playbook version — idempotent, write-once
 *   3. claim the lease — a database constraint, so this is the real arbiter
 *   4. compare-and-set the status
 *
 * A crash between 3 and 4 leaves a lease held by a draft order. That is visible
 * (`findStaleLeases` sees it once the lease expires, and the lease expires) and re-running
 * `activateWorkOrder` converges it, because every step is a no-op when already done. The
 * reverse order would mark an order active that holds nothing, which reads as running work that
 * is not running.
 */

export class WorkOrderValidationError extends Error {
  readonly code = 'work_order_invalid';

  constructor(
    message: string,
    readonly violations: readonly BudgetViolation[] = []
  ) {
    super(message);
    this.name = 'WorkOrderValidationError';
  }
}

export class WorkOrderStateError extends Error {
  readonly code = 'work_order_state';

  constructor(
    message: string,
    readonly currentStatus: string
  ) {
    super(message);
    this.name = 'WorkOrderStateError';
  }
}

export class WorkOrderNotFoundError extends Error {
  readonly code = 'work_order_not_found';

  constructor(workOrderId: string) {
    super(`Work order ${workOrderId} not found`);
    this.name = 'WorkOrderNotFoundError';
  }
}

export interface CreateWorkOrderInput {
  tenantId: string;
  type: WorkOrderType | string;
  createdById: string;
  /**
   * Idempotency key for the request that asked for this order. Two deliveries of the same
   * request find the same row instead of creating a second order that the conflict check would
   * then refuse — a duplicate request must not look like a collision.
   */
  requestKey: string;
  leadId?: string | null;
  campaignId?: string | null;
  budgets?: Partial<WorkOrderBudgets>;
}

/**
 * Create a draft.
 *
 * Creation validates and refuses; it does not reserve anything. Conflicts are an *activation*
 * question — refusing to draft an order because the lead is busy would stop a manager queueing
 * work for later, which is a normal thing to want.
 */
export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  if (!input.tenantId) {
    throw new WorkOrderValidationError('A work order requires a tenant; none was supplied');
  }
  if (!isWorkOrderType(input.type)) {
    throw new WorkOrderValidationError(`"${input.type}" is not a work order type`);
  }

  const violations = validateBudgets(input.budgets ?? {});
  if (violations.length > 0) {
    throw new WorkOrderValidationError(
      `Budget out of bounds: ${violations
        .map((v) => `${v.field}=${v.value} (${v.reason}, allowed ${v.bound.min}–${v.bound.max})`)
        .join('; ')}`,
      violations
    );
  }

  const existing = await prisma.workOrder.findUnique({
    where: { tenantId_requestKey: { tenantId: input.tenantId, requestKey: input.requestKey } },
  });
  if (existing) return existing;

  const budgets = withBudgetDefaults(input.budgets ?? {});
  const scope = await resolveScope(input.tenantId, input.leadId ?? null, input.campaignId ?? null);

  return prisma.workOrder.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      status: 'draft',
      requestKey: input.requestKey,
      leadId: scope.leadId,
      campaignId: scope.campaignId,
      createdById: input.createdById,
      researchBudget: budgets.researchBudget,
      tokenBudget: budgets.tokenBudget,
      maxToolCalls: budgets.maxToolCalls,
      maxExecutionDuration: budgets.maxExecutionDuration,
    },
  });
}

export interface ActivateResult {
  workOrder: WorkOrder;
  /** False when the order was already active — activation is idempotent. */
  changed: boolean;
  /** The version pinned at activation, if the campaign has an active playbook. */
  playbookVersionId: string | null;
  leaseHeld: boolean;
  /**
   * The fencing token for the lease this call now holds, which the executing worker must carry
   * into `renewLease` and `releaseLease`.
   *
   * Null when no lease was taken — a shared-mode or campaign-scoped order — or when the lease
   * turned out to be held elsewhere. A caller with no token holds nothing and must not act as
   * though it does.
   */
  claimToken: string | null;
}

export interface ActivateWorkOrderInput {
  workOrderId: string;
  tenantId: string;
  leaseTtlSeconds?: number;
  now?: Date;
}

/**
 * Put a work order into execution.
 *
 * Refuses — naming every collision — rather than cancelling or superseding anything. Silently
 * replacing live work is how an SDR's in-flight sequence disappears with nothing recording who
 * ended it.
 */
export async function activateWorkOrder(input: ActivateWorkOrderInput): Promise<ActivateResult> {
  const now = input.now ?? new Date();
  const order = await requireWorkOrder(input.workOrderId, input.tenantId);

  if (order.status === 'active') {
    // Re-claim rather than just report. A worker that restarted and re-activated an order it was
    // already running needs a token to renew with, and minting a fresh one is what fences its own
    // stalled prior attempt. Nothing about the order's status changes — this is still idempotent.
    const reclaim = await claimLeaseFor(order, input.tenantId, input.leaseTtlSeconds, now);

    // Deliberately no throw here: the order is already active, and an idempotent re-activation
    // reporting "someone else holds the lead" is more useful than one that raises. The caller
    // holds no token and therefore may not execute.
    return {
      workOrder: order,
      changed: false,
      playbookVersionId: order.playbookVersionId,
      leaseHeld: reclaim.held,
      claimToken: reclaim.claimToken,
    };
  }
  if (order.status !== 'draft' && order.status !== 'paused') {
    throw new WorkOrderStateError(
      `Work order ${order.id} is ${order.status} and cannot be activated`,
      order.status
    );
  }

  const conflicts = await detectActivationConflicts({
    tenantId: input.tenantId,
    leadId: order.leadId,
    type: order.type as WorkOrderType,
    workOrderId: order.id,
    now,
  });
  if (conflicts.length > 0) throw new WorkOrderConflictError(conflicts);

  // Pinned once. A version activated between this order's activation and its execution does not
  // retroactively become the policy it ran under, so this is write-once rather than refreshed.
  const playbookVersionId =
    order.playbookVersionId ?? (await resolvePlaybookVersionId(input.tenantId, order));
  if (playbookVersionId && !order.playbookVersionId) {
    await prisma.workOrder.updateMany({
      where: { id: order.id, tenantId: input.tenantId, playbookVersionId: null },
      data: { playbookVersionId },
    });
  }

  let leaseHeld = false;
  let claimToken: string | null = null;
  if (order.leadId) {
    const claim = await claimLease({
      tenantId: input.tenantId,
      leadId: order.leadId,
      workOrderId: order.id,
      mode: leaseModeForType(order.type as WorkOrderType),
      ttlSeconds: input.leaseTtlSeconds,
      now,
    });

    if (claim.outcome === 'held_by_other') {
      // The constraint, not the check, is the arbiter — a claim lost here means another order
      // won the race after `detectActivationConflicts` looked. Reported as the same named
      // conflict so the caller cannot tell the two apart, because it should not have to.
      const conflict: WorkOrderConflict = {
        kind: 'active_lease',
        conflictingId: claim.lease?.id,
        detail: `lead is leased by work order ${claim.heldByWorkOrderId ?? 'unknown'}`,
      };
      throw new WorkOrderConflictError([conflict]);
    }
    leaseHeld = claim.outcome !== 'not_required';
    claimToken = claim.claimToken;
  }

  const activated = await prisma.workOrder.updateMany({
    where: { id: order.id, tenantId: input.tenantId, status: { in: ['draft', 'paused'] } },
    data: {
      status: 'active',
      pausedReason: null,
      pausedAt: null,
      // Set once: `maxExecutionDuration` is measured from the first activation, so a
      // pause/resume cycle must not hand the order a fresh clock.
      ...(order.activatedAt ? {} : { activatedAt: now }),
    },
  });

  return {
    workOrder: await requireWorkOrder(order.id, input.tenantId),
    changed: activated.count === 1,
    playbookVersionId: playbookVersionId ?? null,
    leaseHeld,
    claimToken,
  };
}

/** Claim on behalf of an order whose type decides the mode. Never throws on a lost race. */
async function claimLeaseFor(
  order: Pick<WorkOrder, 'id' | 'leadId' | 'type'>,
  tenantId: string,
  ttlSeconds: number | undefined,
  now: Date
): Promise<{ held: boolean; claimToken: string | null }> {
  if (!order.leadId) return { held: false, claimToken: null };

  const claim = await claimLease({
    tenantId,
    leadId: order.leadId,
    workOrderId: order.id,
    mode: leaseModeForType(order.type as WorkOrderType),
    ttlSeconds,
    now,
  });

  return {
    held: claim.outcome !== 'not_required' && claim.outcome !== 'held_by_other',
    claimToken: claim.claimToken,
  };
}

export interface PauseWorkOrderInput {
  workOrderId: string;
  tenantId: string;
  reason: WorkOrderPausedReason | string;
  /** Pausing for approval keeps the lease; pausing on exhaustion or manually gives it back. */
  keepLease?: boolean;
  now?: Date;
}

/**
 * Pause, durably, with a reason.
 *
 * `budget_exhausted` is a pause and not a failure — Phase 6b reports partial completion through
 * it. A run that stopped because its budget did what budgets do has not gone wrong, and marking
 * it `failed` would put real failures and correct stops in one bucket.
 */
export async function pauseWorkOrder(input: PauseWorkOrderInput): Promise<WorkOrder> {
  if (!isWorkOrderPausedReason(input.reason)) {
    throw new WorkOrderValidationError(`"${input.reason}" is not a pause reason`);
  }
  const now = input.now ?? new Date();
  const order = await requireWorkOrder(input.workOrderId, input.tenantId);

  if (order.status === 'paused') return order;
  if (order.status !== 'active') {
    throw new WorkOrderStateError(
      `Work order ${order.id} is ${order.status} and cannot be paused`,
      order.status
    );
  }

  await prisma.workOrder.updateMany({
    where: { id: order.id, tenantId: input.tenantId, status: 'active' },
    data: { status: 'paused', pausedReason: input.reason, pausedAt: now },
  });

  // An order paused awaiting approval keeps its lease: it is still the order working this lead,
  // and letting another take over while a human decides is how an approval gets granted for
  // work that has already been superseded.
  if (!input.keepLease) await releaseLeasesForWorkOrder(input.tenantId, order.id, now);

  return requireWorkOrder(order.id, input.tenantId);
}

export type TerminalStatus = 'completed' | 'cancelled' | 'failed';

export interface FinishWorkOrderInput {
  workOrderId: string;
  tenantId: string;
  status: TerminalStatus;
  now?: Date;
}

/** End an order and give the lead back. Idempotent on a repeat of the same terminal status. */
export async function finishWorkOrder(input: FinishWorkOrderInput): Promise<WorkOrder> {
  const now = input.now ?? new Date();
  const order = await requireWorkOrder(input.workOrderId, input.tenantId);

  if (order.status === input.status) return order;
  if (order.status === 'completed' || order.status === 'cancelled' || order.status === 'failed') {
    throw new WorkOrderStateError(
      `Work order ${order.id} is already ${order.status} and cannot become ${input.status}`,
      order.status
    );
  }

  await prisma.workOrder.updateMany({
    where: { id: order.id, tenantId: input.tenantId, status: { in: ['draft', 'active', 'paused'] } },
    data: { status: input.status, completedAt: now, pausedReason: null },
  });

  await releaseLeasesForWorkOrder(input.tenantId, order.id, now);

  return requireWorkOrder(order.id, input.tenantId);
}

/**
 * Load an order and prove it belongs to this tenant.
 *
 * The Prisma extension scopes queries already; this is the domain boundary saying so out loud,
 * matching `requirePlaybook`. Defence in depth is the point — a caller must not reach another
 * tenant's order by knowing an id, whatever the extension is doing that day.
 */
export async function requireWorkOrder(
  workOrderId: string,
  tenantId: string
): Promise<WorkOrder> {
  const order = await prisma.workOrder.findUnique({ where: { id: workOrderId } });
  if (!order || order.tenantId !== tenantId) throw new WorkOrderNotFoundError(workOrderId);
  return order;
}

/**
 * Which playbook version governs this order.
 *
 * A lead-scoped order inherits its campaign from the lead, so provenance works without the
 * caller naming a campaign it can already derive.
 */
async function resolvePlaybookVersionId(
  tenantId: string,
  order: Pick<WorkOrder, 'campaignId' | 'leadId'>
): Promise<string | null> {
  let campaignId = order.campaignId;

  if (!campaignId && order.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: order.leadId },
      select: { campaignId: true, tenantId: true },
    });
    if (lead && lead.tenantId === tenantId) campaignId = lead.campaignId;
  }
  if (!campaignId) return null;

  const playbook = await prisma.campaignPlaybook.findUnique({
    where: { campaignId },
    select: { tenantId: true, currentVersionId: true },
  });
  if (!playbook || playbook.tenantId !== tenantId) return null;

  return playbook.currentVersionId;
}

/** Verify the lead and campaign belong to this tenant, and fill the campaign in from the lead. */
async function resolveScope(
  tenantId: string,
  leadId: string | null,
  campaignId: string | null
): Promise<{ leadId: string | null; campaignId: string | null }> {
  let resolvedCampaignId = campaignId;

  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { tenantId: true, campaignId: true },
    });
    if (!lead || lead.tenantId !== tenantId) {
      throw new WorkOrderValidationError(`Lead ${leadId} is not in this tenant`);
    }
    resolvedCampaignId = resolvedCampaignId ?? lead.campaignId;
  }

  if (resolvedCampaignId) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: resolvedCampaignId },
      select: { tenantId: true },
    });
    if (!campaign || campaign.tenantId !== tenantId) {
      throw new WorkOrderValidationError(`Campaign ${resolvedCampaignId} is not in this tenant`);
    }
  }

  return { leadId, campaignId: resolvedCampaignId };
}
