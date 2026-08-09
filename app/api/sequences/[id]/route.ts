import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateSequenceSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { invalidateList } from '@/lib/cache';
import { reconcileSequenceSteps } from '@/lib/sequences/steps';
import { assertSendWindowPermission } from '@/lib/sequences/permissions';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;

  const { id } = await params;

  try {
    const sequence = await prisma.sequence.findUnique({
      where: { id },
      include: {
        steps: {
          orderBy: { order: 'asc' },
          include: { template: { select: { id: true, name: true, channel: true } } },
        },
        _count: { select: { leads: true } },
      },
    });

    if (!sequence) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(sequence);
  } catch (err) {
    return handleApiError('api/sequences/[id] GET', err);
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const parsed = await parseBody(req, updateSequenceSchema, 'Invalid sequence update');
  if (parsed.error) return parsed.error;
  const body = parsed.data;

  const existing = await prisma.sequence.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    // Reconcile rather than delete-and-recreate: step ids seed the deterministic jitter
    // and A/B choice, and active enrollments point at step orders. See lib/sequences/steps.ts.
    if (body.steps !== undefined) {
      const priorSteps = await prisma.sequenceStep.findMany({
        where: { sequenceId: id },
        select: { order: true, sendWindowStartMinutes: true, sendWindowEndMinutes: true },
      });
      const windowViolations = assertSendWindowPermission(user.role, body.steps ?? [], priorSteps);
      if (windowViolations.length > 0) {
        const forbidden = windowViolations.some((v) => v.reason === 'forbidden_role');
        return NextResponse.json(
          {
            error: forbidden
              ? 'Only a Director or Floor Manager can change a step send window'
              : 'A send window needs both a start and an end, with the end after the start',
            steps: windowViolations,
          },
          { status: forbidden ? 403 : 400 }
        );
      }

      const reconciled = await reconcileSequenceSteps(id, user.tenantId!, body.steps ?? []);

      if (reconciled.blockedOrders.length > 0) {
        return NextResponse.json(
          {
            error: 'Cannot remove steps that active enrollments are currently on',
            blockedSteps: reconciled.blockedOrders,
          },
          { status: 409 }
        );
      }
    }

    const sequence = await prisma.sequence.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.description !== undefined && { description: body.description }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    await invalidateList(user.tenantId, 'sequences');
    return NextResponse.json(sequence);
  } catch (err) {
    return handleApiError('api/sequences/[id] PUT', err);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  const existing = await prisma.sequence.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    // Archive, don't delete (SKILL.md §3): history and step config stay intact.
    // Unenroll all leads and skip their pending sequence tasks first.
    await prisma.task.updateMany({
      where: { sequenceId: id, status: 'pending' },
      data: { status: 'skipped' },
    });
    await prisma.lead.updateMany({
      where: { sequenceId: id },
      data: { sequenceId: null, sequenceStep: null, sequenceStatus: null },
    });
    await prisma.sequence.update({
      where: { id },
      data: { isArchived: true, isActive: false },
    });

    await invalidateList(user.tenantId, 'sequences');
    return NextResponse.json({ success: true, archived: true });
  } catch (err) {
    return handleApiError('api/sequences/[id] DELETE', err);
  }
}
