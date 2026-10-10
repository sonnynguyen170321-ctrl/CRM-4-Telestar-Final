import { NextRequest, NextResponse } from 'next/server';

import { requireAuth, requireInteractiveUser } from '@/lib/auth';
import { prisma, tenantStorage } from '@/lib/prisma';
import { consumeAttempt } from '@/lib/security/attemptLimit';
import { getTelephonyProvider } from '@/lib/telephony/index';
import { findListenableCall } from '@/lib/telephony/recordingAccess';
import { safeError } from '@/lib/telephony/safeError';

export const dynamic = 'force-dynamic';

/** How long the provider may take to answer with headers; the body then streams without a timer. */
const UPSTREAM_HEADERS_TIMEOUT_MS = 15_000;
/** A single `bytes=a-b` range, the only form audio elements send. */
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;
const PASS_THROUGH_HEADERS = ['content-length', 'content-range', 'accept-ranges'] as const;
/** Requests for the same call by the same person inside this window are one listen (seeking, buffering, replays). */
export const LISTEN_WINDOW_MS = 10 * 60_000;
export const LISTEN_LIMIT = 60;
const LISTEN_LIMIT_WINDOW_SECONDS = 10 * 60;
export const RECORDING_PLAY_ACTION = 'admin.call.recording_play';

const NO_STORE = { 'Cache-Control': 'no-store' };
const notFound = () => NextResponse.json({ error: 'Recording not found', code: 'not_found' }, { status: 404, headers: NO_STORE });
const unavailable = () => NextResponse.json({ error: 'The recording could not be fetched', code: 'unavailable' }, { status: 502, headers: NO_STORE });

/**
 * Play back a call recording (docs/dialer/TASKS.md D7.2).
 *
 * Streams the audio through this route instead of redirecting, so the provider's signed download URL
 * (valid for about ten minutes, and a bearer credential while it lasts) never reaches the browser, a
 * log or a header. A fresh URL is requested for every playback, only https hosts the provider is known
 * to serve from are followed, and no redirect is. The rep who made the call and the manager roles may
 * listen, and only while they can still work the lead; anything else - another rep, another tenant, a
 * call without a recording - is answered with the same 404, so the route does not reveal which calls exist.
 *
 * Audit is fail-closed and does not depend on the `Range` header: a request is recorded unless the same
 * person already has a recorded listen of this call in the last ten minutes (the continuation: seeking,
 * buffering). The row is written before any audio is fetched, and a failed write refuses the request.
 * New listens are rate limited per person.
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
  if (rangeHeader && !RANGE_PATTERN.test(rangeHeader.trim())) {
    return NextResponse.json({ error: 'Unsupported range', code: 'bad_range' }, { status: 416, headers: NO_STORE });
  }

  const gate = await recordListen(viewer, call);
  if (gate) return gate;

  const provider = getTelephonyProvider();
  const controller = new AbortController();
  const abortUpstream = () => controller.abort();
  req.signal.addEventListener('abort', abortUpstream);
  const timer = setTimeout(abortUpstream, UPSTREAM_HEADERS_TIMEOUT_MS);
  let upstream: Response;
  try {
    const url = await provider.getRecordingUrl(call.recordingProviderId);
    if (!url) return notFound();
    if (!provider.isRecordingUrlTrusted(url)) {
      console.error('[telephony] recording URL points at an untrusted host', { callId: call.id });
      return unavailable();
    }
    upstream = await fetch(url, {
      headers: rangeHeader ? { Range: rangeHeader.trim() } : undefined,
      redirect: 'error',
      signal: controller.signal,
    });
  } catch (error) {
    // Never log the URL: it is a credential. `safeError` carries no request data.
    console.error('[telephony] recording fetch failed', { callId: call.id, error: safeError(error) });
    return unavailable();
  } finally {
    // Headers are in (or it failed): the timer has done its job; the body streams until the client leaves.
    clearTimeout(timer);
  }

  if (upstream.status === 404 || upstream.status === 403) {
    await upstream.body?.cancel().catch(() => undefined);
    return notFound();
  }
  if (upstream.status === 416) {
    await upstream.body?.cancel().catch(() => undefined);
    const headers = new Headers(NO_STORE);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);
    return new NextResponse(null, { status: 416, headers });
  }
  if (upstream.status !== 200 && upstream.status !== 206) {
    await upstream.body?.cancel().catch(() => undefined);
    return unavailable();
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

/**
 * Write the audit row for a new listen, or let a continuation through. Answers with a refusal to return,
 * or null to go ahead.
 */
async function recordListen(
  viewer: { id: string; tenantId: string },
  call: { id: string; leadId: string | null; userId: string | null }
): Promise<NextResponse | null> {
  try {
    return await tenantStorage.run({ tenantId: viewer.tenantId }, async () => {
      const since = new Date(Date.now() - LISTEN_WINDOW_MS);
      const recent = await prisma.auditLog.findFirst({
        where: { userId: viewer.id, action: RECORDING_PLAY_ACTION, recordId: call.id, createdAt: { gt: since } },
        select: { id: true },
      });
      if (recent) return null;

      const attempt = await consumeAttempt({
        bucket: 'recording-playback',
        subject: `${viewer.tenantId}:${viewer.id}`,
        limit: LISTEN_LIMIT,
        windowSeconds: LISTEN_LIMIT_WINDOW_SECONDS,
      });
      if (!attempt.allowed) {
        return NextResponse.json(
          { error: 'Too many recordings played; try again shortly', code: 'rate_limited' },
          { status: 429, headers: { ...NO_STORE, 'Retry-After': String(attempt.retryAfterSeconds) } }
        );
      }

      await prisma.auditLog.create({
        data: {
          userId: viewer.id,
          action: RECORDING_PLAY_ACTION,
          tableName: 'Call',
          recordId: call.id,
          changedFields: { leadId: call.leadId, callerId: call.userId, __actor: viewer.id, ...(call.userId && call.userId !== viewer.id ? { __target: call.userId } : {}) },
        },
      });
      return null;
    });
  } catch (error) {
    // No audit row, no audio.
    console.error('[telephony] could not record a recording playback', { callId: call.id, error: safeError(error) });
    return NextResponse.json({ error: 'Playback is unavailable', code: 'audit_unavailable' }, { status: 503, headers: NO_STORE });
  }
}
