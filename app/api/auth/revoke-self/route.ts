import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';
import { handleApiError } from '@/lib/api/errors';

/**
 * Revoke the caller's own tokens. Called by the sign-out control before `signOut()`.
 *
 * **Why clearing the cookie is not enough.** `proxy.ts` wraps every matched request in
 * NextAuth's `auth()`, which re-issues `authjs.session-token` on the response. Traced against a
 * production build, a sign-out looks like this:
 *
 * ```
 * POST /api/auth/signout        200 ["authjs.session-token=CLEARED"]
 * GET  /meetings?_rsc=…         200 ["authjs.session-token=SET"]      <-- prefetch, already in flight
 * GET  /api/notifications       200 ["authjs.session-token=SET"]
 * GET  /api/leads               200 ["authjs.session-token=SET"]
 * ```
 *
 * Every one of those requests left the browser carrying the old cookie *before* sign-out
 * cleared it, and the server mints a fresh one on the way back. The sidebar prefetches links,
 * so there is essentially always something in flight. Measured: sign-out failed to end the
 * session in 6 attempts out of 6. No amount of client-side care fixes this, because the client
 * is not the thing putting the cookie back.
 *
 * So revocation has to invalidate the **token**, not the cookie. `User.authVersion` already
 * exists for exactly this and is what `getSessionUser` checks on every protected request
 * (`lib/auth.ts:79-80`); bumping it makes every outstanding token fail validation, including
 * any the server re-mints from the old claims a moment later.
 *
 * **The trade-off, stated plainly:** `authVersion` is per user, not per session, so this signs
 * the user out of every device rather than just this one. That is a real behavioural change.
 * It is the right default for an internal CRM — staff sign out to end access, and "I signed
 * out but I'm still logged in" is a worse failure than "signing out here signed me out on my
 * phone too". Per-device revocation would need a server-side session store, i.e. giving up
 * stateless JWTs, which is a much larger change than this defect warrants.
 *
 * Self-service by design: it acts only on `getSessionUser()`'s own id and takes no parameters,
 * so it cannot be pointed at anyone else. The admin equivalent, which can,
 * is `POST /api/admin/users/[id]/sign-out-all`.
 */
export async function POST() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { authVersion: { increment: 1 } },
      select: { authVersion: true },
    });
    return NextResponse.json({ success: true, authVersion: updated.authVersion });
  } catch (err) {
    return handleApiError('api/auth/revoke-self POST', err);
  }
}
