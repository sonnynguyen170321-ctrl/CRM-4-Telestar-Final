import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, canAccessUser } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { computeUserImpact } from '@/lib/admin/impact';
import { handleApiError } from '@/lib/api/errors';

/**
 * "What breaks if I deactivate this person?" — the counts the deactivate flow
 * shows before it will let the action through. Pass `?campaignId=` to scope it
 * to one campaign instead of the user's whole book of work.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const currentUser = userOrRes as SessionUser;

  const { id } = await params;
  if (!(await canAccessUser(currentUser, id))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const campaignId = req.nextUrl.searchParams.get('campaignId') ?? undefined;
    const impact = await computeUserImpact({ userId: id, campaignId }, currentUser);
    return NextResponse.json(impact);
  } catch (err) {
    return handleApiError('api/users/[id]/impact GET', err);
  }
}
