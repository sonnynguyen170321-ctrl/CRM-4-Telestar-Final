import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

/**
 * Check if a user can access a specific meeting via its lead.
 */
export async function canAccessMeeting(
  viewer: SessionUser,
  meetingId: string
): Promise<{ allowed: true; meeting: any; lead: any } | { allowed: false; response: NextResponse }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      lead: { select: { id: true, assignedToId: true, campaignId: true, firstName: true, lastName: true, company: true, email: true } },
      client: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      sdr: { select: { id: true, firstName: true, lastName: true } },
      bookingLink: { select: { id: true, name: true, url: true, provider: true } },
    },
  });

  if (!meeting) {
    return { allowed: false, response: NextResponse.json({ error: 'Meeting not found' }, { status: 404 }) };
  }

  const hasAccess = await canAccessLead(viewer, {
    assignedToId: meeting.lead.assignedToId,
    campaignId: meeting.lead.campaignId,
  });

  if (!hasAccess) {
    return { allowed: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { allowed: true, meeting, lead: meeting.lead };
}
