'use client';

import { useEffect } from 'react';
import { hardSignOut } from '@/lib/auth/clientSignOut';

/**
 * Reacts to a session that the server has stopped honouring.
 *
 * Sessions are stateless JWTs and `getSessionUser` revalidates them against the database on
 * every protected request, so a deactivation, role change, password reset or "sign out all
 * sessions" takes effect immediately at the API. The **client** does not find out: the token
 * still decodes, so `useSession()` and `/api/auth/session` keep reporting a signed-in user
 * while every data call answers 401. What the user sees is not "you were signed out", it is a
 * CRM where nothing loads — which reads as an outage.
 *
 * There is no shared client fetch helper to hook (58 call sites use `fetch` directly), so
 * rather than edit all of them this patches `window.fetch` once, for same-origin `/api/`
 * responses only. Monkey-patching is not something to reach for casually; it earns its place
 * here because the alternative is 58 edits that a 59th call site would silently escape.
 *
 * Deliberately narrow:
 *  - only same-origin `/api/…` requests are considered; third-party calls are none of our
 *    business
 *  - `/api/auth/*` is excluded — a 401 there is the sign-in flow doing its job, and reacting
 *    to it would fight the login page
 *  - the response is passed through untouched, so callers see exactly what they would have
 *  - it fires once; `hardSignOut` navigates the document away, so there is no re-entry
 */
export default function SessionSentinel() {
  useEffect(() => {
    const original = window.fetch;
    let firing = false;

    const isOurApi = (url: string): boolean => {
      try {
        const parsed = new URL(url, window.location.origin);
        if (parsed.origin !== window.location.origin) return false;
        if (!parsed.pathname.startsWith('/api/')) return false;
        return !parsed.pathname.startsWith('/api/auth/');
      } catch {
        return false;
      }
    };

    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);

      if (res.status === 401 && !firing) {
        const input = args[0];
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;

        if (isOurApi(url)) {
          firing = true;
          // Do not await: the caller is waiting on this response, and the navigation that
          // ends this document is about to happen anyway.
          void hardSignOut();
        }
      }

      return res;
    };

    return () => {
      window.fetch = original;
    };
  }, []);

  return null;
}
