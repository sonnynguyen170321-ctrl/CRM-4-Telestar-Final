import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePoolManager } from '@/app/api/leadgen-pool/guard';
import { getAssignableRepIds } from '@/lib/leadgen/assignableReps';
import { handleApiError } from '@/lib/api/errors';

/**
 * Reps a pool manager may route converted records to.
 *
 * Exists so the picker and the convert/assign guards read from one source. The
 * dialog previously filtered `/api/users`, which is scoped to the caller's
 * reporting subtree — a leadgen manager sees only their own leadgen staff, so
 * the SDR list was always empty while the endpoint 403'd every real SDR id.
 * Fixing the UI alone would still have produced a 403.
 */
export async function GET(req: NextRequest) {
  const user = await requirePoolManager();
  if (user instanceof NextResponse) return user;

  try {
    const campaignId = new URL(req.url).searchParams.get('campaignId');
    const ids = await getAssignableRepIds(user, campaignId);

    const reps = await prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
      orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    });

    return NextResponse.json(reps);
  } catch (err) {
    return handleApiError('api/leadgen-pool/assignable-reps GET', err);
  }
}
