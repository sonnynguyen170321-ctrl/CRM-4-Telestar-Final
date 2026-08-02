import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { getInboxHealthRows, type InboxHealthFilters } from '@/lib/email-health/queries';
import { emailHealthLevel } from '@/lib/validation/schemas';

export const dynamic = 'force-dynamic';

/** Inbox health table. Filters: healthLevel, userId, provider, activeOnly. */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const params = new URL(req.url).searchParams;

    const filters: InboxHealthFilters = {};

    const rawLevel = params.get('healthLevel');
    if (rawLevel) {
      const parsed = emailHealthLevel.safeParse(rawLevel);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid healthLevel' }, { status: 400 });
      }
      filters.healthLevel = parsed.data;
    }

    const userId = params.get('userId');
    if (userId) filters.userId = userId;

    const provider = params.get('provider');
    if (provider) filters.provider = provider;

    if (params.get('activeOnly') === 'true') filters.activeOnly = true;

    // getInboxHealthRows applies pod scoping internally, so a userId filter can
    // only ever narrow within what the viewer may already see.
    const { rows, scope } = await getInboxHealthRows(user, filters);

    return NextResponse.json(
      { accounts: rows, canManage: scope.canManage },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/email-health/accounts GET', err);
  }
}
