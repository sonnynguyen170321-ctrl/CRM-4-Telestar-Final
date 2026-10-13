import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * The tenant's default for per-email tracking in the composer. Anyone may read it (the composer
 * pre-sets its toggles from it); a director or floor manager changes it. Off by default.
 */
export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { defaultTrackOpens: true, defaultTrackClicks: true } });
  return NextResponse.json({ trackOpens: tenant?.defaultTrackOpens ?? false, trackClicks: tenant?.defaultTrackClicks ?? false });
}

const putSchema = z.object({ trackOpens: z.boolean().optional(), trackClicks: z.boolean().optional() });

export async function PUT(req: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 401 });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid settings' }, { status: 400 });
  const updated = await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      ...(parsed.data.trackOpens !== undefined && { defaultTrackOpens: parsed.data.trackOpens }),
      ...(parsed.data.trackClicks !== undefined && { defaultTrackClicks: parsed.data.trackClicks }),
    },
    select: { defaultTrackOpens: true, defaultTrackClicks: true },
  });
  return NextResponse.json({ trackOpens: updated.defaultTrackOpens, trackClicks: updated.defaultTrackClicks });
}
