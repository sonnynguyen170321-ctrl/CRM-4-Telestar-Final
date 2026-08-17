import { prisma } from '@/lib/prisma';
import { tenantStorage } from '@/lib/tenant-context';
import { LeadStage } from '@prisma/client';

export interface ToolExecutionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  idempotencyKey?: string;
  verifiedAt: Date;
}

/**
 * 🎯 IDEMPOTENT WRITE TOOL REGISTRY (Sections 34, 35, 36)
 */
export async function executeUpdateLeadStage(params: {
  leadId: string;
  newStage: LeadStage;
  tenantId: string;
  userId: string;
  idempotencyKey?: string;
}): Promise<ToolExecutionResult> {
  const { leadId, newStage, tenantId, userId, idempotencyKey } = params;

  try {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, tenantId },
      select: { id: true, stage: true },
    });

    if (!lead) {
      return {
        success: false,
        error: `Lead ${leadId} not found in tenant.`,
        verifiedAt: new Date(),
      };
    }

    if (lead.stage === newStage) {
      return {
        success: true,
        data: { leadId, stage: newStage, alreadyInStage: true },
        idempotencyKey,
        verifiedAt: new Date(),
      };
    }

    const updated = await tenantStorage.run({ tenantId }, () =>
      prisma.lead.update({
        where: { id: leadId },
        data: {
          stage: newStage,
          updatedAt: new Date(),
        },
      })
    );

    // Audit log
    await tenantStorage.run({ tenantId }, () =>
      prisma.activity.create({
        data: {
          type: 'stage_changed',
          description: `Stage updated from ${lead.stage} to ${newStage} via Telestar AI.`,
          leadId,
          userId,
          tenantId,
          metadata: { previousStage: lead.stage, newStage, idempotencyKey: idempotencyKey || null },
        },
      })
    );

    return {
      success: true,
      data: { leadId: updated.id, stage: updated.stage },
      idempotencyKey,
      verifiedAt: new Date(),
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Database update failed.',
      verifiedAt: new Date(),
    };
  }
}
