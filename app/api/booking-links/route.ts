import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody, capLimit } from '@/lib/validation/core';
import { createBookingLinkSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('clientId') || undefined;
  const campaignId = searchParams.get('campaignId') || undefined;
  const activeOnly = searchParams.get('activeOnly') !== 'false';
  const limit = capLimit(searchParams.get('limit'), 100, 500);

  try {
    const links = await prisma.bookingLink.findMany({
      take: limit,
      where: {
        ...(clientId ? { clientId } : {}),
        ...(campaignId ? { campaignId } : {}),
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });

    return NextResponse.json(links);
  } catch (err) {
    return handleApiError('GET /api/booking-links', err);
  }
}

export async function POST(req: NextRequest) {
  // Only director and floor_manager can create booking links.
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createBookingLinkSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    // If isDefault=true, unset other defaults for the same scope.
    if (body.isDefault) {
      await prisma.bookingLink.updateMany({
        where: {
          clientId: body.clientId,
          campaignId: body.campaignId ?? null,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    const link = await prisma.bookingLink.create({
      data: {
        clientId: body.clientId,
        campaignId: body.campaignId ?? null,
        name: body.name,
        url: body.url,
        provider: body.provider ?? 'other',
        ownerName: body.ownerName ?? null,
        ownerEmail: body.ownerEmail ?? null,
        timezone: body.timezone ?? 'UTC',
        durationMins: body.durationMins ?? 30,
        instructions: body.instructions ?? null,
        qualificationNotes: body.qualificationNotes ?? null,
        isDefault: body.isDefault ?? false,
        isActive: body.isActive ?? true,
        createdById: user.id,
      },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    return handleApiError('POST /api/booking-links', err);
  }
}
