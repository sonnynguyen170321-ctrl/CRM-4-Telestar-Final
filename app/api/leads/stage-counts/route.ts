import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth, getLeadWhereScope } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

/**
 * How many leads sit in each pipeline stage, for the caller's own scope.
 *
 * The home dashboard rendered this tally by fetching `GET /api/leads` and counting `stage` in the
 * browser. That handler includes `assignedTo`, `campaign`, `contact`, `account`, a `_count` of
 * tasks/notes/meetings and the first five tasks, and returns up to 200 rows — all of it discarded
 * except one string per row. It ran for every non-manager, on mount and again on every
 * `crm:task-created` event. With 34 sdrs that is the most repeated expensive query in the product.
 *
 * `groupBy` answers the same question in one round trip with no joins and no rows crossing the
 * wire. `app/api/team/leaderboard/route.ts` already uses this shape for its activity tallies.
 *
 * Scope comes from `getLeadWhereScope`, the same predicate `GET /api/leads` applies, so the numbers
 * here and the list there cannot disagree.
 */
export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const scope = await getLeadWhereScope(user);

    const grouped = await prisma.lead.groupBy({
      by: ['stage'],
      where: { ...scope, archivedAt: null },
      _count: { _all: true },
    });

    const counts: Record<string, number> = {};
    for (const row of grouped) counts[row.stage] = row._count._all;

    return NextResponse.json(counts);
  } catch (err) {
    return handleApiError('GET /api/leads/stage-counts', err);
  }
}
