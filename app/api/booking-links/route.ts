import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, canReferenceClient, canReferenceCampaign } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody, capLimit } from '@/lib/validation/core';
import { createBookingLinkSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

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

  // Every reference is validated before any write. A booking link is the URL a prospect is sent
  // to book a meeting, so one attached to the wrong client sends a prospect into another
  // company's calendar — and a tenant-A manager naming tenant B's client used to get a 201, with
  // the response echoing tenant B's client and campaign names back.
  const clientCheck = await canReferenceClient(user, body.clientId);
  if (clientCheck === 'not_found') {
    // Foreign tenant and nonexistent answer identically, or the status code confirms the
    // existence of other tenants' clients to anyone guessing ids.
    return NextResponse.json({ error: 'Client not found' }, { status: 404 });
  }
  if (clientCheck === 'forbidden') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (body.campaignId) {
    const campaignCheck = await canReferenceCampaign(user, body.campaignId);
    if (campaignCheck === 'not_found') {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    if (campaignCheck === 'forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Relational consistency, not authorization: both references are in-tenant and the caller is
    // entitled to name each one. The *pair* is incoherent — a link claiming client A whose
    // campaign belongs to client B describes two different hierarchies, and every report walking
    // `lead -> campaign -> client` would disagree with it. 422 because nothing is forbidden here;
    // the request is malformed.
    const campaign = await prisma.campaign.findFirst({
      where: { id: body.campaignId },
      select: { clientId: true },
    });
    if (campaign && campaign.clientId !== body.clientId) {
      return NextResponse.json(
        { error: 'The campaign does not belong to the supplied client' },
        { status: 422 }
      );
    }
  }

  try {
    // Clear-then-create, serialized per scope.
    //
    // These are two writes with no database constraint behind them, so two simultaneous requests
    // for the same client+campaign both cleared and then both created: measured at **seven of
    // eight rounds ending with two defaults**, which leaves the link a prospect is sent to
    // depending on row ordering.
    //
    // A partial unique index is the usual answer and is not available here: `campaignId` is
    // nullable, Postgres treats `NULL != NULL` so a plain unique index would not constrain the
    // campaign-less scope at all, and the `COALESCE` form that would is a functional index Prisma
    // cannot express — making it a migration-only constraint, which `CLAUDE.md` forbids because
    // it vanishes the next time a migration is generated from the datamodel.
    //
    // An advisory lock needs no schema change and cannot drift. It is transaction-scoped, so it
    // releases on commit or rollback with no unlock path to forget, and it serializes only the
    // one scope being written rather than the table. `lib/prisma.ts` builds a standard
    // `PrismaClient` over TCP — no Neon HTTP adapter is installed — so interactive transactions
    // are available on this path.
    const lockKey = `booking-link-default:${user.tenantId}:${body.clientId}:${body.campaignId ?? ''}`;

    const link = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      if (body.isDefault) {
        await tx.bookingLink.updateMany({
          where: {
            // Defence in depth. `applyScopedTenant` already injects this, proven by a raw-SQL
            // experiment in which a tenant-A request left tenant B's default untouched — so this
            // is not fixing a reproduced cross-tenant bug. It is here because a security-critical
            // bulk write should state its own tenant boundary rather than rely on a wrapper being
            // read correctly by the next person.
            tenantId: user.tenantId!,
            clientId: body.clientId,
            campaignId: body.campaignId ?? null,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return tx.bookingLink.create({
        data: {
          // Stated explicitly. The extension stamps this either way, but `tx` is the raw client
          // rather than the `TenantOptionalClient` wrapper, so the type system asks for it here —
          // and on a row whose whole purpose is client scoping, saying it is an improvement.
          tenantId: user.tenantId!,
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
    });

    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    return handleApiError('POST /api/booking-links', err);
  }
}
