import { prisma } from '@/lib/prisma';
import { executeAgentAction } from '@/lib/agent/runtime';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import type { SessionUser } from '@/lib/auth';
import { budgetSnapshot, describeExhaustion, recordConsumption, reconcileConsumption } from './budgets';
import { levelForOutcome, requestApproval } from './approvals';
import { authorizeWorkOrderCapability, workOrderRefusalMessage } from './authorization';
import { finishWorkOrder, pauseWorkOrder, requireWorkOrder } from './service';
import type { WorkOrderType } from './types';

/**
 * Work order execution (Revenue AI Phase 6b).
 *
 * The spine is Phase 5's, unchanged:
 *
 * ```text
 * work order worker  →  executeAgentAction  →  AgentAction ledger
 *                    →  capability authorization  →  typed tool  →  CRM domain service
 * ```
 *
 * There is **no second CRM path**. This module holds no Prisma client for CRM entities beyond
 * reading the work order it is executing and writing its own status; every mutation reaches the
 * database through `executeAgentAction`, which is what enforces the ledger, the idempotency and
 * the capability check. A test asserts this file imports no domain service directly.
 *
 * ## What this module does not decide
 *
 * **It does not plan.** The steps are handed in. Deciding *which* tools a work order should run
 * — researching an account, drafting a sequence, prioritising a list — is Phase 7's knowledge
 * retrieval and Phase 8's prospecting loop, and inventing a planner here to have something to
 * execute would be the speculative generality this initiative keeps refusing. What Phase 6b owes
 * is the machinery that runs a plan safely: budgets, authorization, approvals, provenance,
 * idempotency and partial completion. That machinery is complete and tested; the planner plugs
 * into `steps`.
 *
 * ## Ordering inside the loop
 *
 * Per step, and the order matters:
 *
 *   1. is the work order still executable — a cancelled order stops mid-plan
 *   2. is there budget left — checked *before* the operation, never after
 *   3. does the tool map to a capability — an unregistered tool fails closed
 *   4. does the work order type permit that capability, and does policy allow it now
 *   5. if approval is required: record the request, pause, and **do not execute**
 *   6. execute through the runtime
 *   7. debit the counters, from the ledgers
 */

export interface PlannedToolCall {
  toolName: string;
  args: Record<string, string>;
}

export type ExecutionStatus = 'completed' | 'paused' | 'refused';

export interface StepOutcome {
  ordinal: number;
  toolName: string;
  status: 'completed' | 'refused' | 'failed' | 'awaiting_approval' | 'not_attempted';
  detail?: string;
}

export interface ExecuteWorkOrderResult {
  status: ExecutionStatus;
  /** Set when `paused` — `budget_exhausted` or `awaiting_approval`. */
  pausedReason?: string;
  /** Steps that actually ran to completion. The "partial" in partial completion. */
  completedSteps: number;
  totalSteps: number;
  /** Requests raised this run. One per approval-requiring step. */
  approvalRequestIds: string[];
  steps: StepOutcome[];
}

export interface ExecuteWorkOrderInput {
  workOrderId: string;
  tenantId: string;
  actorUserId: string;
  /** The plan. Phase 7/8 produces these; Phase 6b runs them. */
  steps: PlannedToolCall[];
  now?: Date;
}

/**
 * The action's stable identity.
 *
 * Derived from the work order and the step's position, never from the clock or a random value,
 * so a retried job produces the same key — `executeAgentAction` then finds the completed
 * `AgentAction` and returns its recorded result instead of acting a second time. This is what
 * makes "a duplicate enqueue cannot duplicate a CRM mutation" true, and it is the reason the
 * BullMQ job carries three retries without that being dangerous.
 */
export function workOrderActionKey(
  workOrderId: string,
  ordinal: number,
  toolName: string
): string {
  return `workorder:${workOrderId}:step:${ordinal}:${toolName}`;
}

