import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { requestHandback } from '@/lib/prospects/reengagement';

/**
 * "Resume AI Follow-up" — the SDR's explicit handback (Phase 8d).
 *
 * Handoff to a human is automatic; handback is not, and this route is the only way it happens. It
 * opens a `reengagement` work order and records the ownership move. It starts no outreach: the
 * plan is proposed and approved inside the work order, and only `startAIReengagement` acts on it.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const body = await req.json().catch(() => ({}));

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

    const result = await requestHandback(user, {
      leadId: id,
      reason: typeof body.reason === 'string' ? body.reason : undefined,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError('api/prospects/[id]/handback POST', err);
  }
}
