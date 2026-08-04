import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole, requireAuth, getVisibleCampaignIds } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import crypto from 'crypto';
import { parseBody } from '@/lib/validation/core';
import { createCampaignSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { cacheGet, cacheSet, listKey, invalidateList } from '@/lib/cache';

const CACHE_TTL = 60;

/**
 * Cache-key discriminator for the caller's visible campaign set.
 *
 * The key used to be tenant-wide, so every user in the tenant was served the same
 * cached payload by construction — scoping the query alone would still have handed
 * an SDR the director's cached copy. `null` means "sees everything" (director,
 * leadgen manager) and keeps one shared entry for them; anyone else gets a key
 * derived from their own id list. Hashed so the key stays short and does not put
 * user ids into Redis key names.
 */
function scopeTag(visibleCampaignIds: string[] | null): string {
  if (visibleCampaignIds === null) return 'all';
  const digest = crypto
    .createHash('sha1')
    .update([...visibleCampaignIds].sort().join(','))
    .digest('hex');
  return `s${digest.slice(0, 16)}`;
}

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const user = userOrRes as SessionUser;
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');

  // Row scoping: null = director / leadgen manager, who legitimately see every
  // campaign. Everyone else is limited to the campaigns their pod is assigned to.
  const visibleCampaignIds = await getVisibleCampaignIds(user);
  const campaignWhere =
    visibleCampaignIds === null ? {} : { id: { in: visibleCampaignIds } };

  const cacheKey = listKey(
    user.tenantId,
    'campaigns',
    `${type === 'clients' ? 'clients' : 'list'}:${scopeTag(visibleCampaignIds)}`
  );

  const cached = await cacheGet<any>(cacheKey);
  if (cached) return NextResponse.json(cached, {
    headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
  });

  try {
    let data: any;
    if (type === 'clients') {
      // Only the clients behind campaigns this caller can actually reach.
      data = await prisma.client.findMany({
        where:
          visibleCampaignIds === null
            ? {}
            : { campaigns: { some: { id: { in: visibleCampaignIds } } } },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, industry: true },
      });
      data = { clients: data };
    } else {
      // Explicit select, not `include: { client: true }`. The old include pulled the
      // whole Client row — contactName and contactEmail included — into a list every
      // authenticated user could read. For a BPO the client roster with named buyer
      // contacts is the business; nothing in the UI consumes those two fields.
      data = await prisma.campaign.findMany({
        where: campaignWhere,
        select: {
          id: true,
          name: true,
          clientId: true,
          targetVertical: true,
          targetGeo: true,
          status: true,
          startDate: true,
          endDate: true,
          client: { select: { id: true, name: true, industry: true } },
        },
        orderBy: { startDate: 'desc' },
      });
    }

    await cacheSet(cacheKey, data, CACHE_TTL);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    return handleApiError('api/campaigns GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireRole('floor_manager');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createCampaignSchema, 'Invalid campaign create');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  let clientId = body.clientId;

  if (!clientId && body.newClientName) {
    const newClient = await prisma.client.create({
      data: {
        name: body.newClientName,
        industry: body.targetVertical || '',
        contactName: user.firstName + ' ' + user.lastName,
        contactEmail: user.email,
        status: 'active',
      },
    });
    clientId = newClient.id;
  }

  if (!clientId) {
    return NextResponse.json({ error: 'Client is required' }, { status: 400 });
  }

  try {
    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        clientId,
        targetVertical: body.targetVertical ?? null,
        targetGeo: body.targetGeo ?? null,
        status: body.status ?? 'active',
        startDate: body.startDate ?? new Date(),
        endDate: null,
      },
    });

    await invalidateList(user.tenantId, 'campaigns');
    return NextResponse.json(campaign, { status: 201 });
  } catch (err) {
    return handleApiError('api/campaigns POST', err);
  }
}
