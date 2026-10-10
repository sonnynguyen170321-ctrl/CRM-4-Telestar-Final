import { NextRequest, NextResponse } from 'next/server';

import { requireInteractiveUser, requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { listPendingOutcomes } from '@/lib/telephony/callOutcome';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The rep's own calls that ended without an outcome in the last 24 hours (a tab closed or the drawer
 * left mid-call), newest first. The lead drawer shows them as a nudge that reopens the wrap-up.
 * Optional `?leadId=` narrows it to one lead. Tenant and rep come from the session.
 */
export async function GET(req: NextRequest) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });

  const leadId = req.nextUrl.searchParams.get('leadId') ?? undefined;
  try {
    const calls = await listPendingOutcomes({ tenantId: user.tenantId, userId: user.id, leadId: leadId?.slice(0, 64) });
    return NextResponse.json({ calls }, { headers: NO_STORE });
  } catch (error) {
    return handleApiError('api/telephony/calls/pending-outcome GET', error);
  }
}
