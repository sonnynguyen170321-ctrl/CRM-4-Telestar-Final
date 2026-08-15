import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, canReferenceCampaign } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateBookingLinkSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Withhold a to-one relation that belongs to another tenant.
 *
 * Same rule and same reasoning as the collection endpoint: the root `BookingLink` is
 * tenant-scoped by the extension in `lib/prisma.ts`, but a relation reached *through* it by an
 * `include` is not — the include follows the foreign key wherever it points. A row written
 * before the reference checks existed can still point outside the tenant, and this endpoint
 * would otherwise hand that foreign row's `name` to whoever asks for the link by id.
 *
 * The relation is withheld, not the row: the link itself belongs to this tenant, and hiding it
 * would make a real record invisible with no way to notice. `null` is a shape callers already
 * handle, because `campaign` and `createdBy` are optional.
 */
const sameTenant = <T extends { tenantId: string } | null>(relation: T, tenantId: string | null | undefined) =>
  relation && relation.tenantId === tenantId ? relation : null;

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const viewer = userOrRes as SessionUser;

  const { id } = await ctx.params;

  try {
    const link = await prisma.bookingLink.findUnique({
      where: { id },
      include: {
        // `tenantId` is selected on each relation so `sameTenant` can check it.
        client: { select: { id: true, name: true, tenantId: true } },
        campaign: { select: { id: true, name: true, tenantId: true } },
        createdBy: { select: { id: true, firstName: true, lastName: true, tenantId: true } },
      },
    });

    if (!link) {
      return NextResponse.json({ error: 'Booking link not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...link,
      client: sameTenant(link.client, viewer.tenantId),
      campaign: sameTenant(link.campaign, viewer.tenantId),
      createdBy: sameTenant(link.createdBy, viewer.tenantId),
    });
  } catch (err) {
    return handleApiError('GET /api/booking-links/[id]', err);
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

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

    // Checked here, before any write. `POST` gained this check; `PATCH` did not, so the same
    // caller-supplied `campaignId` that POST refuses could still be written by updating an
    // existing link — which is how a row pointing outside the tenant gets created after the
    // creation path is closed. Naming a campaign in a payload and reaching one by id are
    // different questions, which is why this is `canReferenceCampaign` and not `canAccess*`.
    if (body.campaignId) {
      const campaignCheck = await canReferenceCampaign(user, body.campaignId);
      if (campaignCheck === 'not_found') {
        // Same answer for "does not exist" and "belongs to another tenant" — distinguishing them
        // confirms the existence of foreign rows to anyone willing to guess ids.
        return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
      }
      if (campaignCheck === 'forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      // A campaign the caller may reference can still belong to a different client than the one
      // this link is attached to. Each field passes its own check; the pair is incoherent, and
      // `link -> campaign -> client` is the chain every client-facing surface walks.
      const campaign = await prisma.campaign.findFirst({
        where: { id: body.campaignId },
        select: { clientId: true },
      });
      if (campaign && campaign.clientId !== existing.clientId) {
        return NextResponse.json(
          { error: 'The campaign does not belong to this link’s client' },
          { status: 422 }
        );
      }
    }

    const targetCampaignId =
      body.campaignId !== undefined ? (body.campaignId ?? null) : existing.campaignId;

    // Serialised the same way the create path is: without the lock two concurrent requests can
    // both clear the existing default and both set their own, leaving two defaults for one
    // scope. The key covers exactly that scope and nothing wider.
    const lockKey = `booking-link-default:${user.tenantId}:${existing.clientId}:${targetCampaignId ?? ''}`;

    const link = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        await tx.bookingLink.updateMany({
          where: {
            // Defence in depth, matching the create path. `applyScopedTenant` already injects
            // this, but a security-critical bulk write should state its own tenant boundary
            // rather than rely on a wrapper staying in place.
            tenantId: user.tenantId!,
            clientId: existing.clientId,
            campaignId: targetCampaignId,
            isDefault: true,
            id: { not: id },
          },
          data: { isDefault: false },
        });
      }

      return tx.bookingLink.update({
        where: { id },
        data: body,
        include: {
          client: { select: { id: true, name: true, tenantId: true } },
          campaign: { select: { id: true, name: true, tenantId: true } },
        },
      });
    });

    return NextResponse.json({
      ...link,
      client: sameTenant(link.client, user.tenantId),
      campaign: sameTenant(link.campaign, user.tenantId),
    });
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
