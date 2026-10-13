import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { templateAccess } from '@/lib/visibility';
import { z } from 'zod';
import { longText } from '@/lib/validation/core';

const abVariantSchema = z.object({
  subjectB: z.string().max(998).nullish(),
  bodyB: longText.nullish(),
});

/**
 * A template's A/B variant. It is part of the template, so it follows the template's rule
 * (lib/visibility.ts): readable by whoever can see the template, changeable by whoever can change
 * it. None of the three handlers checked anything beyond "signed in" — any rep could read, replace
 * or delete the B variant of any template by id.
 */
const NOT_FOUND = () => NextResponse.json({ error: 'Template not found' }, { status: 404 });
const FORBIDDEN = () =>
  NextResponse.json({ error: 'Only the template author or their manager can change its A/B test' }, { status: 403 });

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;
    if ((await templateAccess(user, id)) === 'none') return NOT_FOUND();
    const tenantId = user.tenantId;
    const variants = await prisma.abTestVariant.findMany({
      where: { templateId: id },
    });
    // Variant lab: what each variant actually did, counted from the messages sent with it
    // (OutboundMessage.abVariantId), not from the unreconciled counters on the variant row.
    const ids = variants.map((v) => v.id);
    const scope = { tenantId, templateId: id, abVariantId: { in: ids } };
    const [sent, opened, replied] = ids.length
      ? await Promise.all([
          prisma.outboundMessage.groupBy({ by: ['abVariantId'], where: scope, _count: { _all: true } }),
          prisma.outboundMessage.groupBy({ by: ['abVariantId'], where: { ...scope, openedAt: { not: null } }, _count: { _all: true } }),
          prisma.outboundMessage.groupBy({ by: ['abVariantId'], where: { ...scope, repliedAt: { not: null } }, _count: { _all: true } }),
        ])
      : [[], [], []];
    const countFor = (rows: typeof sent, variantId: string) => rows.find((r) => r.abVariantId === variantId)?._count._all ?? 0;
    return NextResponse.json(
      variants.map((v) => ({
        ...v,
        stats: { sent: countFor(sent, v.id), opened: countFor(opened, v.id), replied: countFor(replied, v.id) },
      })),
    );
  } catch (err) {
    return handleApiError('api/templates/[id]/ab-test GET', err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;
    const access = await templateAccess(user, id);
    if (access === 'none') return NOT_FOUND();
    if (access !== 'manage') return FORBIDDEN();

    // The same limits as the template itself (lib/validation/schemas.ts): a variant is template copy.
    const parsedBody = abVariantSchema.safeParse(await req.json().catch(() => null));
    if (!parsedBody.success) {
      return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? 'Invalid variant' }, { status: 400 });
    }
    const { subjectB, bodyB } = parsedBody.data;

    if (!subjectB && !bodyB) {
      return NextResponse.json({ error: 'Provide at least subjectB or bodyB' }, { status: 400 });
    }

    const existingB = await prisma.abTestVariant.findFirst({
      where: { templateId: id, version: 'B' },
    });

    if (existingB) {
      const updated = await prisma.abTestVariant.update({
        where: { id: existingB.id },
        data: {
          subject: subjectB ?? undefined,
          body: bodyB ?? undefined,
        },
      });
      return NextResponse.json(updated);
    }

    const variant = await prisma.abTestVariant.create({
      data: {
        templateId: id,
        version: 'B',
        subject: subjectB ?? null,
        body: bodyB ?? null,
      },
    });

    return NextResponse.json(variant, { status: 201 });
  } catch (err) {
    return handleApiError('api/templates/[id]/ab-test POST', err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const { id } = await params;
    const access = await templateAccess(user, id);
    if (access === 'none') return NOT_FOUND();
    if (access !== 'manage') return FORBIDDEN();

    await prisma.abTestVariant.deleteMany({
      where: { templateId: id, version: 'B' },
    });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return handleApiError('api/templates/[id]/ab-test DELETE', err);
  }
}
