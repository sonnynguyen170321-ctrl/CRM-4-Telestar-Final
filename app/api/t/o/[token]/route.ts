import { NextRequest, NextResponse } from 'next/server';

import { TRANSPARENT_GIF, verifyTrackingToken } from '@/lib/email/tracking';
import { recordTrackingEvent } from '@/lib/email/trackingEvents';

/**
 * The open-tracking pixel. Public: a prospect's mail client has no CRM session.
 *
 * Always answers with the image, whatever happens — an invalid token, an unknown message or a
 * database error must never show as a broken image in someone's inbox. Only a token whose signature
 * verifies is recorded (lib/email/tracking.ts), and recording runs inside the tenant it names.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyTrackingToken(token.replace(/\.gif$/i, ''));
  if (verified) {
    await recordTrackingEvent({ token: verified, type: 'open', userAgent: req.headers.get('user-agent') });
  }
  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRANSPARENT_GIF.length),
      // Every open should reach us, not a cache.
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      Pragma: 'no-cache',
    },
  });
}
