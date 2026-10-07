import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { resolveInboxOwner } from '@/lib/inbox/scope';

/**
 * What the inbox can be switched to: the people whose inbox this viewer may open (themselves, and
 * for a manager their reps), and the mailboxes in the chosen person's inbox — the ones they
 * connected and the sender mailboxes of the sequences they own.
 */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const owner = await resolveInboxOwner(user, new URL(req.url).searchParams.get('userId'));
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status });

  try {
    const visible = await getVisibleUserIds(user);
    const [people, mailboxes] = await Promise.all([
      prisma.user.findMany({
        where: {
          tenantId: user.tenantId,
          isActive: true,
          ...(visible === null ? {} : { id: { in: visible } }),
        },
        select: { id: true, firstName: true, lastName: true, role: true },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      }),
      prisma.emailAccount.findMany({
        where: {
          tenantId: user.tenantId,
          OR: [
            { userId: owner.ownerId },
            { sequenceSenders: { some: { sequence: { createdById: owner.ownerId } } } },
          ],
        },
        select: { id: true, email: true, isActive: true },
        orderBy: { email: 'asc' },
      }),
    ]);

    return NextResponse.json({ ownerId: owner.ownerId, people, mailboxes });
  } catch (error) {
    console.error('[inbox-views] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
