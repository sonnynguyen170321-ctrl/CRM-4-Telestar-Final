import { NextRequest, NextResponse } from 'next/server';

import { verifyClick } from '@/lib/email/tracking';
import { recordTrackingEvent } from '@/lib/email/trackingEvents';

/**
 * The click-tracking redirect. Public: the person clicking has no CRM session.
 *
 * Redirects only to the exact URL the CRM signed into that email (`s` binds `u` to the message), so
 * this can never be used as an open redirect: a changed destination, a missing signature or a token
 * from another message is a 400. A verified click is recorded inside the tenant the token names,
 * and the redirect happens whether or not recording succeeded — the prospect still gets their page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const url = req.nextUrl.searchParams.get('u') ?? '';
  const signature = req.nextUrl.searchParams.get('s') ?? '';

  const verified = verifyClick(token, url, signature);
  if (!verified || !/^https?:\/\//i.test(url)) {
    return new NextResponse('This link is not valid.', { status: 400, headers: { 'Content-Type': 'text/plain' } });
  }

  await recordTrackingEvent({ token: verified, type: 'click', url, userAgent: req.headers.get('user-agent') });
  return NextResponse.redirect(url, 302);
}
