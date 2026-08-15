import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { enqueueImmediate } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { advanceSequence } from '@/lib/sequences/engine';
import { resolveOccurrenceTask } from '@/lib/sequences/occurrenceTask';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; enrollmentId: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id: sequenceId, enrollmentId } = await params;

  try {
    const enrollment = await prisma.sequenceEnrollment.findUnique({
      where: { id: enrollmentId },
      include: { lead: true },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    if (enrollment.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The route acts on one occurrence of *this* sequence; a row that merely shares the lead is
    // not it.
    if (enrollment.sequenceId !== sequenceId) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to this sequence' },
        { status: 409 }
      );
    }

    if (enrollment.status === 'completed' || enrollment.status === 'unenrolled') {
      return NextResponse.json({ error: 'Cannot run a completed or unenrolled sequence' }, { status: 400 });
    }

    // The task this *occurrence* is sitting on — not whichever pending row shares the lead and
    // sequence — together with the identity its execution payload must carry.
    const resolved = await resolveOccurrenceTask(enrollment);

    if (!resolved) {
      return NextResponse.json({ error: 'No pending task found for this sequence step' }, { status: 400 });
    }
    const { task, expectedEnrollmentId } = resolved;

    if (task.type === 'email') {
      // 1. Force the task dueDate to now
      await prisma.task.update({
        where: { id: task.id },
        data: { dueDate: new Date() },
      });

      // 2. Promote the scheduled job so it runs instantly on the worker (a plain
      //    delay:0 enqueue collides with the existing delayed job and gets dropped).
      //    The payload matches the delayed one exactly, occurrence included — a payload missing
      //    it hashes to a different job identity and promotes nothing.
      await enqueueImmediate(
        JobType.SEQUENCE_EXECUTE_TASK,
        { taskId: task.id, expectedEnrollmentId },
        { tenantId: user.tenantId! }
      );

      return NextResponse.json({ success: true, message: 'Email sequence execution enqueued.' });
    } else {
      // Manual steps (LinkedIn, call) can just be advanced
      await prisma.task.update({
        where: { id: task.id },
        data: { status: 'completed', completedAt: new Date() },
      });

      await advanceSequence(task, user.id, expectedEnrollmentId);

      return NextResponse.json({ success: true, message: 'Step advanced successfully.' });
    }
  } catch (error) {
    console.error('[sequence-run-now] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
