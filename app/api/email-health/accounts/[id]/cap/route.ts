import { NextRequest, NextResponse } from 'next/server';
import { prisma, tenantStorage } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { forbidden, notFound, handleApiError } from '@/lib/api/errors';
import { parseBody } from '@/lib/validation/core';
import { updateDailyCapSchema } from '@/lib/validation/schemas';
import { getEmailAccountScope, canAccessEmailAccount } from '@/lib/email-health/access';

export const dynamic = 'force-dynamic';

/**
 * Adjusts an inbox's daily send cap.
 *
 * Supersedes app/api/automation/accounts/[id]/cap, which gated on an inline role
 * list, returned 401 (not 403) for a non-manager, and applied no upper bound.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;

    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Only managers can change the daily cap');
    if (!(await canAccessEmailAccount(user, id))) return notFound('Email account not found');

    const parsed = await parseBody(req, updateDailyCapSchema, 'Invalid daily cap');
    if (parsed.error) return parsed.error;

    const account = await prisma.emailAccount.findUnique({
      where: { id },
      select: { id: true, tenantId: true },
    });
    if (!account) return notFound('Email account not found');

    const updated = await tenantStorage.run({ tenantId: account.tenantId }, () =>
      prisma.emailAccount.update({
        where: { id },
        data: { dailyCap: parsed.data.dailyCap },
        select: { id: true, email: true, dailyCap: true, dailySendCount: true },
      })
    );

    return NextResponse.json({ success: true, account: updated });
  } catch (err) {
    return handleApiError('api/email-health/accounts/[id]/cap PATCH', err);
  }
}
