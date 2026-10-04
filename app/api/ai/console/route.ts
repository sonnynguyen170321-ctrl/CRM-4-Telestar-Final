import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';
import { buildAiConsole } from '@/lib/console/aiConsole';
import { buildRoleSurface } from '@/lib/console/surfaces';

/**
 * The operating-model board plus the viewer's role surface (Phase 9).
 *
 * One response on purpose. The SDR surface is built *from* the console the same request already
 * produced, so the board and the surface cannot show different counts for the same bucket — which
 * two endpoints called a second apart eventually would.
 *
 * Read-only. Scoping is the CRM's own pod walk inside each builder; the client sends no role and
 * cannot ask for another one's view.
 */
export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    // Home's rep picker. Only narrows: the builder AND-s it with the viewer's own lead scope, and
    // ignores it for a rep. "all" (or nothing) is the viewer's whole scope.
    const requested = req.nextUrl.searchParams.get('userId');
    const focusUserId = requested && requested !== 'all' ? requested : null;
    const console_ = await buildAiConsole(user, { focusUserId });
    const surface = await buildRoleSurface(user, console_);
    return NextResponse.json({ ...console_, surface });
  } catch (err) {
    return handleApiError('api/ai/console GET', err);
  }
}
