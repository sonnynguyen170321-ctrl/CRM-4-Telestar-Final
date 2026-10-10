import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, requireInteractiveUser } from '@/lib/auth';
import { logAdminAudit } from '@/lib/audit';
import { tenantStorage } from '@/lib/prisma';
import { getTelephonyProvider } from '@/lib/telephony/index';
import { findListenableCall } from '@/lib/telephony/recordingAccess';
import { safeError } from '@/lib/telephony/safeError';

export const dynamic = 'force-dynamic';

const UPSTREAM_TIMEOUT_MS = 15_000;
/** A single `bytes=a-b` range, the only form audio elements send. */
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
const PASS_THROUGH_HEADERS = ['content-length', 'content-range', 'accept-ranges'] as const;

const NO_STORE = { 'Cache-Control': 'no-store' };
const notFound = () => NextResponse.json({ error: 'Recording not found', code: 'not_found' }, { status: 404, headers: NO_STORE });
const unavailable = () => NextResponse.json({ error: 'The recording could not be fetched', code: 'unavailable' }, { status: 502, headers: NO_STORE });

/**
 * Play back a call recording (docs/dialer/TASKS.md D7.2).
 *
 * Streams the audio through this route instead of redirecting, so the provider's signed download URL
 * (valid for about ten minutes, and a bearer credential while it lasts) never reaches the browser, a
 * log or a header. A fresh URL is requested for every playback. The rep who made the call and the
 * manager roles may listen, and only while they can still work the lead; anything else - another rep,
 * another tenant, a call without a recording - is answered with the same 404, so the route does not
 * reveal which calls exist. Each playback writes an audit row (the first request of a listen: later
 * `Range` requests for seeking are the same listen).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  const keyRefusal = requireInteractiveUser(user);
  if (keyRefusal) return keyRefusal;
  if (!user.tenantId) return NextResponse.json({ error: 'No tenant context' }, { status: 403, headers: NO_STORE });
  const viewer = { ...user, tenantId: user.tenantId };

  const { id } = await params;
  const call = await findListenableCall(viewer, id);
  if (!call) return notFound();

  const rangeHeader = req.headers.get('range');
  const range = rangeHeader ? RANGE_PATTERN.exec(rangeHeader.trim()) : null;
  if (rangeHeader && !range) return NextResponse.json({ error: 'Unsupported range', code: 'bad_range' }, { status: 416, headers: NO_STORE });

  let upstream: Response;
  try {
    const url = await getTelephonyProvider().getRecordingUrl(call.recordingProviderId);
    if (!url || new URL(url).protocol !== 'https:') return notFound();
    upstream = await fetch(url, {
      headers: range ? { Range: rangeHeader! } : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    // Never log the URL: it is a credential. `safeError` carries no request data.
    console.error('[telephony] recording fetch failed', { callId: call.id, error: safeError(error) });
    return unavailable();
  }
  if (upstream.status === 404 || upstream.status === 403) {
    await upstream.body?.cancel().catch(() => undefined);
    return notFound();
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    await upstream.body?.cancel().catch(() => undefined);
    return unavailable();
  }

  const startsListen = !range || range[1] === '' || Number(range[1]) === 0;
  if (startsListen) {
    await tenantStorage.run({ tenantId: viewer.tenantId }, () =>
      logAdminAudit({
        actorId: user.id,
        action: 'admin.call.recording_play',
        tableName: 'Call',
        recordId: call.id,
        changedFields: { leadId: call.leadId, callerId: call.userId },
        ...(call.userId && call.userId !== user.id ? { targetUserId: call.userId } : {}),
      })
    );
  }

  const headers = new Headers(NO_STORE);
  const contentType = upstream.headers.get('content-type') ?? '';
  headers.set('Content-Type', contentType.toLowerCase().startsWith('audio/') ? contentType : 'audio/mpeg');
  headers.set('Content-Disposition', 'inline');
  headers.set('X-Content-Type-Options', 'nosniff');
  for (const name of PASS_THROUGH_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
