import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, getVisibleCampaignIds, getLeadgenScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Who an admin caller may manage, across two non-overlapping domains. Always
 * derived server-side from the session user — never from a client-supplied scope.
 *
 *   - SDR org  — Director (any) + Floor Manager (their floor: visible users ↔
 *                floor accounts). Team Leads are valid targets too (a TL can
 *                personally run an account).
 *   - Leadgen  — Leadgen Manager (his direct leadgen-member reports ↔ any
 *                account). He cannot touch SDRs / team membership.
 *
 * Extracted from `app/api/admin/assignments/route.ts` so the campaign-member and
 * work-transfer services can enforce the same rules — a `route.ts` may only
 * export HTTP handlers, so the logic could not be shared while it lived there.
 */
export type ManageScope =
  | { kind: 'all' } // director — any user ↔ any account
  | { kind: 'floor'; userIds: Set<string>; campaignIds: Set<string> } // floor manager
  | { kind: 'leadgen'; userIds: Set<string> } // leadgen manager — any account
  | { kind: 'none' };

export async function getManageScope(user: SessionUser): Promise<ManageScope> {
  if (user.role === 'director') return { kind: 'all' };

  if (user.role === 'floor_manager') {
    const [userIds, campaignIds] = await Promise.all([
      getVisibleUserIds(user),
      getVisibleCampaignIds(user),
    ]);
    return {
      kind: 'floor',
      userIds: new Set(userIds ?? []),
      campaignIds: new Set(campaignIds ?? []),
    };
  }

  if (user.role === 'leadgen' || user.role === 'leadgen_manager') {
    const scope = await getLeadgenScope(user);
    if (scope.kind !== 'manager') return { kind: 'none' };
    const reports = await prisma.user.findMany({
      where: { managerId: user.id, role: 'leadgen', isActive: true },
      select: { id: true },
    });
    return { kind: 'leadgen', userIds: new Set(reports.map((r) => r.id)) };
  }

  return { kind: 'none' };
}

/** Whether `scope` permits creating/removing the (userId, campaignId) assignment. */
export function canManage(scope: ManageScope, userId: string, campaignId: string): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'floor':
      return scope.userIds.has(userId) && scope.campaignIds.has(campaignId);
    case 'leadgen':
      return scope.userIds.has(userId); // any account for his own members
    case 'none':
      return false;
  }
}

/**
 * Whether `scope` permits acting on a user outside any specific campaign —
 * used by whole-user operations (deactivation, un-scoped work transfer) where
 * `canManage` has no campaign to check.
 */
export function canManageUser(scope: ManageScope, userId: string): boolean {
  switch (scope.kind) {
    case 'all':
      return true;
    case 'floor':
    case 'leadgen':
      return scope.userIds.has(userId);
    case 'none':
      return false;
  }
}
