import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { capLimit } from '@/lib/validation/core';
import { emailHealthAlertStatus } from '@/lib/validation/schemas';
import { getEmailAccountScope } from '@/lib/email-health/access';

export const dynamic = 'force-dynamic';

/** Deliverability alerts, scoped to inboxes the viewer can see. */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const params = new URL(req.url).searchParams;
    const limit = capLimit(params.get('limit'), 50, 200);

    const rawStatus = params.get('status');
    let status: string[] = ['open'];
    if (rawStatus === 'all') {
      status = ['open', 'acknowledged', 'resolved', 'ignored'];
    } else if (rawStatus) {
      const parsed = emailHealthAlertStatus.safeParse(rawStatus);
      if (!parsed.success) return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      status = [parsed.data];
    }

    const scope = await getEmailAccountScope(user);

    const alerts = await prisma.emailHealthAlert.findMany({
      where: {
        status: { in: status as never },
        // Domain- and campaign-level alerts have no accountId; only managers see
        // those, since an SDR's scope is defined purely by mailbox ownership.
        ...(scope.userIds === null
          ? {}
          : scope.canManage
            ? { OR: [{ account: { userId: { in: scope.userIds } } }, { accountId: null }] }
            : { account: { userId: { in: scope.userIds } } }),
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: {
        account: { select: { id: true, email: true, user: { select: { firstName: true, lastName: true } } } },
        campaign: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(
      { alerts, canManage: scope.canManage },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/email-health/alerts GET', err);
  }
}
