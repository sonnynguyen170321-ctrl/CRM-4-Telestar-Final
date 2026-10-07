import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, type SessionUser } from '@/lib/auth';

/**
 * Whose mail the unified inbox shows (owner, 2026-10-07: "everyone's inbox is a mess — split it
 * per user; unify only what runs for that user's sequences; an SDR must not see a team lead's
 * mail").
 *
 * One person's inbox holds the conversations that person is responsible for:
 *  - mail in a mailbox they connected,
 *  - replies from leads they hold, whichever mailbox the sequence sent from,
 *  - replies to sequences they own.
 *
 * It used to be every mailbox owned by anyone the viewer could see, merged: a manager read their
 * whole pod as one list, and a reply landing in a team lead's sender mailbox never reached the SDR
 * holding the lead. Like the unibox of Instantly or Smartlead, a reply now follows its lead and
 * campaign, not the mailbox it happened to land in.
 *
 * `userIds` null means no restriction (a director's whole-tenant reach, used only for actions).
 */
export async function inboxScope(userIds: string[] | null): Promise<{
  inbound: Record<string, unknown>;
  outbound: Record<string, unknown>;
}> {
  if (userIds === null) return { inbound: {}, outbound: {} };
  const owned = await prisma.sequence.findMany({
    where: { createdById: { in: userIds } },
    select: { id: true },
  });
  const sequenceIds = owned.map((s) => s.id);
  const viaSequence = sequenceIds.length > 0;
  return {
    inbound: {
      OR: [
        { account: { userId: { in: userIds } } },
        { lead: { is: { assignedToId: { in: userIds } } } },
        ...(viaSequence ? [{ lead: { is: { sequenceId: { in: sequenceIds } } } }] : []),
      ],
    },
    outbound: {
      OR: [
        { account: { userId: { in: userIds } } },
        { lead: { is: { assignedToId: { in: userIds } } } },
        ...(viaSequence ? [{ sequenceId: { in: sequenceIds } }] : []),
      ],
    },
  };
}

export type InboxOwnerResult = { ok: true; ownerId: string } | { ok: false; status: 403 | 404; error: string };

/**
 * The person whose inbox is being opened: the viewer, or someone they manage. A manager looks at
 * one rep at a time rather than the pod merged into one list.
 */
export async function resolveInboxOwner(
  viewer: SessionUser,
  requested: string | null | undefined,
): Promise<InboxOwnerResult> {
  if (!requested || requested === viewer.id) return { ok: true, ownerId: viewer.id };
  const visible = await getVisibleUserIds(viewer);
  if (visible !== null && !visible.includes(requested)) {
    return { ok: false, status: 403, error: 'You cannot open this inbox' };
  }
  const exists = await prisma.user.findFirst({
    where: { id: requested, tenantId: viewer.tenantId ?? undefined },
    select: { id: true },
  });
  return exists ? { ok: true, ownerId: requested } : { ok: false, status: 404, error: 'User not found' };
}
