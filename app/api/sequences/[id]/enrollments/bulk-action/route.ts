import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unenrollLead } from '@/lib/sequences/engine';
import { releaseOccupancy } from '@/lib/sequences/occupancy';
import { pauseEnrollmentOccurrence, resumeEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { resolveOccurrenceTask } from '@/lib/sequences/occurrenceTask';
import { requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { enqueueImmediate } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireRole('sdr');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { enrollmentIds, action } = body;

  if (!Array.isArray(enrollmentIds) || !action) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const enrollments = await prisma.sequenceEnrollment.findMany({
    where: { id: { in: enrollmentIds }, sequenceId: id, tenantId: user.tenantId },
    include: { lead: true }
  });

  let processedCount = 0;

  for (const enr of enrollments) {
    try {
      if (action === 'run-now' && enr.status === 'active') {
        // The occurrence's own task, and the occurrence identity its payload must carry: an
        // enqueue of `{ taskId }` alone hashes to a different job than the delayed one, so it
        // promotes nothing and the worker falls back to lead+sequence matching.
        const resolved = await resolveOccurrenceTask(enr);
        if (resolved && resolved.task.type === 'email') {
          const { task, expectedEnrollmentId } = resolved;
          // Fast forward task
          await prisma.task.update({
            where: { id: task.id },
            data: { dueDate: new Date() }
          });
          await enqueueImmediate(
            JobType.SEQUENCE_EXECUTE_TASK,
            { taskId: task.id, expectedEnrollmentId },
            { tenantId: user.tenantId }
          );
          processedCount++;
        }
      } else if (action === 'pause' && enr.status === 'active') {
        // Same domain service the single route uses — one lifecycle state machine, and the
        // snapshot from `findMany` never decides anything on its own.
        const paused = await pauseEnrollmentOccurrence({
          enrollmentId: enr.id,
          leadId: enr.leadId,
          sequenceId: id,
          reason: 'manual',
          actorUserId: user.id,
        });
        if (!paused.ok) continue;
        processedCount++;
      } else if (action === 'resume' && enr.status === 'paused') {
        const resumed = await resumeEnrollmentOccurrence({
          enrollmentId: enr.id,
          leadId: enr.leadId,
          sequenceId: id,
          tenantId: enr.tenantId,
        });
        if (!resumed.ok) continue;
        processedCount++;
      } else if (action === 'unenroll') {
        await unenrollLead(enr.leadId, id);
        await prisma.sequenceEnrollment.update({
          where: { id: enr.id },
          data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() }
        });
        await prisma.activity.create({
          data: {
            userId: user.id, leadId: enr.leadId, type: 'sequence_unenrolled',
            description: `Manually unenrolled from sequence`,
            metadata: { sequenceId: id, manual: true },
            tenantId: user.tenantId
          }
        });
        processedCount++;
      }
    } catch (err) {
      console.error('Bulk action error on enrollment', enr.id, err);
    }
  }

  return NextResponse.json({ success: true, processedCount });
}
