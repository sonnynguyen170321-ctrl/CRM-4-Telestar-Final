import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { buildHandoffPackage } from '@/lib/assist/handoffPackage';

/**
 * The handoff package an SDR opens after AI hands a prospect over (Phase 8c).
 *
 * Read-only, and object-scoped through the CRM's own `canAccessLead` — capability authorization
 * is not object authorization, so the agent layer never reproduces this check and this route never
 * skips it.
 */
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, tenantId: true, assignedToId: true, campaignId: true },
    });
    if (!lead || lead.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }
    if (!(await canAccessLead(user, lead))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const pkg = await buildHandoffPackage(user.tenantId, id);
    if (!pkg) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });

    return NextResponse.json(pkg);
  } catch (err) {
    return handleApiError('api/prospects/[id]/handoff GET', err);
  }
}
