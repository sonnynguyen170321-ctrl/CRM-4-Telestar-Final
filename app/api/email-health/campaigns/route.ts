import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { forbidden, handleApiError } from '@/lib/api/errors';
import { getCampaignHealth } from '@/lib/email-health/queries';
import { getEmailAccountScope } from '@/lib/email-health/access';

export const dynamic = 'force-dynamic';

/**
 * Campaign-level deliverability for client reporting.
 * Manager-only: an SDR has no reason to see cross-campaign client performance.
 */
export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const scope = await getEmailAccountScope(user);
    if (!scope.canManage) return forbidden('Campaign deliverability is manager-only');

    const campaigns = await getCampaignHealth(user);
    return NextResponse.json({ campaigns }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    return handleApiError('api/email-health/campaigns GET', err);
  }
}
