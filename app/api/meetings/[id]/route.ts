import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateMeetingSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { canAccessMeeting } from '@/lib/meetings/meetingAccess';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;

  const access = await canAccessMeeting(user, id);
  if (!access.allowed) return access.response;

  return NextResponse.json(access.meeting);
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, updateMeetingSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const access = await canAccessMeeting(user, id);
  if (!access.allowed) return access.response;

  try {
    const updated = await prisma.meeting.update({
      where: { id },
      data: body,
      include: {
        lead: { select: { id: true, firstName: true, lastName: true } },
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        sdr: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError('PATCH /api/meetings/[id]', err);
  }
}
