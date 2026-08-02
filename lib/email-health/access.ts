import { prisma } from '@/lib/prisma';
import { computeVisibleUserIds } from '@/lib/podScoping';
import type { SessionUser } from '@/lib/auth';

/**
 * Visibility scoping for the deliverability module.
 *
 * Aggregate routes elsewhere in this repo re-implement this inline (see
 * app/api/team/leaderboard/route.ts); this is the single place the email-health
 * routes go through so a scoping bug can only exist once.
 *
 * Mailbox ownership is strictly the user axis — an EmailAccount belongs to a
 * person, not a campaign. The campaign/account axis used by getLeadWhereScope is
 * deliberately NOT applied here: sharing a campaign must not expose a colleague's
 * mailbox credentials, sync state or send history.
 */

export interface EmailAccountScope {
  /** `null` means unrestricted (director). Otherwise the visible owner IDs. */
  userIds: string[] | null;
  /** True when the viewer may change caps, pause sending, or resolve alerts. */
  canManage: boolean;
}

const MANAGER_ROLES: ReadonlyArray<SessionUser['role']> = [
  'director',
  'floor_manager',
  'team_lead',
];

export function isManagerRole(role: SessionUser['role']): boolean {
  return MANAGER_ROLES.includes(role);
}

export async function getEmailAccountScope(user: SessionUser): Promise<EmailAccountScope> {
  // SDRs (and leadgen roles) see exactly one mailbox owner: themselves. Short-circuit
  // so a non-manager can never trigger the full org read.
  if (!isManagerRole(user.role)) {
    return { userIds: [user.id], canManage: false };
  }

  const allUsers = await prisma.user.findMany({
    select: { id: true, role: true, managerId: true },
  });

  return {
    userIds: computeVisibleUserIds(allUsers, { id: user.id, role: user.role }),
    canManage: true,
  };
}

/** Prisma `where` fragment for EmailAccount queries under this scope. */
export function emailAccountWhere(scope: EmailAccountScope): Record<string, unknown> {
  if (scope.userIds === null) return {};
  return { userId: { in: scope.userIds } };
}

/**
 * Authorises access to one mailbox. Returns false rather than throwing so callers
 * can choose between 403 and 404.
 */
export async function canAccessEmailAccount(
  user: SessionUser,
  accountId: string
): Promise<boolean> {
  const account = await prisma.emailAccount.findUnique({
    where: { id: accountId },
    select: { userId: true },
  });
  if (!account) return false;
  if (account.userId === user.id) return true;

  const scope = await getEmailAccountScope(user);
  if (scope.userIds === null) return true;
  return scope.userIds.includes(account.userId);
}
