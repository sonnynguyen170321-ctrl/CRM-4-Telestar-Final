import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { pauseEnrollmentOccurrence, resumeEnrollmentOccurrence } from '@/lib/sequences/lifecycle';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; enrollmentId: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id: sequenceId, enrollmentId } = await params;

  try {
    const { status } = await req.json();

    if (status !== 'active' && status !== 'paused') {
      return NextResponse.json({ error: 'Invalid status. Must be active or paused' }, { status: 400 });
    }

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

    // The route acts on one *occurrence*. A historical row that happens to share the lead is not
    // it, and neither is a row belonging to a different sequence.
    if (enrollment.sequenceId !== sequenceId) {
      return NextResponse.json(
        { error: 'Enrollment does not belong to this sequence' },
        { status: 409 }
      );
    }

    if (status === 'paused') {
      if (enrollment.status === 'paused') {
        return NextResponse.json({ error: 'Already paused' }, { status: 400 });
      }
      // active → paused is the only pause there is. A completed or unenrolled occurrence used to
      // reach `pauseSequence`, which acts on the lead's *current* cadence — pausing whatever is
      // live now and only then failing on the historical row.
      if (enrollment.status !== 'active') {
        return NextResponse.json(
          {
            error: `Enrollment is ${enrollment.status} and cannot be paused. Only an active enrollment can be paused.`,
          },
          { status: 409 }
        );
      }

      const paused = await pauseEnrollmentOccurrence({
        enrollmentId,
        leadId: enrollment.leadId,
        sequenceId,
        reason: 'manual',
        actorUserId: user.id,
      });
      if (!paused.ok) {
        return NextResponse.json({ error: paused.detail }, { status: 409 });
      }

      const updated = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        include: {
          lead: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              company: true,
              tasks: {
                where: { sequenceId, status: 'pending' },
                select: { id: true, dueDate: true, type: true }
              }
            }
          }
        }
      });

      return NextResponse.json(updated);
    } else {
      // Resume. Only a *paused* occurrence may come back: a completed or unenrolled enrollment
      // is terminal, its occupancy was released, and reactivating it would resurrect a cadence
      // somebody deliberately ended.
      //
      // An **active** row is deliberately not rejected here. A resume whose process died after
      // the status flip leaves exactly that shape, and short-circuiting on the status alone made
      // the repair unreachable. Only the lifecycle service can tell a healthy cadence from an
      // interrupted resume, so the decision belongs to it.
      if (enrollment.status !== 'paused' && enrollment.status !== 'active') {
        return NextResponse.json(
          {
            error: `Enrollment is ${enrollment.status} and cannot be resumed. Enroll the lead again to start a new sequence run.`,
          },
          { status: 409 }
        );
      }

      const resumed = await resumeEnrollmentOccurrence({
        enrollmentId,
        leadId: enrollment.leadId,
        sequenceId,
        tenantId: enrollment.tenantId,
      });
      if (!resumed.ok) {
        return NextResponse.json({ error: resumed.detail }, { status: 409 });
      }
      // Nothing needed doing: the cadence was already fully active, bookkeeping and all.
      if (resumed.outcome === 'already_active') {
        return NextResponse.json({ error: 'Already active' }, { status: 400 });
      }

      const refreshed = await prisma.sequenceEnrollment.findUniqueOrThrow({
        where: { id: enrollmentId },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, company: true } },
        },
      });
      return NextResponse.json(refreshed);
    }
  } catch (error) {
    console.error('[sequence-status-patch] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
