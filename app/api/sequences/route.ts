import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { createSequenceSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { cacheGet, cacheSet, listKey, invalidateList } from '@/lib/cache';
import { assertSendWindowPermission } from '@/lib/sequences/permissions';

const CACHE_TTL = 60;

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const user = userOrRes as SessionUser;
  try {
    const showArchived = new URL(req.url).searchParams.get('archived') === '1';
    const cacheKey = listKey(user.tenantId, 'sequences', String(showArchived));

    const cached = await cacheGet<any[]>(cacheKey);
    if (cached) return NextResponse.json(cached, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    });

    const sequences = await prisma.sequence.findMany({
      where: { isArchived: showArchived },
      include: {
        steps: { orderBy: { order: 'asc' } },
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { leads: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    await cacheSet(cacheKey, sequences, CACHE_TTL);
    return NextResponse.json(sequences, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    return handleApiError('api/sequences GET', err);
  }
}

export async function POST(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const parsed = await parseBody(req, createSequenceSchema, 'Invalid sequence create');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  // A new sequence has no stored steps, so every window on it counts as a change.
  const windowViolations = assertSendWindowPermission(user.role, body.steps ?? []);
  if (windowViolations.length > 0) {
    const forbidden = windowViolations.some((v) => v.reason === 'forbidden_role');
    return NextResponse.json(
      {
        error: forbidden
          ? 'Only a Director or Floor Manager can set a step send window'
          : 'A send window needs both a start and an end, with the end after the start',
        steps: windowViolations,
      },
      { status: forbidden ? 403 : 400 }
    );
  }

  try {
    const sequence = await prisma.sequence.create({
      data: {
        name: body.name,
        description: body.description,
        isActive: body.isActive ?? true,
        createdById: user.id,
        steps: {
          create: (body.steps ?? []).map((step, idx) => ({
            order: step.order ?? idx + 1,
            channel: step.channel,
            delayDays: step.delayDays ?? 1,
            delayHours: step.delayHours ?? 0,
            templateId: step.templateId ?? null,
            instructions: step.instructions,
            autoComplete: step.autoComplete ?? false,
            sendWindowStartMinutes: step.sendWindowStartMinutes ?? null,
            sendWindowEndMinutes: step.sendWindowEndMinutes ?? null,
            tenantId: user.tenantId!,
          })),
        },
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    await invalidateList(user.tenantId, 'sequences');
    return NextResponse.json(sequence, { status: 201 });
  } catch (err) {
    return handleApiError('api/sequences POST', err);
  }
}
