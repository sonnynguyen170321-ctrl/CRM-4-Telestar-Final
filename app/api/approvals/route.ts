import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVisibleUserIds, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { canApproveAsManager } from '@/lib/agent/authorization';
import { expireStaleRequests } from '@/lib/workorders/approvals';

/**
 * Pending agent approval requests (Revenue AI Phase 6b).
 *
 * No inbox UI in this phase — this is the service surface behind the one Phase 9 will build.
 *
 * The listing expires stale requests before reading rather than after, so a request past its
 * deadline is never shown as actionable. Doing it on read as well as by sweep means the window
 * between the deadline and the next sweep cannot surface a request a click would then refuse.
 */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    await expireStaleRequests(user.tenantId);

    const status = req.nextUrl.searchParams.get('status') ?? 'pending';

    // Whose requests the caller sees: their own, and those of the people under them. The list
    // was tenant-wide — every rep could read the actions the agent had drafted on every
    // colleague's leads, copy and lead ids included.
    const visible = await getVisibleUserIds(user);

    const requests = await prisma.agentApprovalRequest.findMany({
      where: {
        tenantId: user.tenantId,
        status,
        ...(visible === null ? {} : { requestedById: { in: visible } }),
        // A non-manager sees only what they could actually decide. Showing an SDR a queue of
        // manager-level requests they cannot action is noise that trains people to ignore it.
        ...(canApproveAsManager(user) ? {} : { requiredLevel: 'user' }),
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });

    return NextResponse.json({
      approvals: requests,
      canApproveManagerLevel: canApproveAsManager(user),
    });
  } catch (err) {
    return handleApiError('approvals', err);
  }
}
