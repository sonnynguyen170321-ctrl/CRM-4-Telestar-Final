import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canAccessLead, requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { recordDraftOutcome, recordResearchIrrelevant } from '@/lib/learning/humanFeedback';

/**
 * The rep's verdict on what AI gave them (Phase 10).
 *
 * Two things only a human knows: whether the suggested reply was usable, and whether the research
 * behind the outreach was worth anything. Both are recorded as evidence and nothing else happens —
 * **this route sends no message**. `prospect_reply` is `human_only` at every autonomy setting, and
 * the draft the rep is reporting on leaves the building through their own mail client or the
 * normal outbound path, never through here.
 *
 * Object authorization is the CRM's: `canAccessLead` decides whether this user may touch this
 * prospect at all, exactly as it does everywhere else.
 */
export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const body = await req.json().catch(() => ({}));
    const leadId = typeof body.leadId === 'string' ? body.leadId : null;
    if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, tenantId: true, assignedToId: true, campaignId: true },
    });
    if (!lead || lead.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
    }
    if (!(await canAccessLead(user, lead))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (body.kind === 'research_irrelevant') {
      const signal = await recordResearchIrrelevant({
        tenantId: user.tenantId as string,
        leadId,
        userId: user.id,
        evidenceKey: typeof body.evidenceKey === 'string' ? body.evidenceKey : 'unspecified',
        reason: typeof body.reason === 'string' ? body.reason : null,
      });
      return NextResponse.json({ recorded: signal.kind });
    }

    const draft = typeof body.draft === 'string' ? body.draft : null;
    const sent = typeof body.sent === 'string' ? body.sent : null;
    if (!draft || !sent) {
      return NextResponse.json({ error: 'draft and sent are both required' }, { status: 400 });
    }

    const signal = await recordDraftOutcome({
      tenantId: user.tenantId as string,
      leadId,
      userId: user.id,
      draft,
      sent,
      occurrenceKey: typeof body.occurrenceKey === 'string' ? body.occurrenceKey : String(Date.now()),
    });

    return NextResponse.json({
      recorded: signal.kind,
      // Said plainly, because the button that triggers this sits next to a reply the rep is about
      // to send by hand.
      message: 'Recorded. Nothing was sent — the message is still yours to send.',
    });
  } catch (err) {
    return handleApiError('api/ai/draft-outcome POST', err);
  }
}
