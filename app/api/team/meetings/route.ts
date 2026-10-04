import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireManager, getVisibleUserIds, getLeadgenScope, isLeadgenUser } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const userOrRes = await requireManager();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    let visibleUserIds = await getVisibleUserIds(user);
    if (isLeadgenUser(user.role)) {
      const scope = await getLeadgenScope(user);
      if (scope.kind === 'manager') {
        visibleUserIds = null;
      }
    }
    // A lead with a meeting: a Meeting row that was not cancelled, or a booking logged by moving
    // the lead to "meeting booked" (that path writes the activity, not a Meeting row). Archived
    // leads are off the board.
    // Tenant stated here, not left to the request-scoped extension alone.
    const whereClause: any = {
      tenantId: user.tenantId,
      archivedAt: null,
      OR: [
        { meetings: { some: { status: { not: 'cancelled' } } } },
        { activities: { some: { type: 'meeting_booked' } } },
      ],
    };

    if (visibleUserIds) {
      whereClause.assignedToId = { in: visibleUserIds };
    }

    const leads = await prisma.lead.findMany({
      where: whereClause,
      include: {
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
        campaign: {
          select: {
            id: true,
            name: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        activities: {
          where: { type: 'meeting_booked' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            createdAt: true,
          },
        },
        // The latest meeting, so a no-show is visible as one.
        meetings: {
          where: { status: { not: 'cancelled' } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true, scheduledAt: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(leads);
  } catch (err) {
    return handleApiError('api/team/meetings GET', err);
  }
}
