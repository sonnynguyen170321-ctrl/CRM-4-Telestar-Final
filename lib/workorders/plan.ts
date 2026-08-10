import { prisma } from '@/lib/prisma';
import type { WorkOrder } from '@prisma/client';
import type { PlannedToolCall } from './execution';

/**
 * Plans tool calls for a WorkOrder (Phase 7 Knowledge Architecture & Research Engine).
 *
 * **Constraint**: `research_batch` is the ONLY WorkOrder type that produces Phase 7 research steps.
 * Non-research_batch WorkOrders return `[]` and perform no research side-effects.
 *
 * This function ONLY returns planned tool calls. It does NOT directly execute tools, write
 * evidence, or call Tavily/Jina. Execution passes through the standard path:
 * `planWorkOrderSteps` -> `executeWorkOrder` -> `executeAgentAction` -> registered tool.
 */
export async function planWorkOrderSteps(order: WorkOrder): Promise<PlannedToolCall[]> {
  if (order.type !== 'research_batch') {
    return [];
  }

  const steps: PlannedToolCall[] = [];

  let targetAccountId: string | null = null;
  let targetContactId: string | null = null;

  if (order.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: order.leadId },
      select: { tenantId: true, accountId: true, contactId: true },
    });
    if (lead && lead.tenantId === order.tenantId) {
      if (lead.accountId) targetAccountId = lead.accountId;
      if (lead.contactId) targetContactId = lead.contactId;
    }
  }

  if (targetAccountId) {
    steps.push({
      toolName: 'research_account',
      args: { accountId: targetAccountId, depth: 'standard' },
    });
  }

  if (targetContactId) {
    steps.push({
      toolName: 'research_contact',
      args: { contactId: targetContactId, depth: 'standard' },
    });
  }

  return steps;
}
