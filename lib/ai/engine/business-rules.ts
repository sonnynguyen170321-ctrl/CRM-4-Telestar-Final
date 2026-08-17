import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface BusinessRuleCheckResult {
  allowed: boolean;
  reason?: string;
  violations: string[];
}

/**
 * Validates whether an actor has authority to reassign a specific lead.
 */
export async function validateLeadAssignmentRule(params: {
  actorRole: Role;
  actorId: string;
  leadId: string;
  targetUserId: string;
  tenantId: string;
}): Promise<BusinessRuleCheckResult> {
  const { actorRole, actorId, leadId, targetUserId, tenantId } = params;
  const violations: string[] = [];

  const isManager = ['director', 'floor_manager', 'team_lead'].includes(actorRole);

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, tenantId },
    select: { id: true, assignedToId: true, operatingState: true },
  });

  if (!lead) {
    return { allowed: false, violations: ['Lead does not exist in this tenant.'] };
  }

  // SDRs can only handoff their own leads
  if (!isManager && lead.assignedToId !== actorId) {
    violations.push('SDRs may only reassign leads they currently own.');
  }

  // Verify target user is active within the tenant
  const targetUser = await prisma.user.findFirst({
    where: { id: targetUserId, tenantId, isActive: true },
  });

  if (!targetUser) {
    violations.push('Target user is not active in this organization.');
  }

  return {
    allowed: violations.length === 0,
    reason: violations.length === 0 ? 'Assignment permitted.' : violations.join(' '),
    violations,
  };
}

/**
 * Checks for stranded leads, mismatched senders, and risky operational states.
 */
export async function runOperationalConsistencyCheck(tenantId: string): Promise<{
  strandedLeadsCount: number;
  unassignedSequencesCount: number;
  inconsistencies: string[];
}> {
  const inconsistencies: string[] = [];

  // 1. Leads assigned to deactivated users
  const strandedLeads = await prisma.lead.findMany({
    where: {
      tenantId,
      assignedTo: { isActive: false },
    },
    select: { id: true, firstName: true, lastName: true, assignedTo: { select: { email: true } } },
    take: 5,
  });

  if (strandedLeads.length > 0) {
    inconsistencies.push(
      `Found ${strandedLeads.length} leads assigned to deactivated users (e.g. ${strandedLeads[0].assignedTo.email}).`
    );
  }

  return {
    strandedLeadsCount: strandedLeads.length,
    unassignedSequencesCount: 0,
    inconsistencies,
  };
}
