'use client';

import { signOut } from 'next-auth/react';

/**
 * Sign out in a way that actually ends the session.
 *
 * `signOut({ callbackUrl })` alone was not enough, and the reason is a race rather than a bug
 * in next-auth. The client refetches `/api/auth/session` on mount and after navigation, and
 * that route re-issues the session cookie. If one of those responses is still in flight when
 * sign-out clears the cookie, it lands afterwards and puts the cookie back — leaving the user
 * on `/login`, believing they signed out, with a live session.
 *
 * Measured on a production build before this existed: signing out immediately after a
 * navigation left `authjs.session-token` in place and `GET /api/leads` answering 200 in
 * roughly one attempt in three. Under `next dev`, where StrictMode and dev-mode polling widen
 * the window, it failed every time.
 *
 * The mechanism is broader than "the session route refreshes the cookie". Tracing every
 * response showed that **`proxy.ts` re-issues `authjs.session-token` on essentially every
 * request it handles** — `/api/leads`, `/api/settings`, and Next's RSC link prefetches
 * (`/meetings?_rsc=…`) all come back with a fresh `set-cookie`. So sign-out is not racing one
 * refetch, it is racing whatever the page happens to have in flight, and a CRM with a
 * prefetching sidebar always has something in flight.
 *
 * That is why this is deliberately short. `redirect: false` gives us control the moment the
 * sign-out response lands, and `window.location.replace` then tears the document down
 * immediately — cancelling its pending requests instead of giving them time to put the cookie
 * back. An earlier version of this function polled `/api/auth/session` to *verify* the
 * sign-out before navigating, and made things measurably worse: every extra second spent
 * verifying was another second of prefetches re-minting the cookie behind it.
 *
 * `replace` rather than `assign` also keeps the signed-in page out of history, so Back does
 * not land on a CRM route that no longer works.
 */
export async function hardSignOut(destination = '/login'): Promise<void> {
  // Invalidate the token itself first. Clearing the cookie alone loses to any request already
  // in flight — see `app/api/auth/revoke-self/route.ts` for the traced evidence. Bumping
  // `authVersion` means a re-minted cookie carries a token the server no longer accepts, so
  // the order matters: revoke, then clear, then leave.
  try {
    await fetch('/api/auth/revoke-self', { method: 'POST', cache: 'no-store' });
  } catch {
    // A failed revoke must not trap the user in a session they asked to leave. Clearing the
    // cookie is still worth doing, and the worst case is the behaviour we had before.
  }
  await signOut({ redirect: false });
  window.location.replace(destination);
}
