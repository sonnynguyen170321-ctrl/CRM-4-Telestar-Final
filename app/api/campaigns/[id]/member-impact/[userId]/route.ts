import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getManageScope, canManage } from '@/lib/admin/scope';
import { computeUserImpact } from '@/lib/admin/impact';
import { handleApiError } from '@/lib/api/errors';

/**
 * What this member still owns *inside this campaign*. The remove-member dialog
 * fetches this before offering the removal modes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const currentUser = userOrRes as SessionUser;

  const { id: campaignId, userId } = await params;

  const scope = await getManageScope(currentUser);
  if (!canManage(scope, userId, campaignId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const impact = await computeUserImpact({ userId, campaignId }, currentUser);
    return NextResponse.json(impact);
  } catch (err) {
    return handleApiError('api/campaigns/[id]/member-impact/[userId] GET', err);
  }
}
