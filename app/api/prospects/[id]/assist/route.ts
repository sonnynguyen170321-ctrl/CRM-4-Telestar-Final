import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { generateSdrAssist, isAssistKind, ALL_ASSIST_KINDS } from '@/lib/assist/sdrAssist';

/**
 * AI assistance for a human-owned prospect (Phase 8c).
 *
 * Produces text the SDR reads, edits and sends themselves. There is no send path behind this
 * route: `prospect_reply` is `human_only` at every autonomy setting, and this endpoint is the
 * reason that restriction costs the SDR nothing.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const body = await req.json().catch(() => ({}));
    const kind = String(body.kind ?? 'summary');
    if (!isAssistKind(kind)) {
      return NextResponse.json(
        { error: `Unknown assist kind. Expected one of: ${ALL_ASSIST_KINDS.join(', ')}` },
        { status: 400 }
      );
    }

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

    const result = await generateSdrAssist({
      tenantId: user.tenantId,
      leadId: id,
      kind,
      userId: user.id,
    });

    // A provider outage is a degraded feature, not a failed request: the deterministic
    // recommendation still comes back and the SDR still has the package.
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return handleApiError('api/prospects/[id]/assist POST', err);
  }
}