export async function executeWorkOrder(
  input: ExecuteWorkOrderInput
): Promise<ExecuteWorkOrderResult> {
  const now = input.now ?? new Date();
  const actor = await loadActor(input.actorUserId, input.tenantId);

  const steps: StepOutcome[] = [];
  const approvalRequestIds: string[] = [];
  let completedSteps = 0;

  const finish = (
    status: ExecutionStatus,
    pausedReason?: string
  ): ExecuteWorkOrderResult => ({
    status,
    pausedReason,
    completedSteps,
    totalSteps: input.steps.length,
    approvalRequestIds,
    steps,
  });

  for (const [index, step] of input.steps.entries()) {
    const ordinal = index + 1;

    // Re-read every iteration. The counters move as we spend, and an order cancelled by a human
    // mid-plan must stop at the next step rather than running the plan out.
    const order = await requireWorkOrder(input.workOrderId, input.tenantId);
    if (order.status !== 'active') {
      steps.push({
        ordinal,
        toolName: step.toolName,
        status: 'not_attempted',
        detail: `work order is ${order.status}`,
      });
      return finish('paused', order.pausedReason ?? undefined);
    }

    const snapshot = budgetSnapshot(order, now);
    if (snapshot.exhausted.length > 0) {
      // A pause, not a failure. The budget did what budgets do, and the run reports how far it
      // got rather than being recorded as a completion or an error.
      steps.push({
        ordinal,
        toolName: step.toolName,
        status: 'not_attempted',
        detail: `budget exhausted: ${describeExhaustion(snapshot)}`,
      });
      await pauseWorkOrder({
        workOrderId: input.workOrderId,
        tenantId: input.tenantId,
        reason: 'budget_exhausted',
        now,
      });
      return finish('paused', 'budget_exhausted');
    }

    const capability = capabilityForTool(step.toolName);
    if (!capability) {
      // Fail closed. An unregistered tool is refused rather than run, the same rule the runtime
      // applies — repeated here so the loop stops instead of handing the runtime work it will
      // reject anyway.
      steps.push({
        ordinal,
        toolName: step.toolName,
        status: 'refused',
        detail: `tool "${step.toolName}" is not registered`,
      });
      return finish('refused');
    }

    const decision = await authorizeWorkOrderCapability(
      order.type as WorkOrderType,
      { role: actor.role, tenantId: input.tenantId },
      capability
    );

    if (decision.outcome === 'DENY') {
      steps.push({
        ordinal,
        toolName: step.toolName,
        status: 'refused',
        detail: workOrderRefusalMessage(decision),
      });
      return finish('refused');
    }

    const level = levelForOutcome(decision.outcome);
    if (level) {
      const actionKey = workOrderActionKey(input.workOrderId, ordinal, step.toolName);
      const { request } = await requestApproval({
        tenantId: input.tenantId,
        actionKey,
        workOrderId: input.workOrderId,
        capability,
        toolName: step.toolName,
        args: step.args,
        requiredLevel: level,
        requestedById: actor.id,
        leadId: order.leadId,
        campaignId: order.campaignId,
        playbookVersionId: order.playbookVersionId,
        now,
      });
      approvalRequestIds.push(request.id);
      steps.push({
        ordinal,
        toolName: step.toolName,
        status: 'awaiting_approval',
        detail: `approval request ${request.id} (${level} level)`,
      });

      // The lease is kept: this order is still the one working this lead, and letting another
      // take over while a human decides is how an approval gets granted for work that has since
      // been superseded.
      await pauseWorkOrder({
        workOrderId: input.workOrderId,
        tenantId: input.tenantId,
        reason: 'awaiting_approval',
        keepLease: true,
        now,
      });
      return finish('paused', 'awaiting_approval');
    }

    const result = await executeAgentAction({
      actionKey: workOrderActionKey(input.workOrderId, ordinal, step.toolName),
      toolName: step.toolName,
      args: step.args,
      sessionUser: actor,
      leadId: order.leadId ?? undefined,
      campaignId: order.campaignId ?? undefined,
      // Provenance flows into the ledger and every AiCall the tool makes. The version is the one
      // pinned at activation, not whatever is active now.
      playbookVersionId: order.playbookVersionId ?? undefined,
      workOrderId: input.workOrderId,
    });

    // Debited whatever happened. A failed tool call still consumed an invocation, and counting
    // only successes would let a retry loop run unbounded inside its budget.
    await recordConsumption(input.tenantId, input.workOrderId, { toolCalls: 1 });
    // Tokens and research credits are only knowable after the fact, from the AiCall rows the
    // provider wrote during the call. The pre-flight check reads the cheap counters; this is
    // what keeps them true.
    await reconcileConsumption(input.tenantId, input.workOrderId);

    if (result.status === 'completed') {
      completedSteps += 1;
      steps.push({ ordinal, toolName: step.toolName, status: 'completed' });
      continue;
    }

    steps.push({
      ordinal,
      toolName: step.toolName,
      status: result.status === 'refused' ? 'refused' : 'failed',
      detail: result.error,
    });
    return finish('refused');
  }

  await finishWorkOrder({
    workOrderId: input.workOrderId,
    tenantId: input.tenantId,
    status: 'completed',
    now,
  });

  return finish('completed');
}

/**
 * Build the session the agent acts under.
 *
 * Read from the database rather than reconstructed from the job payload: a payload-supplied role
 * would let whoever enqueued the job choose its authority, and the job may sit in the queue long
 * enough for a role change or a deactivation to matter.
 */
async function loadActor(userId: string, tenantId: string): Promise<SessionUser> {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      tenantId: true,
      isActive: true,
    },
  });

  if (!user) throw new Error(`Actor ${userId} is not a user in tenant ${tenantId}`);
  if (!user.isActive) throw new Error(`Actor ${userId} is deactivated and cannot act`);

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    tenantId: user.tenantId,
  };
}
