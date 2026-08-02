import { NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import type { SessionUser } from '@/lib/auth';
import { forbidden, notFound, handleApiError } from '@/lib/api/errors';
import { getEmailAccountScope } from './access';

/**
 * Shared handler for the alert acknowledge/resolve transitions.
 *
 * Both routes differ only in the status they write and the audit fields they
 * stamp, so the authorisation and lookup logic lives here once.
 */

type AlertTransition = 'acknowledged' | 'resolved';

export async function transitionAlert(
  user: SessionUser,
  alertId: string,
  to: AlertTransition,
  context: string
): Promise<NextResponse> {
  try {
    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Only managers can update alerts');

    const alert = await prisma.emailHealthAlert.findUnique({
      where: { id: alertId },
      select: { id: true, tenantId: true, accountId: true, account: { select: { userId: true } } },
    });
    if (!alert) return notFound('Alert not found');

    // An account-scoped alert is only actionable by someone who can see that inbox.
    if (scope.userIds !== null && alert.account && !scope.userIds.includes(alert.account.userId)) {
      return notFound('Alert not found');
    }

    const now = new Date();
    const data =
      to === 'acknowledged'
        ? { status: to as never, acknowledgedById: user.id, acknowledgedAt: now }
        : { status: to as never, resolvedById: user.id, resolvedAt: now };

    const updated = await tenantStorage.run({ tenantId: alert.tenantId }, () =>
      prisma.emailHealthAlert.update({
        where: { id: alertId },
        data,
        select: {
          id: true, status: true, acknowledgedAt: true, acknowledgedById: true,
          resolvedAt: true, resolvedById: true,
        },
      })
    );

    return NextResponse.json({ success: true, alert: updated });
  } catch (err) {
    return handleApiError(context, err);
  }
}
