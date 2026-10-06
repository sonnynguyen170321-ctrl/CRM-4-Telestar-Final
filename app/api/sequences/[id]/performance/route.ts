import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { PERFORMANCE_WINDOWS, getSequencePerformance, type PerformanceWindow } from '@/lib/sequences/performance';
import { canViewSequenceId } from '@/lib/visibility';

/**
 * Performance of one sequence: enrollments, and sent / open / click / reply / bounce counts and
 * rates, overall and per step (lib/sequences/performance.ts). Aggregates only — no lead is named —
 * so any user of the tenant who can see the sequence can see its numbers.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const { id } = await params;
  if (!(await canViewSequenceId(user, id))) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
  const requested = req.nextUrl.searchParams.get('window') ?? '30d';
  const window = (requested in PERFORMANCE_WINDOWS ? requested : '30d') as PerformanceWindow;

  const performance = await getSequencePerformance({ tenantId: user.tenantId, sequenceId: id, window });
  if (!performance) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
  return NextResponse.json(performance);
}
