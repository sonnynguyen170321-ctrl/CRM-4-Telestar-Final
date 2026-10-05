import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { unenrollLead } from '@/lib/sequences/engine';
import { releaseOccupancy } from '@/lib/sequences/occupancy';
import { pauseEnrollmentOccurrence, resumeEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { resolveOccurrenceTask } from '@/lib/sequences/occurrenceTask';
import { requireAuth, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { runEmailStepNow } from '@/lib/sequences/runNow';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // `requireRole('sdr')` was the gate here, and sdr is the floor of the hierarchy — it admitted
  // every authenticated user, so it was `requireAuth` wearing a costume. Say that plainly; the real
  // gate is per-lead, below.
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { enrollmentIds, action } = body;

  if (!Array.isArray(enrollmentIds) || !action) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  const matched = await prisma.sequenceEnrollment.findMany({
    where: { id: { in: enrollmentIds }, sequenceId: id, tenantId: user.tenantId },
    include: { lead: true }
  });

  /**
   * Filtered to the leads this caller may act on, before anything is done to any of them.
   *
   * The query above is scoped by sequence and tenant only. Combined with a role gate that admitted
   * everyone, that let any sdr pass a list of enrollment ids — which the enrollments list endpoint
   * handed them for the whole company — and pause, resume, unenroll or immediately send on every
   * other rep's cadence at once. `run-now` here reaches the provider, so the bulk version of this
   * was the widest hole in the app: 1,086 active enrollments, one button.
   */
  const enrollments: typeof matched = [];
  let refusedCount = 0;
  for (const enr of matched) {
    if (await canAccessLead(user, enr.lead)) enrollments.push(enr);
    else refusedCount++;
  }

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
          const run = await runEmailStepNow({ taskId: task.id, expectedEnrollmentId, tenantId: user.tenantId! });
          if (run.ok) processedCount++;
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

  // `refusedCount` is reported rather than swallowed: a caller who selected 40 rows and moved 12
  // should be told the other 28 were not theirs, not left to infer it from a number.
  return NextResponse.json({ success: true, processedCount, refusedCount });
}
