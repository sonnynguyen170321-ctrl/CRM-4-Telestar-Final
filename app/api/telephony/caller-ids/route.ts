import { NextResponse } from 'next/server';

import { requireAuth, requireInteractiveUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isTelephonyEnabled } from '@/lib/telephony/flags';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * The company numbers a rep may choose as caller ID: this tenant's active numbers that can place
 * calls. The same test `POST /api/telephony/calls` applies to `fromNumberId`, so the list never
 * offers a number the call would refuse. Provider ids and other tenants' numbers are not exposed.
 */
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });
  if (!isTelephonyEnabled(user.tenantId)) {
    return NextResponse.json({ error: 'The dialer is not enabled', code: 'dialer_disabled' }, { status: 403, headers: NO_STORE });
  }

  const numbers = await prisma.telephonyNumber.findMany({
    where: { tenantId: user.tenantId, isActive: true, purpose: { in: ['outbound', 'both'] } },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { id: true, e164: true, label: true, country: true, isDefault: true, isOverallDefault: true },
  });
  return NextResponse.json({ numbers }, { headers: NO_STORE });
}
