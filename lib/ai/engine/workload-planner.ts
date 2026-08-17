import { prisma } from '@/lib/prisma';

export interface RepCapacityProfile {
  repId: string;
  name: string;
  email: string;
  openLeadsCount: number;
  overdueTasksCount: number;
  capacityStatus: 'underutilized' | 'balanced' | 'overloaded';
}

export interface WorkTransferPlan {
  fromRepName: string;
  toRepName: string;
  leadsToTransferCount: number;
  fromRepProjectedLoad: number;
  toRepProjectedLoad: number;
  isSafeToProceed: boolean;
  warnings: string[];
  recommendation: string;
}

/**
 * 🎯 WORKLOAD, CAPACITY & WORK TRANSFER PLANNER (Sections 20, 21, 77, 78)
 */
export async function getRepCapacityProfiles(tenantId: string): Promise<RepCapacityProfile[]> {
  const reps = await prisma.user.findMany({
    where: { tenantId, role: { in: ['sdr', 'leadgen'] }, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      assignedLeads: {
        where: { stage: { notIn: ['won', 'lost'] } },
        select: { id: true, nextTaskDue: true },
      },
    },
  });

  const now = new Date();

  return reps.map((rep) => {
    const openLeadsCount = rep.assignedLeads.length;
    const overdueTasksCount = rep.assignedLeads.filter((l) => l.nextTaskDue && l.nextTaskDue < now).length;

    let capacityStatus: RepCapacityProfile['capacityStatus'] = 'balanced';
    if (openLeadsCount > 100 || overdueTasksCount > 15) {
      capacityStatus = 'overloaded';
    } else if (openLeadsCount < 25 && overdueTasksCount === 0) {
      capacityStatus = 'underutilized';
    }

    return {
      repId: rep.id,
      name: `${rep.firstName} ${rep.lastName}`.trim() || rep.email,
      email: rep.email,
      openLeadsCount,
      overdueTasksCount,
      capacityStatus,
    };
  });
}

/**
 * Plans and simulates a work transfer between reps before any DB mutation.
 */
export async function planSafeWorkTransfer(params: {
  fromUserId: string;
  toUserId: string;
  leadIds: string[];
  tenantId: string;
}): Promise<WorkTransferPlan> {
  const { fromUserId, toUserId, leadIds, tenantId } = params;

  const [fromUser, toUser, validLeadsCount] = await Promise.all([
    prisma.user.findFirst({
      where: { id: fromUserId, tenantId },
      select: { firstName: true, lastName: true, email: true, _count: { select: { assignedLeads: { where: { stage: { notIn: ['won', 'lost'] } } } } } },
    }),
    prisma.user.findFirst({
      where: { id: toUserId, tenantId, isActive: true },
      select: { firstName: true, lastName: true, email: true, _count: { select: { assignedLeads: { where: { stage: { notIn: ['won', 'lost'] } } } } } },
    }),
    prisma.lead.count({
      where: { id: { in: leadIds }, assignedToId: fromUserId, tenantId },
    }),
  ]);

  const fromName = fromUser ? `${fromUser.firstName} ${fromUser.lastName}`.trim() : 'Unknown';
  const toName = toUser ? `${toUser.firstName} ${toUser.lastName}`.trim() : 'Unknown';

  const warnings: string[] = [];
  if (!toUser) {
    warnings.push('Target recipient is not an active user in this organization.');
  }

  const fromCurrent = fromUser?._count.assignedLeads || 0;
  const toCurrent = toUser?._count.assignedLeads || 0;

  const fromProjected = Math.max(0, fromCurrent - validLeadsCount);
  const toProjected = toCurrent + validLeadsCount;

  if (toProjected > 120) {
    warnings.push(`Transfer will increase ${toName}'s active load to ${toProjected} leads, which exceeds the max capacity limit of 120.`);
  }

  const isSafeToProceed = warnings.length === 0 && validLeadsCount > 0;

  return {
    fromRepName: fromName,
    toRepName: toName,
    leadsToTransferCount: validLeadsCount,
    fromRepProjectedLoad: fromProjected,
    toRepProjectedLoad: toProjected,
    isSafeToProceed,
    warnings,
    recommendation: isSafeToProceed
      ? `Safe to proceed: Moving ${validLeadsCount} leads from ${fromName} (${fromCurrent} ➔ ${fromProjected}) to ${toName} (${toCurrent} ➔ ${toProjected}).`
      : `Hold action: Resolve ${warnings.length} warning(s) before transferring leads.`,
  };
}
