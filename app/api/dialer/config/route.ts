import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import type { SessionUser } from '@/lib/auth';

/**
 * SIP registration details for the browser softphone.
 *
 * Every field used to carry a hardcoded fallback — a PBX hostname, extension `101`, and a
 * plaintext password committed to this repository and served to any authenticated browser. The
 * damage was not only the leaked credential. Because the fallbacks were never empty, the client's
 * "incomplete SIP configuration" guard could not fire, so the app had no way to tell *unconfigured*
 * from *configured*. On a host without SIP the dialer therefore connected to someone else's PBX or
 * failed, and `CallDialerModal` caught the failure and simulated a connected call — after which
 * "Hang Up & Save Outcome" wrote a real Activity for a call that never happened.
 *
 * So this reports readiness instead of guessing, exactly as app/api/email/providers/route.ts does
 * for OAuth, and the UI disables the Call button and says which variables are missing.
 */
const SIP_KEYS = [
  'SIP_WEBSOCKET_URL',
  'SIP_DOMAIN',
  'SIP_DEFAULT_USERNAME',
  'SIP_DEFAULT_PASSWORD',
] as const;

export async function GET(req: NextRequest) {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;

  const missing = SIP_KEYS.filter((key) => !process.env[key]?.trim());

  // Readiness is what the lead panel needs to decide whether the Call button is usable, and it
  // needs it on every lead it opens. Credentials are what the dialer needs, once, at the moment a
  // call starts. Serving both from one unconditional response meant the SIP password was handed
  // out on every one of those reads; asking for it explicitly keeps it to the one caller that
  // actually places calls.
  if (!req.nextUrl.searchParams.has('withCredentials')) {
    return NextResponse.json({ configured: missing.length === 0, missing });
  }

  if (missing.length > 0) {
    // 200, not an error status: "no telephony on this deployment" is a configuration answer the
    // UI renders as a disabled button, not a request that failed.
    return NextResponse.json({ configured: false, missing });
  }

  // A browser softphone has to receive credentials — SIP.js registers from the page. What it must
  // not receive is a *shared* credential. These are still deployment-wide; per-user extensions
  // belong on the user row, and until they exist every rep registers as the same extension.
  return NextResponse.json({
    configured: true,
    missing: [],
    websocketUrl: process.env.SIP_WEBSOCKET_URL,
    domain: process.env.SIP_DOMAIN,
    username: process.env.SIP_DEFAULT_USERNAME,
    password: process.env.SIP_DEFAULT_PASSWORD,
    identity: user.id,
  });
}
