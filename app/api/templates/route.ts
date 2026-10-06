import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { createTemplateSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { cacheGet, cacheSet, listKey, invalidateList } from '@/lib/cache';
import { canShare, ownedOrSharedWhere, withCanManage } from '@/lib/visibility';

const CACHE_TTL = 60;

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const user = userOrRes as SessionUser;
  try {
    const { searchParams } = new URL(req.url);
    const channel = searchParams.get('channel');
    const search = searchParams.get('search') || '';
    // Keyed by viewer: each person now has their own list (lib/visibility.ts), and a per-tenant
    // key would serve one person's templates to the next caller for a minute.
    const cacheKey = listKey(user.tenantId, 'templates', `${channel ?? ''}:${search}:${user.id}`);

    const cached = await cacheGet<any[]>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const visible = await ownedOrSharedWhere(user);
    const rows = await prisma.template.findMany({
      where: {
        ...(channel ? { channel: channel as any } : {}),
        // Two independent conditions, each of which may be an OR, so they are joined with AND
        // rather than spread — the second OR would otherwise replace the first.
        AND: [
          visible,
          search
            ? {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { body: { contains: search, mode: 'insensitive' as const } },
                  { subject: { contains: search, mode: 'insensitive' as const } },
                ],
              }
            : {},
        ],
      },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    // Whether the caller may change each one, so the page offers only what the API allows.
    const templates = await withCanManage(user, rows);

    await cacheSet(cacheKey, templates, CACHE_TTL);
    return NextResponse.json(templates);
  } catch (err) {
    return handleApiError('api/templates GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createTemplateSchema, 'Invalid template create');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  try {
    const template = await prisma.template.create({
      data: {
        name: body.name,
        channel: body.channel,
        subject: body.subject ?? null,
        body: body.body,
        category: body.category,
        // Sharing with the whole company is a manager's call; from anyone else it is ignored.
        ...(body.isShared && canShare(user) ? { isShared: true } : {}),
        createdById: user.id,
      },
    });

    await invalidateList(user.tenantId, 'templates');
    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return handleApiError('api/templates POST', err);
  }
}
