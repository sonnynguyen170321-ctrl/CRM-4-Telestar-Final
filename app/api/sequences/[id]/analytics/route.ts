import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { getSequenceAnalytics } from '@/lib/sequences/analytics';

export const dynamic = 'force-dynamic';

/** One sequence's drill-down (lib/sequences/analytics.ts). Aggregates only, tenant-scoped. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403 });

  const { id } = await params;
  const analytics = await getSequenceAnalytics(id, user.tenantId);
  if (!analytics) return NextResponse.json({ error: 'Sequence not found' }, { status: 404 });
  return NextResponse.json(analytics);
}
