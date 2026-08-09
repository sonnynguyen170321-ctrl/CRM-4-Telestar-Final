import { prisma } from '@/lib/prisma';
import { authorizeCapability, type AuthorizationOutcome } from '@/lib/agent/authorization';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import type { AgentCapability } from '@/lib/agent/capabilities';
import type { SessionUser } from '@/lib/auth';
import { executeTool } from '@/lib/ai/tools';

export interface ExecuteActionInput {
  actionKey: string;
  toolName: string;
  args: Record<string, string>;
  sessionUser: SessionUser;
  leadId?: string;
  campaignId?: string;
  playbookVersionId?: string;
  workOrderId?: string;
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

  // Idempotency: Check if this action already ran/is running.
  const existingAction = await prisma.agentAction.findUnique({
    where: {
      tenantId_actionKey: { tenantId: input.sessionUser.tenantId, actionKey: input.actionKey },
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

  const authorization = await authorizeCapability(
    { role: input.sessionUser.role, tenantId: input.sessionUser.tenantId },
    capability
  );

  const status = authorization.outcome === 'ALLOW' ? 'running' : 'refused';

  const action = await prisma.agentAction.upsert({
    where: {
      tenantId_actionKey: { tenantId: input.sessionUser.tenantId, actionKey: input.actionKey },
    },
    create: {
      actionKey: input.actionKey,
      tenantId: input.sessionUser.tenantId,
      userId: input.sessionUser.id,
      role: input.sessionUser.role,
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
      error: null as any,
    },
  });

  if (authorization.outcome !== 'ALLOW') {
    const errorMsg = refusalMessage(authorization.outcome);
    await prisma.agentAction.update({
      where: { id: action.id },
      data: { status: 'refused', error: errorMsg, completedAt: new Date() },
    });
    return { status: 'refused', error: errorMsg };
  }

  try {
    const result = await executeTool(input.toolName, input.args, {
      userId: input.sessionUser.id,
      leadId: input.leadId,
      today: new Date().toISOString(),
      tenantId: input.sessionUser.tenantId,
      role: input.sessionUser.role,
      sessionUser: input.sessionUser,
      workOrderId: input.workOrderId,
      agentActionId: action.id, // passing this down for AiCall linkage
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
