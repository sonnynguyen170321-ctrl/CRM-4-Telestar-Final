import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead, getLeadWhereScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody, capLimit } from '@/lib/validation/core';
import { createMeetingSchema, meetingStatus } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { bookMeeting } from '@/lib/meetings/meetingLifecycle';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') || undefined;
  const campaignId = searchParams.get('campaignId') || undefined;
  const sdrId = searchParams.get('sdrId') || undefined;
  const statusFilter = searchParams.get('status') || undefined;
  const leadId = searchParams.get('leadId') || undefined;
  const dateFrom = searchParams.get('dateFrom') || undefined;
  const dateTo = searchParams.get('dateTo') || undefined;
  const limit = capLimit(searchParams.get('limit'), 100, 500);

  // Validate status filter
  if (statusFilter) {
    const check = meetingStatus.safeParse(statusFilter);
    if (!check.success) {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
    }
  }

  // Build role-scoped lead filter
  const leadScope = await getLeadWhereScope(user);

  try {
    const meetings = await prisma.meeting.findMany({
      take: limit,
      where: {
        ...(clientId ? { clientId } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(sdrId ? { sdrId } : {}),
        ...(statusFilter ? { status: statusFilter as any } : {}),
        ...(leadId ? { leadId } : {}),
        ...(dateFrom || dateTo ? {
          scheduledAt: {
            ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
            ...(dateTo ? { lte: new Date(dateTo) } : {}),
          },
        } : {}),
        // Scope meetings via their lead
        lead: leadScope,
      },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, company: true, email: true } },
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        sdr: { select: { id: true, firstName: true, lastName: true } },
        bookingLink: { select: { id: true, name: true, provider: true } },
      },
      orderBy: { scheduledAt: 'desc' },
    });

    return NextResponse.json(meetings);
  } catch (err) {
    return handleApiError('GET /api/meetings', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createMeetingSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // Verify lead access
  const lead = await prisma.lead.findUnique({
    where: { id: body.leadId },
    select: { id: true, assignedToId: true, campaignId: true },
  });
  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }
  if (!(await canAccessLead(user, lead))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Validate: if scheduling, scheduledAt is required
  const status = body.status || 'scheduled';
  if (status === 'scheduled' && !body.scheduledAt) {
    return NextResponse.json(
      { error: 'scheduledAt is required when scheduling a meeting' },
      { status: 400 }
    );
  }

  try {
    const meeting = await bookMeeting({
      leadId: body.leadId,
      user,
      tenantId: user.tenantId!,
      bookingLinkId: body.bookingLinkId,
      sourceChannel: body.sourceChannel,
      status,
      title: body.title,
      scheduledAt: body.scheduledAt,
      durationMins: body.durationMins,
      timezone: body.timezone,
      meetingUrl: body.meetingUrl,
      clientOwnerName: body.clientOwnerName,
      clientOwnerEmail: body.clientOwnerEmail,
    });

    return NextResponse.json(meeting, { status: 201 });
  } catch (err) {
    return handleApiError('POST /api/meetings', err);
  }
}
