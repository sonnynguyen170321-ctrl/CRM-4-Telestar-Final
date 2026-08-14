import { prisma } from '@/lib/prisma';
import type { AgentApprovalRequest } from '@prisma/client';
import { canApproveAsManager, type AuthorizationOutcome } from '@/lib/agent/authorization';
import type { AgentCapability } from '@/lib/agent/capabilities';
import type { SessionUser } from '@/lib/auth';
import { parseApprovedCopy, type ApprovedStepCopy } from '@/lib/sequences/stepCopy';
import {
  authorizeWorkOrderCapability,
  type WorkOrderCapabilityDecision,
} from './authorization';
import { OCCUPYING_STATUSES, type WorkOrderStatus, type WorkOrderType } from './types';

/**
 * Durable approval requests (Revenue AI Phase 6b).
 *
 * Phase 2 gave `REQUIRE_USER_APPROVAL` and `REQUIRE_MANAGER_APPROVAL` a stable vocabulary and
 * then stopped, because no queue existed to route them to. This is that queue. Note what did
 * **not** change to accommodate it: `lib/agent/authorization.ts` is untouched. The rules did not
 * learn about approvals; approvals learned to live under the rules.
 *
 * ## Approval is a recorded decision, not a stored permission
 *
 * This is the whole design, and it is easy to get backwards. A row here says *a human said yes
 * at 14:03*. It does not say *this action may run*. Resuming therefore re-derives authorization
 * from scratch against current truth rather than reading a flag:
 *
 * ```text
 * request approved   →   re-run work order bound
 *                    →   re-run role authorization
 *                    →   re-run autonomy policy (current stored value)
 *                    →   re-check the work order is still executable
 *                    →   check the approval level still covers what is now required
 *                    →   object authorization, inside the domain service, as always
 * ```
 *
 * Between approval and resume a lead can be reassigned, a policy tightened, a playbook
 * superseded, a work order cancelled, or a prospect handed to a human. Every one of those must
 * still be able to refuse an approved action. "Approved twenty minutes ago" is not evidence
 * about now.
 *
 * The level check is the subtle one: if the tenant tightened `sequence_enroll` from `approval`
 * to `manager_approval` after an SDR approved it, that SDR's approval no longer covers the
 * action. It is refused and a fresh manager-level request is raised, rather than executing on
 * a signature that would not be accepted today.
 */

export type ApprovalLevel = 'user' | 'manager';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

/**
 * How long a request stays actionable.
 *
 * Bounded on purpose. An approval nobody acted on must not sit pending indefinitely and then
 * execute against a world that moved on — the failure where an SDR approves an outreach launch,
 * forgets, and it fires three months later at a prospect who has since become a customer.
 */
export const APPROVAL_TTL_HOURS = 72;

/** A manager-level approval also satisfies a user-level requirement. Not the reverse. */
const LEVEL_RANK: Record<ApprovalLevel, number> = { user: 0, manager: 1 };

export function levelForOutcome(outcome: AuthorizationOutcome): ApprovalLevel | null {
  if (outcome === 'REQUIRE_USER_APPROVAL') return 'user';
  if (outcome === 'REQUIRE_MANAGER_APPROVAL') return 'manager';
  return null;
}

export function levelSatisfies(granted: ApprovalLevel, required: ApprovalLevel): boolean {
  return LEVEL_RANK[granted] >= LEVEL_RANK[required];
}

export interface RequestApprovalInput {
  tenantId: string;
  /** Same identity `AgentAction.actionKey` uses — this is what makes "exactly one" a constraint. */
  actionKey: string;
  workOrderId: string | null;
  agentActionId?: string | null;
  capability: AgentCapability;
  toolName: string;
  args: Record<string, unknown>;
  requiredLevel: ApprovalLevel;
  requestedById: string;
  leadId?: string | null;
  campaignId?: string | null;
  playbookVersionId?: string | null;
  now?: Date;
}

/**
 * Raise a request, or return the one already raised for this action.
 *
 * Idempotent through `@@unique([tenantId, actionKey])` rather than through a check — a retried
 * job must not ask a second human the same question, and a check-then-insert would let two
 * concurrent attempts both pass the check.
 */
