import { prisma } from '@/lib/prisma';
import { getVisibleUserIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * Your own mailbox. A director or floor manager may also use a mailbox of someone under them -
 * not, as before, any mailbox in the company. A From line speaks for whoever connected the
 * mailbox, so this is not widened to team leads. Shared by the send route and the preview, so
 * what the rep previews is what the send would accept.
 */
export async function reachableMailboxUserIds(user: SessionUser): Promise<string[] | null> {
  const isManager = user.role === 'director' || user.role === 'floor_manager';
  const reach = isManager ? await getVisibleUserIds(user) : [user.id];
  if (reach === null) return null;
  return reach.includes(user.id) ? reach : [...reach, user.id];
}

export async function findSendableAccount(user: SessionUser, tenantId: string, accountId: string) {
  const reach = await reachableMailboxUserIds(user);
  return prisma.emailAccount.findFirst({
    where: {
      id: accountId,
      tenantId,
      isActive: true,
      ...(reach === null ? {} : { userId: { in: reach } }),
    },
  });
}
