import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { forbidden, notFound, handleApiError } from '@/lib/api/errors';
import { parseBody } from '@/lib/validation/core';
import { pauseSendingSchema } from '@/lib/validation/schemas';
import { getEmailAccountScope, canAccessEmailAccount } from '@/lib/email-health/access';

export const dynamic = 'force-dynamic';

/**
 * Hard-stops sending for one inbox. workers/email.ts refuses any send while
 * sendPausedAt is set, and does so before reserving daily quota.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;

    // Authorise before doing any work.
    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Only managers can pause sending');
    if (!(await canAccessEmailAccount(user, id))) return notFound('Email account not found');

    const parsed = await parseBody(req, pauseSendingSchema, 'Invalid pause request');
    if (parsed.error) return parsed.error;

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { id: true, tenantId: true, email: true },
    });
    if (!account) return notFound('Email account not found');

    // Cross-tenant write: re-enter the owning tenant so the Prisma extension
    // scopes the update correctly (same pattern as automation/accounts/[id]/cap).
    const updated = await tenantStorage.run({ tenantId: account.tenantId }, () =>
      prisma.emailAccount.update({
        where: { id },
        data: {
          sendPausedAt: new Date(),
          sendPausedById: user.id,
          sendPauseReason: parsed.data.reason,
        },
        select: { id: true, email: true, sendPausedAt: true, sendPauseReason: true },
      })
    );

    return NextResponse.json({ success: true, account: updated });
  } catch (err) {
    return handleApiError('api/email-health/accounts/[id]/pause POST', err);
  }
}
