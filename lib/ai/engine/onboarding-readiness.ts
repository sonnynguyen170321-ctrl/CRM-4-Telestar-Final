import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export interface OnboardingReadinessChecklist {
  userId: string;
  userName: string;
  userEmail: string;
  role: Role;
  isReadyToLaunch: boolean;
  checks: Array<{
    name: string;
    passed: boolean;
    details: string;
  }>;
}

export interface RoleChangePreview {
  userId: string;
  userName: string;
  currentRole: Role;
  targetRole: Role;
  openLeadsCount: number;
  activeMailboxCount: number;
  impactSummary: string;
  requiredActionsBeforePromotion: string[];
}

/**
 * 🎯 ONBOARDING & ROLE-CHANGE READINESS ENGINE (Sections 76, 77, 78)
 */
export async function evaluateOnboardingReadiness(params: {
  userId: string;
  tenantId: string;
}): Promise<OnboardingReadinessChecklist | null> {
  const { userId, tenantId } = params;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      isActive: true,
      emailAccounts: { select: { id: true, email: true, isActive: true, sendPausedAt: true } },
    },
  });

  if (!user) return null;

  const checks = [
    {
      name: 'Account Activated',
      passed: user.isActive,
      details: user.isActive ? 'User account is active.' : 'User account is deactivated.',
    },
    {
      name: 'Mailbox Connection Active',
      passed: user.emailAccounts.some((m) => m.isActive && !m.sendPausedAt),
      details: user.emailAccounts.length > 0
        ? `Found ${user.emailAccounts.length} connected mailbox(es).`
        : 'No active email account connected. Cannot send outbound sequence steps.',
    },
  ];

  const isReadyToLaunch = checks.every((c) => c.passed);

  return {
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    userEmail: user.email,
    role: user.role,
    isReadyToLaunch,
    checks,
  };
}

export async function previewRoleChangeImpact(params: {
  userId: string;
  targetRole: Role;
  tenantId: string;
}): Promise<RoleChangePreview | null> {
  const { userId, targetRole, tenantId } = params;

  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      role: true,
      _count: { select: { assignedLeads: { where: { stage: { notIn: ['won', 'lost'] } } } } },
      emailAccounts: { select: { id: true } },
    },
  });

  if (!user) return null;

  const openLeadsCount = user._count.assignedLeads;
  const requiredActionsBeforePromotion: string[] = [];

  if (openLeadsCount > 0 && targetRole === 'floor_manager') {
    requiredActionsBeforePromotion.push(
      `Reassign ${openLeadsCount} active lead(s) to another SDR so ${user.firstName} is not managing pipeline while on the floor.`
    );
  }

  const impactSummary = `Promoting ${user.firstName} from ${user.role} to ${targetRole} will grant management dashboard and floor overview access.`;

  return {
    userId: user.id,
    userName: `${user.firstName} ${user.lastName}`.trim() || user.email,
    currentRole: user.role,
    targetRole,
    openLeadsCount,
    activeMailboxCount: user.emailAccounts.length,
    impactSummary,
    requiredActionsBeforePromotion,
  };
}
