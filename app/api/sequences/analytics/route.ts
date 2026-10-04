import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { getScopedSequenceStats } from '@/lib/sequences/analytics';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    // The viewer's own scope: a rep their leads, a manager their team — the same numbers Team View shows.
    const stats = await getScopedSequenceStats(user);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[sequences/analytics] GET failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
