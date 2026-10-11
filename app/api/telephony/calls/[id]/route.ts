import { NextResponse } from 'next/server';

import { requireInteractiveUser, requireAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { prisma } from '@/lib/prisma';
import { id } from '@/lib/validation/core';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The provider-confirmed state of the rep's own outbound call: status, why it ended, when it was
 * answered. The softphone polls this while a call is live so it can still say "Busy" or "Declined"
 * when the browser SDK does not report a cause. Own call only, in the session tenant; anything else is
 * the same 404. API keys are refused.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });

  const callId = id.safeParse((await params).id);
  if (!callId.success) return NextResponse.json({ error: 'Call not found', code: 'not_found' }, { status: 404, headers: NO_STORE });

  try {
    const call = await prisma.call.findFirst({
      where: { id: callId.data, tenantId: user.tenantId, userId: user.id, direction: 'outbound' },
      select: { status: true, hangupCause: true, answeredAt: true, endedAt: true },
    });
    if (!call) return NextResponse.json({ error: 'Call not found', code: 'not_found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(
      {
        status: call.status,
        hangupCause: call.hangupCause,
        answeredAt: call.answeredAt?.toISOString() ?? null,
        endedAt: call.endedAt?.toISOString() ?? null,
      },
      { headers: NO_STORE }
    );
  } catch (error) {
    return handleApiError('api/telephony/calls/[id] GET', error);
  }
}
