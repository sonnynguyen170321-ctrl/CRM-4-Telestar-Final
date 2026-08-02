import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError, forbidden, notFound } from '@/lib/api/errors';
import { canAccessMeeting } from '@/lib/meetings/meetingAccess';
import { createOpportunityFromQualifiedMeeting } from '@/lib/opportunities/service';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;

  // Verify access via the meeting's lead.
  const access = await canAccessMeeting(user, id);
  if (!access.allowed) return access.response;

  const meeting = access.meeting;

  // Automatic conversion only for qualified meetings. Managers may override for recovery.
  if (meeting.outcome !== 'qualified_opportunity' && user.role !== 'director' && user.role !== 'floor_manager') {
    return forbidden('Only qualified meetings can be converted to an opportunity');
  }

  if (!meeting.leadId) {
    return notFound('Meeting has no linked lead');
  }

  try {
    const opportunity = await createOpportunityFromQualifiedMeeting({
      user,
      meetingId: meeting.id,
      leadId: meeting.leadId,
      qualificationSummary: meeting.outcomeNotes ?? null,
      painPoints: meeting.painPoints ?? null,
      nextStep: meeting.nextStep ?? null,
      clientOwnerName: meeting.clientOwnerName ?? null,
      clientOwnerEmail: meeting.clientOwnerEmail ?? null,
    });

    return NextResponse.json(opportunity);
  } catch (err) {
    return handleApiError('POST /api/meetings/[id]/convert-to-opportunity', err);
  }
}
