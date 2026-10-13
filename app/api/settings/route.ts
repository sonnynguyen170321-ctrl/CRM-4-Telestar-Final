import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { isValidTimezone } from '@/lib/automation/timezone';

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const profile = await prisma.user.findFirst({ where: { id: user.id } });
  if (!profile) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: profile.id,
    firstName: profile.firstName,
    lastName: profile.lastName,
    email: profile.email,
    timezone: profile.timezone ?? 'Asia/Ho_Chi_Minh',
    avatarUrl: profile.avatarUrl ?? null,
    jobTitle: profile.jobTitle ?? '',
    phone: profile.phone ?? '',
    calendarLink: profile.calendarLink ?? '',
    role: profile.role,
  });
}

export async function PUT(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  let firstName: string | undefined;
  let lastName: string | undefined;
  let timezone: string | undefined;
  let avatarUrl: string | undefined;
  let jobTitle: string | undefined;
  let phone: string | undefined;
  let calendarLink: string | undefined;
  try {
    const body = await req.json();
    firstName = typeof body.firstName === 'string' ? body.firstName.trim() : undefined;
    lastName = typeof body.lastName === 'string' ? body.lastName.trim() : undefined;
    timezone = typeof body.timezone === 'string' ? body.timezone.trim() : undefined;
    avatarUrl = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : undefined;
    jobTitle = typeof body.jobTitle === 'string' ? body.jobTitle.trim() : undefined;
    phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
    calendarLink = typeof body.calendarLink === 'string' ? body.calendarLink.trim() : undefined;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (firstName !== undefined && (firstName.length < 1 || firstName.length > 120)) {
    return NextResponse.json({ error: 'firstName must be 1-120 characters' }, { status: 400 });
  }
  if (lastName !== undefined && lastName.length > 120) {
    return NextResponse.json({ error: 'lastName must be 120 characters or fewer' }, { status: 400 });
  }
  if (timezone !== undefined && (timezone.length > 60 || !isValidTimezone(timezone))) {
    // The value feeds business-day due dates and send windows; a typo would silently fall back
    // to UTC downstream rather than erroring, so it is refused here where the user can see it.
    return NextResponse.json({ error: 'timezone must be an IANA zone, e.g. Asia/Singapore' }, { status: 400 });
  }
  if (avatarUrl !== undefined && avatarUrl.length > 1000) {
    return NextResponse.json({ error: 'avatarUrl too long' }, { status: 400 });
  }

  // These three go into outgoing email text ({{senderTitle}}, {{senderPhone}}, {{senderCalendarLink}}),
  // so they are single-line and bounded, and the link must be a plain http(s) URL: no javascript: or
  // data: link can reach a prospect's inbox through a merge field.
  if (jobTitle !== undefined && (jobTitle.length > 120 || /[\r\n]/.test(jobTitle))) {
    return NextResponse.json({ error: 'jobTitle must be a single line of 120 characters or fewer' }, { status: 400 });
  }
  if (phone !== undefined && (phone.length > 40 || !/^[0-9+()\-.\s]*$/.test(phone))) {
    return NextResponse.json({ error: 'phone may contain digits, spaces and + ( ) - . only, up to 40 characters' }, { status: 400 });
  }
  if (calendarLink !== undefined && calendarLink !== '') {
    let valid = calendarLink.length <= 500 && !/\s/.test(calendarLink);
    if (valid) {
      try {
        const url = new URL(calendarLink);
        valid = url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        valid = false;
      }
    }
    if (!valid) return NextResponse.json({ error: 'calendarLink must be an http(s) URL of 500 characters or fewer' }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(timezone !== undefined && { timezone }),
        // Empty string clears the avatar (stored as NULL).
        ...(avatarUrl !== undefined && { avatarUrl: avatarUrl || null }),
        // Empty strings clear the optional sender details.
        ...(jobTitle !== undefined && { jobTitle: jobTitle || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(calendarLink !== undefined && { calendarLink: calendarLink || null }),
      },
    });

    return NextResponse.json({
      id: updated.id,
      firstName: updated.firstName,
      lastName: updated.lastName,
      email: updated.email,
      timezone: updated.timezone ?? 'Asia/Ho_Chi_Minh',
      avatarUrl: updated.avatarUrl ?? null,
      jobTitle: updated.jobTitle ?? '',
      phone: updated.phone ?? '',
      calendarLink: updated.calendarLink ?? '',
      role: updated.role,
    });
  } catch (err) {
    return handleApiError('api/settings PUT', err);
  }
}
