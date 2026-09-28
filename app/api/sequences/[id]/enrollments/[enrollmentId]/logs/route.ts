import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

export async function GET(
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
      // The lead's two access fields travel with the enrollment so the ownership check below costs
      // no second query.
      select: {
        id: true,
        leadId: true,
        tenantId: true,
        lead: { select: { assignedToId: true, campaignId: true } },
      },
    });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    if (enrollment.tenantId !== user.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // What this returns is a colleague's correspondence: the tasks, the outbound message bodies and
    // the activity trail for someone else's prospect. Tenant-only scoping made every rep's
    // conversation readable by every other rep who could name an enrollment id.
    if (!(await canAccessLead(user, enrollment.lead))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch tasks related to this sequence
    const tasks = await prisma.task.findMany({
      where: {
        leadId: enrollment.leadId,
        sequenceId,
      },
      orderBy: { sequenceStep: 'asc' },
    });

    // Fetch outbound messages related to this lead
    const outboundMessages = await prisma.outboundMessage.findMany({
      where: {
        leadId: enrollment.leadId,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Fetch activities for this lead
    const activities = await prisma.activity.findMany({
      where: {
        leadId: enrollment.leadId,
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({
      tasks,
      outboundMessages,
      activities: activities.filter((act) => {
        if (act.type.startsWith('sequence_')) return true;
        const meta = act.metadata as any;
        return meta?.sequenceId === sequenceId;
      }),
    });
  } catch (error) {
    console.error('[sequence-logs-get] Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
