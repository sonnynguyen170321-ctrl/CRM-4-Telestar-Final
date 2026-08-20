import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { loadEodSummary, loadMorningBriefing } from '@/lib/briefing/service';

/**
 * Morning and end-of-day briefing figures.
 *
 * The queries and the role scoping live in `lib/briefing/service.ts`, not here, because the chat
 * route needs the same EOD numbers and must not reach them through the browser. This route is
 * now HTTP and nothing else.
 */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'morning';

  if (type === 'morning') {
    return NextResponse.json(await loadMorningBriefing(user));
  }

  return NextResponse.json(await loadEodSummary(user));
}
