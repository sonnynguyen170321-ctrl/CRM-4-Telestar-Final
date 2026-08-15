import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { releaseOccupancy } from '@/lib/sequences/occupancy';
import { requireAuth, canAccessLead } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { unenrollLead } from '@/lib/sequences/engine';
import { enrollLeadInSequence, SequenceEnrollmentError } from '@/lib/sequences/enrollment';
import { parseBody } from '@/lib/validation/core';
import { enrollSchema } from '@/lib/validation/schemas';
import { handleApiError } from '@/lib/api/errors';

/** The service's refusal reasons, as the status codes this route already returned for them. */
const ENROLLMENT_STATUS: Record<SequenceEnrollmentError['code'], number> = {
  sequence_not_found: 404,
  sequence_inactive: 400,
  sequence_empty: 400,
  lead_not_found: 404,
  forbidden: 403,
  // A human owns this conversation. Not a permission problem — a state one.
  prospect_human_owned: 409,
  // Another cadence already occupies this lead. Also a state conflict.
  lead_already_occupied: 409,
  // A terminal occurrence cannot be revived; a new enrollment is required.
  enrollment_terminal: 409,
  // The occurrence stopped being the lead's active cadence mid-flight.
  enrollment_not_owner: 409,
  // The same sequence is loaded but paused; it has an explicit resume path.
  enrollment_paused: 409,
  // The lead's sequence designation moved on while an interrupted launch was recovering.
  sequence_designation_changed: 409,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const parsed = await parseBody(req, enrollSchema, 'Invalid sequence enrollment');
  if (parsed.error) return parsed.error;
  const { leadId } = parsed.data;

  try {
    // Enrollment logic lives in the domain service so the agent's `outreach_launch` work order
    // and this route run the same code (ARCHITECTURE §9). The route maps its errors to HTTP.
    await enrollLeadInSequence(user, { leadId, sequenceId: id });
    const updatedLead = await prisma.lead.findUnique({ where: { id: leadId } });

    return NextResponse.json({ success: true, lead: updatedLead });
  } catch (err) {
    if (err instanceof SequenceEnrollmentError) {
      return NextResponse.json({ error: err.message }, { status: ENROLLMENT_STATUS[err.code] });
    }
    return handleApiError('api/sequences/[id]/enroll POST', err);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const body = await req.json();
  const { leadId } = body;

  if (!leadId) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
  }

  try {
    const lead = await prisma.lead.findUnique({ where: { id: leadId } });
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    if (!(await canAccessLead(user, lead))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sequence = await prisma.sequence.findUnique({ where: { id } });
    if (!sequence) {
      return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
    }

    if (lead.tenantId !== sequence.tenantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await prisma.sequenceEnrollment.updateMany({
      where: { leadId, sequenceId: id, status: { in: ['active', 'paused'] } },
      data: { status: 'unenrolled', completedAt: new Date(), ...releaseOccupancy() },
    });

    await unenrollLead(leadId, id);
    await prisma.activity.create({
      data: {
        userId: user.id,
        leadId,
        type: 'sequence_unenrolled',
        description: `Unenrolled from ${sequence?.name ?? id}`,
        metadata: { sequenceId: id },
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return handleApiError('api/sequences/[id]/enroll DELETE', err);
  }
}
