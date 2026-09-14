import { NextRequest, NextResponse } from 'next/server';
import { verifyAndFetchSharedReport, hashToken } from '@/lib/client-reports/shareLinks';
import { consumeAttempt, clearAttempts, clientIpFrom } from '@/lib/security/attemptLimit';

/**
 * The unauthenticated share-link endpoint.
 *
 * This is the only route in the app that answers to nobody: the token in the URL is the whole
 * credential, and a link may additionally carry a password. Both were guessable at unlimited rate
 * — a share link's optional password could be brute-forced from the open internet with nothing
 * standing in the way, and the reports behind these links are client-facing pipeline data.
 *
 * The limiter is keyed on the token's hash, not the token itself: a raw share token is a
 * credential and has no business appearing in a Redis key. It is combined with the caller's IP so
 * one noisy visitor cannot lock a legitimate client out of a link they hold — the per-link key
 * still caps a distributed attack on one report, while the pair keeps a single source honest.
 */
const SHARE_ATTEMPT_BUCKET = 'share-link-password';
const SHARE_ATTEMPT_LIMIT = 10;
const SHARE_ATTEMPT_WINDOW_SECONDS = 15 * 60;

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    const result = await verifyAndFetchSharedReport(token);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to access shared report' }, { status: 400 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  try {
    let passwordAttempt: string | undefined;
    try {
      const body = await req.json();
      passwordAttempt = typeof body?.password === 'string' ? body.password : undefined;
    } catch {
      // Empty body
    }

    // Only a password guess is rate limited. A plain POST with no password is how the client asks
    // "does this link need one?", and charging that against the limit would let a visitor lock
    // themselves out simply by loading the page.
    const subject = passwordAttempt ? `${hashToken(token)}:${clientIpFrom(req.headers)}` : null;
    if (subject) {
      const attempt = await consumeAttempt({
        bucket: SHARE_ATTEMPT_BUCKET,
        subject,
        limit: SHARE_ATTEMPT_LIMIT,
        windowSeconds: SHARE_ATTEMPT_WINDOW_SECONDS,
      });
      if (!attempt.allowed) {
        return NextResponse.json(
          { error: 'Too many attempts. Try again later.' },
          { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSeconds) } }
        );
      }
    }

    const result = await verifyAndFetchSharedReport(token, passwordAttempt);
    if (subject) await clearAttempts(SHARE_ATTEMPT_BUCKET, subject);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Unable to access shared report' }, { status: 400 });
  }
}
