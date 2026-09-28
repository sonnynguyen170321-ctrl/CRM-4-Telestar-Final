import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, getLeadWhereScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const stepFilter = searchParams.get('step');
  const statusFilter = searchParams.get('status');

  try {
    /**
     * Scoped to the leads this caller may see, not to the whole tenant.
     *
     * This list was `sequenceId + tenantId` only, and it is the source of the enrollment ids the
     * page then passes to run-now / status / bulk-action. So it was not merely an over-broad read:
     * it was the thing that handed every sdr the identifiers needed to act on all 1,086 of the
     * company's active cadences. Scoping the list and gating each action are two halves of one fix.
     *
     * `getLeadWhereScope` is the same predicate `GET /api/leads` uses and it mirrors
     * `canAccessLead`: a director or leadgen manager gets `{}` (everything), a team lead or floor
     * manager gets their reports plus their campaigns, an sdr gets their own leads.
     */
    const leadScope = await getLeadWhereScope(user);

    const enrollments = await prisma.sequenceEnrollment.findMany({
      where: {
        sequenceId: id,
        tenantId: user.tenantId,
        ...(Object.keys(leadScope).length > 0 ? { lead: leadScope } : {}),
        ...(stepFilter ? { currentStep: parseInt(stepFilter) } : {}),
        ...(statusFilter ? { status: statusFilter as any } : { status: { not: 'unenrolled' } }),
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            company: true,
            tasks: {
              where: { sequenceId: id, status: 'pending' },
              select: { id: true, dueDate: true, type: true }
            }
          }
        }
      },
      orderBy: { startedAt: 'desc' },
    });

    return NextResponse.json(enrollments);
  } catch (err) {
    console.error('Fetch enrollments error:', err);
    return NextResponse.json({ error: 'Failed to fetch enrollments' }, { status: 500 });
  }
}
