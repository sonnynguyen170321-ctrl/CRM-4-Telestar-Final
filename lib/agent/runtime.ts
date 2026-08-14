import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authorizeCapability, type AuthorizationOutcome } from '@/lib/agent/authorization';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import type { SessionUser } from '@/lib/auth';
import { executeTool } from '@/lib/ai/tools';
import { resumeApprovedAction } from '@/lib/workorders/approvals';
import { RetryableResearchError } from '@/lib/research/error';

export interface ExecuteActionInput {
  actionKey: string;
  toolName: string;
  /** Parsed JSON. Structured values are legitimate — see `PlannedToolCall.args`. */
  args: Record<string, unknown>;
  sessionUser: SessionUser;
  leadId?: string;
  campaignId?: string;
  playbookVersionId?: string;
  workOrderId?: string;
  /**
   * The approval this action is running under, when a human has already decided it.
   *
   * Deliberately an **id, not a flag**. The runtime re-derives the decision from this request on
   * every attempt — a tightened policy, an expired approval, a rejection or a level that no longer
   * covers the action all still refuse here. Passing `approved: true` would turn an approval into
   * a bearer token for an action whose world has moved on, which is the one thing
   * `resumeApprovedAction` exists to prevent.
   */
  approvalRequestId?: string;
}

export interface ExecuteActionResult {
  status: 'completed' | 'refused' | 'failed';
  result?: string;
  error?: string;
}

/**
 * The AgentRuntime ensures all agent-driven CRM mutations are authorized by capability
 * and durable/idempotent via the AgentAction ledger.
 *
 * It does NOT perform object authorization (which is delegated to the domain services
 * called by the tools themselves).
 */
export async function executeAgentAction(input: ExecuteActionInput): Promise<ExecuteActionResult> {
  const capability = capabilityForTool(input.toolName);
  if (!capability) {
    return { status: 'failed', error: `Tool "${input.toolName}" is not registered for use.` };
  }

  // Tenancy is derived from the authenticated session and from nowhere else. There is no
  // caller-supplied tenant to fall back to, and a default would be worse than a refusal: it
  // would write a ledger row — and possibly a CRM mutation — under a tenant nobody proved.
  // Refuse before the lookup, so a session with no tenant cannot even read another's row.
  const tenantId = input.sessionUser.tenantId;
  if (!tenantId) {
    return {
      status: 'refused',
      error:
        'This action cannot run because the authenticated session has no tenant context. No changes were made.',
    };
  }
  const userId = input.sessionUser.id;
  const role = input.sessionUser.role;

  // Idempotency: Check if this action already ran/is running.
  const existingAction = await prisma.agentAction.findUnique({
    where: {
      tenantId_actionKey: { tenantId, actionKey: input.actionKey },
    },
  });

  if (existingAction) {
    if (existingAction.status === 'completed') {
      return { status: 'completed', result: existingAction.result ? String(existingAction.result) : 'Already completed' };
    }
    if (existingAction.status === 'refused') {
      return { status: 'refused', error: existingAction.error ? String(existingAction.error) : 'Previously refused' };
    }
    // If pending/running/failed, we will allow retry but we must track attempts
    // to not be permanently stranded.
  }

  const authorization = await authorizeCapability({ role, tenantId }, capability);

  // An action that needs approval may run when a human has already granted one — but only after
  // that approval is re-derived here, from the request, against current policy. This is the second
  // independent check, not a hand-off: `executeWorkOrder` resumed the same request to decide
  // whether to call at all, and neither side trusts the other's answer.
  let approvalCleared = false;
  if (authorization.outcome !== 'ALLOW' && authorization.outcome !== 'DENY' && input.approvalRequestId) {
    const resume = await resumeApprovedAction({
      requestId: input.approvalRequestId,
      tenantId,
      actor: { role, tenantId },
    });
    approvalCleared = resume.status === 'proceed';
  }

  const permitted = authorization.outcome === 'ALLOW' || approvalCleared;
  const status = permitted ? 'running' : 'refused';

  const action = await prisma.agentAction.upsert({
    where: {
      tenantId_actionKey: { tenantId, actionKey: input.actionKey },
    },
    create: {
      actionKey: input.actionKey,
      tenantId,
      userId,
      role,
      capability,
      tool: input.toolName,
      status,
      authorizationOutcome: authorization.outcome,
      playbookVersionId: input.playbookVersionId,
      workOrderId: input.workOrderId,
      leadId: input.leadId,
      campaignId: input.campaignId,
      attemptCount: 1,
      startedAt: new Date(),
    },
    update: {
      status,
      authorizationOutcome: authorization.outcome,
      playbookVersionId: input.playbookVersionId,
      workOrderId: input.workOrderId,
      leadId: input.leadId,
      campaignId: input.campaignId,
      attemptCount: { increment: 1 },
      startedAt: new Date(),
      error: Prisma.DbNull,
    },
  });

  if (!permitted) {
    const errorMsg = refusalMessage(authorization.outcome);
    await prisma.agentAction.update({
      where: { id: action.id },
      data: { status: 'refused', error: errorMsg, completedAt: new Date() },
    });
    return { status: 'refused', error: errorMsg };
  }

  try {
    const result = await executeTool(input.toolName, input.args, {
      userId,
      leadId: input.leadId,
      today: new Date().toISOString(),
      tenantId,
      role,
      sessionUser: input.sessionUser,
      workOrderId: input.workOrderId,
      agentActionId: action.id, // passing this down for AiCall linkage
      approvalRequestId: input.approvalRequestId,
    });

    await prisma.agentAction.update({
      where: { id: action.id },
      data: { status: 'completed', result, completedAt: new Date() },
    });

    return { status: 'completed', result };
  } catch (err) {
    const errorStr = err instanceof Error ? err.message : String(err);
    await prisma.agentAction.update({
      where: { id: action.id },
      data: { status: 'failed', error: errorStr, completedAt: new Date() },
    });

    if (err instanceof RetryableResearchError) {
      throw err; // Rethrow to reach the worker retry boundary
    }

    return { status: 'failed', error: errorStr };
  }
}

function refusalMessage(outcome: AuthorizationOutcome): string {
  switch (outcome) {
    case 'REQUIRE_USER_APPROVAL':
      return 'That action needs approval before it can run. Tell the SDR what you would do and ask them to approve it — do not describe it as done.';
    case 'REQUIRE_MANAGER_APPROVAL':
      return 'That action needs manager approval before it can run. Tell the SDR it has to go to their manager — do not describe it as done.';
    case 'DENY':
      return 'That action is reserved for a human and cannot be performed by the assistant. Say so plainly rather than implying it happened.';
    default:
      return 'That action could not be authorized. No changes were made.';
  }
}
