import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateBookingLinkSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await ctx.params;

  try {
    const link = await prisma.bookingLink.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!link) {
      return NextResponse.json({ error: 'Booking link not found' }, { status: 404 });
    }

    return NextResponse.json(link);
  } catch (err) {
    return handleApiError('GET /api/booking-links/[id]', err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await ctx.params;
  const parsed = await parseBody(req, updateBookingLinkSchema);
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    // Fetch existing link to get clientId/campaignId for default toggle logic
    const existing = await prisma.bookingLink.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: 'Booking link not found' }, { status: 404 });
    }

    // If setting as default, unset others in the same scope
    if (body.isDefault) {
      await prisma.bookingLink.updateMany({
        where: {
          clientId: existing.clientId,
          campaignId: body.campaignId !== undefined ? (body.campaignId ?? null) : existing.campaignId,
          isDefault: true,
          id: { not: id },
        },
        data: { isDefault: false },
      });
    }

    const link = await prisma.bookingLink.update({
      where: { id },
      data: body,
      include: {
        client: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(link);
  } catch (err) {
    return handleApiError('PATCH /api/booking-links/[id]', err);
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await ctx.params;

  try {
    // Soft delete: deactivate the link. Keeps historical meeting snapshots intact.
    await prisma.bookingLink.update({
      where: { id },
      data: { isActive: false, isDefault: false },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError('DELETE /api/booking-links/[id]', err);
  }
}
