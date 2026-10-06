import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { parseBody } from '@/lib/validation/core';
import { updateSequenceSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';
import { invalidateList } from '@/lib/cache';
import { logAdminAudit } from '@/lib/audit';
import { reconcileSequenceSteps } from '@/lib/sequences/steps';

import { INVALID_SEND_WINDOW_MESSAGE, findInvalidSendWindows } from '@/lib/sequences/permissions';
import { canManageOwned, canShare, canViewOwned, unusableTemplateIds } from '@/lib/visibility';

/**
 * Editing or archiving a sequence acts on every rep's leads in it — archiving unenrolls them all —
 * so only its creator or a manager above them may (lib/visibility.ts). It was "any manager"; a team
 * lead could rewrite or archive a cadence belonging to another pod.
 */
const canChangeSequence = canManageOwned;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

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

    // A sequence the caller may not see answers exactly like one that does not exist.
    if (!sequence || !(await canViewOwned(user, sequence))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
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
  if (!existing || !(await canViewOwned(user, existing))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!(await canChangeSequence(user, existing))) {
    return NextResponse.json({ error: 'Only the sequence owner or their manager can change it' }, { status: 403 });
  }
  // Sharing puts a sequence in front of the whole company; an owner who is not a manager asks one.
  if (body.isShared !== undefined && body.isShared !== existing.isShared && !canShare(user)) {
    return NextResponse.json({ error: 'Only a manager can share a sequence with the team' }, { status: 403 });
  }

  try {
    // Reconcile rather than delete-and-recreate: step ids seed the deterministic jitter
    // and A/B choice, and active enrollments point at step orders. See lib/sequences/steps.ts.
    if (body.steps !== undefined) {
      const priorSteps = await prisma.sequenceStep.findMany({
        where: { sequenceId: id },
        select: { order: true, templateId: true },
      });
      const invalidWindows = findInvalidSendWindows(body.steps ?? []);
      if (invalidWindows.length > 0) {
        return NextResponse.json({ error: INVALID_SEND_WINDOW_MESSAGE, steps: invalidWindows }, { status: 400 });
      }

      // A step may only be pointed at a template the caller can see (lib/visibility.ts). Only a
      // template new to this sequence is checked: re-saving a step that already uses one — which
      // after the privacy migration may be a colleague's private template — must keep working.
      const alreadyUsed = new Set(priorSteps.map((step) => step.templateId).filter(Boolean));
      const unusable = await unusableTemplateIds(
        user,
        (body.steps ?? []).map((step) => step.templateId).filter((templateId) => !alreadyUsed.has(templateId ?? null)),
      );
      if (unusable.length > 0) {
        return NextResponse.json({ error: 'Template not found', templateIds: unusable }, { status: 404 });
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
        ...(body.trackOpens !== undefined && { trackOpens: body.trackOpens }),
        ...(body.trackClicks !== undefined && { trackClicks: body.trackClicks }),
        ...(body.sendOnWeekends !== undefined && { sendOnWeekends: body.sendOnWeekends }),
        ...(body.stopOnCompanyReply !== undefined && { stopOnCompanyReply: body.stopOnCompanyReply }),
        ...(body.excludeLeadsInOtherSequences !== undefined && {
          excludeLeadsInOtherSequences: body.excludeLeadsInOtherSequences,
        }),
        ...(body.isShared !== undefined && { isShared: body.isShared }),
      },
      include: { steps: { orderBy: { order: 'asc' } } },
    });

    // The automatic audit row names the sequence's creator, not the editor; the sequence's
    // Activity tab needs who actually changed it (lib/sequences/activity.ts).
    const changed = Object.entries(body).filter(([, value]) => value !== undefined);
    if (changed.length > 0) {
      await logAdminAudit({
        actorId: user.id,
        action: 'admin.sequence.update',
        tableName: 'Sequence',
        recordId: id,
        // Free text (description, step copy) is recorded as changed, not copied into the log.
        changedFields: Object.fromEntries(
          changed.map(([key, value]) => [
            key,
            key === 'steps' ? `${(value as unknown[]).length} steps` : key === 'description' ? 'changed' : value,
          ])
        ),
      });
    }

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
  if (!existing || !(await canViewOwned(user, existing))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!(await canChangeSequence(user, existing))) {
    return NextResponse.json({ error: 'Only the sequence owner or their manager can change it' }, { status: 403 });
  }

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
    // The enrollment rows too, or the lead cache says "not in a sequence" while the row that
    // *is* the cadence stays `active` and keeps its occupancy key — and the lead can never be
    // enrolled anywhere again, because the unique key says it is still busy here. Terminal
    // status and key release in one statement, as `lib/sequences/occupancy.ts` requires.
    await prisma.sequenceEnrollment.updateMany({
      where: { sequenceId: id, status: { in: ['active', 'paused'] } },
      data: { status: 'unenrolled', occupancyKey: null, lastTransitionAt: new Date(), nextActionAt: null },
    });
    await prisma.sequence.update({
      where: { id },
      data: { isArchived: true, isActive: false },
    });

    // Archiving stops every cadence running on this sequence. That is a management act with
    // a blast radius, so it goes in the Audit Log's default view, with the name a reader will
    // recognise rather than only the id.
    await logAdminAudit({
      actorId: user.id,
      action: 'admin.sequence.archive',
      tableName: 'Sequence',
      recordId: id,
      changedFields: { name: existing.name },
    });

    await invalidateList(user.tenantId, 'sequences');
    return NextResponse.json({ success: true, archived: true });
  } catch (err) {
    return handleApiError('api/sequences/[id] DELETE', err);
  }
}