export async function requestApproval(
  input: RequestApprovalInput
): Promise<{ request: AgentApprovalRequest; created: boolean }> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + APPROVAL_TTL_HOURS * 3_600_000);

  const existing = await prisma.agentApprovalRequest.findUnique({
    where: { tenantId_actionKey: { tenantId: input.tenantId, actionKey: input.actionKey } },
  });
  if (existing) return { request: existing, created: false };

  try {
    const request = await prisma.agentApprovalRequest.create({
      data: {
        tenantId: input.tenantId,
        actionKey: input.actionKey,
        workOrderId: input.workOrderId,
        agentActionId: input.agentActionId ?? null,
        capability: input.capability,
        toolName: input.toolName,
        args: input.args as object,
        leadId: input.leadId ?? null,
        campaignId: input.campaignId ?? null,
        playbookVersionId: input.playbookVersionId ?? null,
        requiredLevel: input.requiredLevel,
        status: 'pending',
        requestedById: input.requestedById,
        createdAt: now,
        expiresAt,
      },
    });
    return { request, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Lost a concurrent race. The winner's row is the answer.
    const winner = await prisma.agentApprovalRequest.findUnique({
      where: { tenantId_actionKey: { tenantId: input.tenantId, actionKey: input.actionKey } },
    });
    if (!winner) throw err;
    return { request: winner, created: false };
  }
}

export class ApprovalError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'not_found'
      | 'not_pending'
      | 'expired'
      | 'approver_not_permitted'
      | 'edit_not_supported'
  ) {
    super(message);
    this.name = 'ApprovalError';
  }
}

export interface DecideApprovalInput {
  requestId: string;
  tenantId: string;
  approver: Pick<SessionUser, 'id' | 'role'>;
  reason?: string;
  now?: Date;
}

export interface ApproveRequestInput extends DecideApprovalInput {
  /**
   * The approver's own wording, replacing the drafted copy this request carries.
   *
   * Unvalidated on the way in — `parseApprovedCopy` is what turns it into steps, and it throws
   * rather than dropping malformed entries, because a silently discarded step would send the
   * shared template to a prospect a human believed they had personalized for.
   */
  editedCopy?: unknown;
}

/**
 * The one argument an approver may rewrite.
 *
 * Editing is deliberately not a general "change the args" facility. A human reviewing an outreach
 * launch is judging *the words a prospect will read*; letting the same form alter `leadId` or
 * `sequenceId` would turn an approval into a way to redirect the action at something nobody
 * planned, and the planner's own gates (`Lead.sequenceId`, `assessLaunchEligibility`) would never
 * see the substitution.
 */
const EDITABLE_ARG = 'approvedCopy';

/**
 * Approve a pending request.
 *
 * A `manager` request needs an approver who is actually a manager — `canApproveAsManager`, the
 * same predicate the rest of the agent layer uses. Deliberately **no self-approval ban**: the
 * "requester" here is the agent acting on an SDR's behalf, and Telestar runs single-manager
 * pods where forbidding it would make manager-level capabilities unusable rather than safer.
 *
 * ## An edit made while approving is what sends
 *
 * `editedCopy` rewrites the request's `approvedCopy` argument **in the same statement that stamps
 * the decision**. That is the whole reason it lives here rather than in a separate "revise" call:
 * execution replays `AgentApprovalRequest.args`, so args and decision must move together or a
 * retry between the two would execute words nobody approved. Two writes could also land either
 * side of a concurrent approval; one compare-and-set cannot.
 *
 * The AI's original draft is untouched — it stays in `SequenceDraftRecord`, so the edit is legible
 * afterwards as the difference between what a model proposed and what a human signed.
 */
export async function approveRequest(input: ApproveRequestInput): Promise<AgentApprovalRequest> {
  const now = input.now ?? new Date();
  const request = await requirePendingRequest(input.requestId, input.tenantId, now);

  if (request.requiredLevel === 'manager' && !canApproveAsManager(input.approver)) {
    throw new ApprovalError(
      `Role "${input.approver.role}" may not grant a manager-level approval`,
      'approver_not_permitted'
    );
  }

  const args = (request.args ?? {}) as Record<string, unknown>;
  const editedArgs =
    input.editedCopy === undefined ? null : { ...args, [EDITABLE_ARG]: applyCopyEdit(args, input.editedCopy) };

  // Compare-and-set on status: two approvers clicking at once cannot both stamp a decision.
  const claimed = await prisma.agentApprovalRequest.updateMany({
    where: { id: request.id, tenantId: input.tenantId, status: 'pending' },
    data: {
      status: 'approved',
      approvedById: input.approver.id,
      decisionReason: input.reason ?? null,
      resolvedAt: now,
      ...(editedArgs ? { args: editedArgs as object } : {}),
    },
  });
  if (claimed.count !== 1) {
    throw new ApprovalError('Request was decided before this approval landed', 'not_pending');
  }

  return requireRequest(request.id, input.tenantId);
}

