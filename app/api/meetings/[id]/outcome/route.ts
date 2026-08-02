import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { logMeetingOutcomeSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { canAccessMeeting } from '@/lib/meetings/meetingAccess';
import { logMeetingOutcome } from '@/lib/meetings/meetingLifecycle';
import { createOpportunityFromQualifiedMeeting } from '@/lib/opportunities/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, logMeetingOutcomeSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // Verify access via the meeting's lead
  const access = await canAccessMeeting(user, id);
  if (!access.allowed) return access.response;

  try {
    const meeting = await logMeetingOutcome({
      meetingId: id,
      user,
      tenantId: user.tenantId!,
      status: body.status,
      outcome: body.outcome,
      outcomeNotes: body.outcomeNotes,
      painPoints: body.painPoints,
      nextStep: body.nextStep,
      followUpAt: body.followUpAt,
    });

    // Auto-create an opportunity only when the meeting completed as qualified
    // and the SDR opted in. Idempotent — re-logging never duplicates.
    let opportunity: unknown = null;
    if (
      body.status === 'completed' &&
      body.outcome === 'qualified_opportunity' &&
      body.createOpportunity !== false
    ) {
      opportunity = await createOpportunityFromQualifiedMeeting({
        user,
        meetingId: id,
        leadId: meeting.leadId,
        qualificationSummary: body.qualificationSummary ?? body.outcomeNotes,
        painPoints: body.painPoints,
        nextStep: body.nextStep,
        value: body.opportunityValue ?? null,
        currency: body.opportunityCurrency ?? 'USD',
        clientOwnerName: body.opportunityClientOwnerName ?? meeting.clientOwnerName,
        clientOwnerEmail: body.opportunityClientOwnerEmail ?? meeting.clientOwnerEmail,
      });
    }

    return NextResponse.json({ meeting, opportunity });
  } catch (err) {
    return handleApiError('POST /api/meetings/[id]/outcome', err);
  }
}
