import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, requireRole, getVisibleCampaignIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { createClientSchema } from '@/lib/validation/schemas';
import { logAdminAudit } from '@/lib/audit';
import { invalidateList } from '@/lib/cache';
import { handleApiError, duplicate } from '@/lib/api/errors';

/**
 * Clients as a first-class resource.
 *
 * Until now a Client could only come into existence as a side effect of
 * `POST /api/campaigns` (`newClientName`), and could never be edited or
 * retired — which is why churned clients kept showing active campaigns.
 */

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    // Same account-axis scoping the campaigns list uses: you see a client if you
    // can see at least one of its campaigns.
    const visibleCampaignIds = await getVisibleCampaignIds(user);
    const where = visibleCampaignIds
      ? { campaigns: { some: { id: { in: visibleCampaignIds } } } }
      : {};

    const clients = await prisma.client.findMany({
      where,
      select: {
        id: true,
        name: true,
        industry: true,
        contactName: true,
        contactEmail: true,
        status: true,
        createdAt: true,
        campaigns: { select: { id: true, name: true, status: true } },
      },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json(
      clients.map((c) => ({
        ...c,
        campaignCount: c.campaigns.length,
        activeCampaignCount: c.campaigns.filter((x) => x.status === 'active').length,
      })),
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return handleApiError('api/clients GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createClientSchema, 'Invalid client create');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const existing = await prisma.client.findFirst({
      where: { name: body.name.trim() },
      select: { id: true },
    });
    if (existing) return duplicate('A client with that name already exists');

    const client = await prisma.client.create({
      data: {
        name: body.name.trim(),
        industry: body.industry.trim(),
        contactName: body.contactName.trim(),
        contactEmail: body.contactEmail.trim().toLowerCase(),
        status: body.status ?? 'active',
      },
      select: {
        id: true, name: true, industry: true,
        contactName: true, contactEmail: true, status: true, createdAt: true,
      },
    });

    await logAdminAudit({
      actorId: user.id,
      action: 'admin.client.create',
      tableName: 'Client',
      recordId: client.id,
      changedFields: { name: client.name, industry: client.industry },
    });

    // `GET /api/campaigns?type=clients` caches under the campaigns prefix.
    await invalidateList(user.tenantId, 'campaigns');

    return NextResponse.json(client, { status: 201 });
  } catch (err) {
    return handleApiError('api/clients POST', err);
  }
}