/**
 * Validate the approver's wording against the copy the request already carries.
 *
 * Two rules, both about not letting an edit become something other than an edit:
 *
 * - **A request with no `approvedCopy` cannot acquire one.** Personalization is opt-in per
 *   deployment, and `launchAIOutreach` refuses copy when it is off. Injecting copy into a launch
 *   the planner deliberately left plain would turn an approval into a refusal at execution time,
 *   long after the human was told it was approved.
 * - **`aiGenerated` is derived, never taken from the caller.** A step whose subject and body are
 *   byte-identical to the draft keeps the draft's provenance; a step whose wording changed is the
 *   approver's, so it records `false`. Trusting the client here would let a human edit be filed
 *   as model output, or the reverse.
 */
function applyCopyEdit(args: Record<string, unknown>, editedCopy: unknown): ApprovedStepCopy[] {
  const original = args[EDITABLE_ARG];
  if (!Array.isArray(original) || original.length === 0) {
    throw new ApprovalError(
      'This request carries no per-prospect copy, so there is nothing to edit.',
      'edit_not_supported'
    );
  }

  const drafted = new Map(
    parseApprovedCopy(original).map((step) => [step.stepOrder, step] as const)
  );

  return parseApprovedCopy(editedCopy).map((step) => {
    const before = drafted.get(step.stepOrder);
    const unchanged =
      !!before && before.body === step.body && (before.subject ?? null) === (step.subject ?? null);

    return {
      ...step,
      // Citations belong to the evidence the draft actually used. An approver rewriting a
      // sentence does not get to restate which evidence backs it.
      citedEvidenceIds: before?.citedEvidenceIds ?? [],
      aiGenerated: unchanged ? (before?.aiGenerated ?? false) : false,
    };
  });
}

/** Reject a pending request. A rejected request never executes and is never revived. */
export async function rejectRequest(input: DecideApprovalInput): Promise<AgentApprovalRequest> {
  const now = input.now ?? new Date();
  const request = await requirePendingRequest(input.requestId, input.tenantId, now);

  const claimed = await prisma.agentApprovalRequest.updateMany({
    where: { id: request.id, tenantId: input.tenantId, status: 'pending' },
    data: {
      status: 'rejected',
      approvedById: input.approver.id,
      decisionReason: input.reason ?? null,
      resolvedAt: now,
    },
  });
  if (claimed.count !== 1) {
    throw new ApprovalError('Request was decided before this rejection landed', 'not_pending');
  }

  return requireRequest(request.id, input.tenantId);
}

/** Sweep pending requests past their expiry. Returns how many were closed. */
export async function expireStaleRequests(tenantId: string, now: Date = new Date()): Promise<number> {
  const expired = await prisma.agentApprovalRequest.updateMany({
    where: { tenantId, status: 'pending', expiresAt: { lte: now } },
    data: { status: 'expired', resolvedAt: now },
  });
  return expired.count;
}

export type ApprovalRefusalReason =
  | 'not_found'
  | 'still_pending'
  | 'rejected'
  | 'expired'
  | 'work_order_not_executable'
  | 'authorization_changed'
  | 'insufficient_approval_level';

export type ApprovalResumeResult =
  | { status: 'proceed'; decision: WorkOrderCapabilityDecision }
  | { status: 'refused'; reason: ApprovalRefusalReason; detail: string };

export interface ResumeInput {
  requestId: string;
  tenantId: string;
  /** Whose authority the action would run under — re-checked, not trusted from the request. */
  actor: Pick<SessionUser, 'role' | 'tenantId'>;
  now?: Date;
}

/**
 * Decide whether an approved request may execute **now**.
 *
 * Everything here is re-derived. Nothing is read from the request except which action it was
 * about — the request is the question, not the answer.
 */
