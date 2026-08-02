import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { forbidden, notFound, handleApiError } from '@/lib/api/errors';
import { getEmailAccountScope, canAccessEmailAccount } from '@/lib/email-health/access';

export const dynamic = 'force-dynamic';

/** Clears a manager-set send pause. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;

    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Only managers can resume sending');
    if (!(await canAccessEmailAccount(user, id))) return notFound('Email account not found');

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!account) return notFound('Email account not found');

    const updated = await tenantStorage.run({ tenantId: account.tenantId }, () =>
      prisma.emailAccount.update({
        where: { id },
        data: { sendPausedAt: null, sendPausedById: null, sendPauseReason: null },
        select: { id: true, email: true, sendPausedAt: true },
      })
    );

    return NextResponse.json({ success: true, account: updated });
  } catch (err) {
    return handleApiError('api/email-health/accounts/[id]/resume POST', err);
  }
}
