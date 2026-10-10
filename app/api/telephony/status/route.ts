import { NextResponse } from 'next/server';

import { requireInteractiveUser, requireAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isTelephonyEnabled } from '@/lib/telephony/flags';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * Whether the browser dialer is available to the signed-in rep: the deployment has it configured and
 * on, and the team has it enabled with the kill switch off. It never errors on "off" — the lead
 * drawer asks on every open and falls back to the phone-call panel when the answer is no. It reveals
 * nothing but that one boolean; tenant comes from the session.
 */
export async function GET() {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId || !isTelephonyEnabled(user.tenantId)) return NextResponse.json({ enabled: false }, { headers: NO_STORE });

  const settings = await prisma.telephonySettings.findFirst({
    where: { tenantId: user.tenantId },
    select: { enabled: true, killedAt: true },
  });
  return NextResponse.json({ enabled: Boolean(settings?.enabled && !settings.killedAt) }, { headers: NO_STORE });
}