export async function resumeApprovedAction(input: ResumeInput): Promise<ApprovalResumeResult> {
  const now = input.now ?? new Date();

  const request = await prisma.agentApprovalRequest.findFirst({
    where: { id: input.requestId, tenantId: input.tenantId },
  });
  if (!request) {
    return { status: 'refused', reason: 'not_found', detail: 'approval request does not exist' };
  }

  if (request.status === 'pending') {
    // Expiry is evaluated on read as well as by the sweep, so a resume between the deadline and
    // the next sweep cannot slip through on a stale `pending`.
    if (request.expiresAt <= now) {
      return {
        status: 'refused',
        reason: 'expired',
        detail: `request expired at ${request.expiresAt.toISOString()}`,
      };
    }
    return { status: 'refused', reason: 'still_pending', detail: 'nobody has decided this yet' };
  }
  if (request.status === 'rejected') {
    return {
      status: 'refused',
      reason: 'rejected',
      detail: request.decisionReason ?? 'a human rejected this action',
    };
  }
  if (request.status === 'expired') {
    return { status: 'refused', reason: 'expired', detail: 'request expired before it was acted on' };
  }

  // An approval whose deadline passed before anyone resumed it is dead too. Approval does not
  // stop the clock.
  if (request.expiresAt <= now) {
    return {
      status: 'refused',
      reason: 'expired',
      detail: `approval expired at ${request.expiresAt.toISOString()}`,
    };
  }

  // The work order must still be one that may execute. Cancelled, completed and failed orders
  // do not resume, and a draft has not been activated.
  let workOrderType: WorkOrderType | null = null;
  if (request.workOrderId) {
    const order = await prisma.workOrder.findFirst({
      where: { id: request.workOrderId, tenantId: input.tenantId },
      select: { status: true, type: true },
    });
    if (!order) {
      return {
        status: 'refused',
        reason: 'work_order_not_executable',
        detail: 'the work order no longer exists',
      };
    }
    if (!(OCCUPYING_STATUSES as readonly string[]).includes(order.status as WorkOrderStatus)) {
      return {
        status: 'refused',
        reason: 'work_order_not_executable',
        detail: `work order is ${order.status}`,
      };
    }
    workOrderType = order.type as WorkOrderType;
  }

  if (!workOrderType) {
    return {
      status: 'refused',
      reason: 'work_order_not_executable',
      detail: 'approval carries no work order to execute under',
    };
  }

  // Re-derive authorization from current policy. Not a re-read of what it was when the human
  // clicked — a tightened policy, a changed role requirement or a capability removed from the
  // work order type must all still be able to refuse.
  const decision = await authorizeWorkOrderCapability(
    workOrderType,
    input.actor,
    request.capability as AgentCapability
  );

  if (decision.outcome === 'DENY') {
    return {
      status: 'refused',
      reason: 'authorization_changed',
      detail: `authorization now denies this action (${decision.reason})`,
    };
  }

  if (decision.outcome === 'ALLOW') {
    return { status: 'proceed', decision };
  }

  // Still requires approval — which is expected, since that is why we are here. The approval
  // counts only if the level a human granted still covers what is required now.
  const requiredNow = levelForOutcome(decision.outcome);
  const granted = request.requiredLevel as ApprovalLevel;

  if (requiredNow && !levelSatisfies(granted, requiredNow)) {
    return {
      status: 'refused',
      reason: 'insufficient_approval_level',
      detail: `approval was granted at "${granted}" level but this action now requires "${requiredNow}"`,
    };
  }

  return { status: 'proceed', decision };
}

async function requireRequest(id: string, tenantId: string): Promise<AgentApprovalRequest> {
  const request = await prisma.agentApprovalRequest.findFirst({ where: { id, tenantId } });
  if (!request) throw new ApprovalError(`Approval request ${id} not found`, 'not_found');
  return request;
}

async function requirePendingRequest(
  id: string,
  tenantId: string,
  now: Date
): Promise<AgentApprovalRequest> {
  const request = await requireRequest(id, tenantId);
  if (request.status !== 'pending') {
    throw new ApprovalError(`Request is already ${request.status}`, 'not_pending');
  }
  if (request.expiresAt <= now) {
    throw new ApprovalError('Request has expired and cannot be decided', 'expired');
  }
  return request;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}
