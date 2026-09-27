import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, canImportExport, canSeeAllImports, type SessionUser } from '@/lib/auth';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  // See the note in the collection route: `requireRole('floor_manager')` here meant the rows of a
  // failed import were unreadable to the four roles that can start one. This is where the per-row
  // errors live, so it is the answer to "which of my rows did not make it".
  if (!canImportExport(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    const importBatch = await prisma.importBatch.findUnique({
      where: { id },
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
        importRows: {
          orderBy: {
            rowIndex: 'asc',
          },
        },
      },
    });

    // 404 rather than 403 for someone else's batch, so whether a given id exists is not
    // confirmable by a caller who may not read it — the same rule `canReferenceCampaign` applies on
    // the import POST. `importRows` carry prospect names, emails and phone numbers.
    if (!importBatch || (!canSeeAllImports(user.role) && importBatch.userId !== user.id)) {
      return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
    }

    return NextResponse.json(importBatch);
  } catch (err: any) {
    console.error('[admin/imports/[id] GET] Error fetching import batch details:', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
