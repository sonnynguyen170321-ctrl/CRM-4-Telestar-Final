import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';

/**
 * The legacy SIP dialer's config route — retired (docs/dialer/TASKS.md D2.6).
 *
 * It served one deployment-wide SIP password to every signed-in browser that asked with
 * `?withCredentials`, so the sip.js softphone in `components/CallDialerModal.tsx` could register.
 * That dialer never worked in production (the Permissions-Policy header blocks the microphone) and is
 * being replaced by the Telnyx softphone, which logs in with a short-lived per-rep token from
 * `POST /api/telephony/token` and never sees a password.
 *
 * Until the old modal is deleted (Phase 5) this answers "not configured" with no credentials, whatever
 * the environment holds, so the old Call button stays disabled and no shared secret can leave the server.
 */
export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  return NextResponse.json(
    { configured: false, missing: [], retired: true },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
