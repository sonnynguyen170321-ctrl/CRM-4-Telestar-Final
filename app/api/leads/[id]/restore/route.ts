import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';

/**
 * Un-archive a lead. Director only.
 *
 * Archiving is available to anyone who can access the lead (it is reversible and
 * hides nothing from history), but bringing a record back into active pipeline —
 * where it re-enters reports, task queues and client-facing counts — is a
 * director-level decision.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireRole('director');
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;

  try {
    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, archivedAt: true, firstName: true, lastName: true },
    });
    if (!lead) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!lead.archivedAt) {
      return NextResponse.json({ error: 'Lead is not archived' }, { status: 409 });
    }

    const restored = await prisma.lead.update({
      where: { id },
      data: { archivedAt: null, archivedById: null, archiveReason: null },
    });

    await prisma.activity.create({
      data: {
        userId: user.id,
        leadId: id,
        type: 'lead_created',
        description: `Lead restored from archive: ${lead.firstName} ${lead.lastName}`,
        metadata: { restored: true },
      },
    });

    return NextResponse.json(restored);
  } catch (err) {
    return handleApiError('api/leads/[id]/restore POST', err);
  }
}
