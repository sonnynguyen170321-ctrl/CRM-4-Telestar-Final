import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { getOverview } from '@/lib/email-health/queries';

export const dynamic = 'force-dynamic';

/**
 * Tenant-level deliverability scorecards, scoped to the viewer's pod.
 * SDRs get a valid response covering only their own mailbox.
 */
export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const overview = await getOverview(user);
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleApiError('api/email-health/overview GET', err);
  }
}
