import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canImportExport, canSeeAllImports, type SessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/** Enough history to answer "did my upload work?" without returning every batch ever run. */
const MAX_BATCHES = 100;

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // This used to be `requireRole('floor_manager')`, while `canImportExport` admits sdr upward.
  // Four of the six roles that can start an import — sdr, leadgen, leadgen_manager, team_lead —
  // could therefore queue one and never learn what became of it: the POST answers 202 with a
  // batchId and the work happens in a worker, so the only record of a row that failed lives
  // behind a door those roles cannot open.
  if (!canImportExport(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const importBatches = await prisma.importBatch.findMany({
      // Overseers see the tenant's imports; everyone else sees the imports they started. Their own
      // is the part that was missing, and it is the part they need.
      where: canSeeAllImports(user.role) ? undefined : { userId: user.id },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: MAX_BATCHES,
    });

    return NextResponse.json(importBatches);
  } catch (err: any) {
    console.error('[admin/imports GET] Error fetching import batches:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
