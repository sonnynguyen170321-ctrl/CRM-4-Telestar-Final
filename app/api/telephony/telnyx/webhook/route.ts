import { NextRequest, NextResponse } from 'next/server';

import { enqueue } from '@/lib/bullmq/enqueue';
import { JobType } from '@/lib/bullmq/types';
import { prisma, tenantStorage } from '@/lib/prisma';
import { findCallForEvent } from '@/lib/telephony/applyEvent';
import { legCallId } from '@/lib/telephony/legMarker';
import { safeError } from '@/lib/telephony/safeError';
import { handleParkedCall } from '@/lib/telephony/parked';
import { parseTelnyxEvent, type TelnyxEvent } from '@/lib/telephony/telnyx/events';
import { verifyTelnyxWebhook } from '@/lib/telephony/telnyx/verify';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
/** Telnyx events are a few KB; anything this large is not one. */
const MAX_BODY_BYTES = 256 * 1024;
/** A hangup waits this long so the answered/bridged events of the same call can land first. */
const HANGUP_SETTLE_MS = 5_000;

const asSystem = <T>(fn: () => Promise<T>) => tenantStorage.run({ tenantId: 'system', bypassRls: true }, fn);
const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: NO_STORE });

/**
 * Telnyx call events (docs/dialer/TASKS.md D4.1). Public — no session — so everything rests on the
 * signature: nothing is read, stored or done until the raw body verifies under the Ed25519 key and
 * its timestamp is within five minutes.
 *
 * Order of work:
 *   1. verify (400 for unsigned, 401 for a bad or stale signature; nothing is stored);
 *   2. store the event keyed by the provider's event id — a redelivery inserts nothing and is
 *      answered 200 without being handled again; a failed insert is the only 5xx;
 *   3. a parked outbound call is authorized or hung up right here (`lib/telephony/parked.ts`);
 *   4. every other event is queued for the worker, whose tenant comes from the `Call` row.
 *
 * With the dialer off the events are still verified and stored, but the gate refuses every parked
 * call, so nothing is ever bridged.
 */
export async function POST(req: NextRequest) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  if (!publicKey) return reply(503, { error: 'Webhook verification is not configured' });

  const raw = await readCapped(req, MAX_BODY_BYTES);
  if (raw === 'too_large') return reply(413, { error: 'Body too large' });
  // Decoded once, strictly, keeping a leading BOM: the signature covers these exact bytes.
  let rawBody: string;
  try {
    rawBody = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    return reply(400, { error: 'Body is not UTF-8' });
  }

  const check = verifyTelnyxWebhook({
    rawBody,
    signature: req.headers.get('telnyx-signature-ed25519'),
    timestamp: req.headers.get('telnyx-timestamp'),
    publicKey,
  });
  if (!check.ok) {
    if (check.reason === 'bad_key') return reply(503, { error: 'Webhook verification is not configured' });
    const unsigned = check.reason === 'missing_headers' || check.reason === 'bad_timestamp';
    return reply(unsigned ? 400 : 401, { error: 'Invalid webhook signature' });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(400, { error: 'Body is not JSON' });
  }
  const event = parseTelnyxEvent(body);
  if (!event) return reply(400, { error: 'Not a call event' });

  try {
    const stored = await asSystem(() =>
      prisma.telephonyEvent.createMany({
        data: [{ providerEventId: event.providerEventId, type: event.type, sessionId: event.sessionId, payload: body as object }],
        skipDuplicates: true,
      })
    );
    if (stored.count === 0) return reply(200, { received: true, duplicate: true });
  } catch (error) {
    console.error('[telephony] webhook event could not be stored', { eventId: event.providerEventId, error: safeError(error) });
    return reply(500, { error: 'Event not stored' });
  }

  try {
    if (await isParkedCall(event)) {
      const outcome = await handleParkedCall(event);
      await markProcessed(event.providerEventId, outcome.action === 'connected' ? null : outcome.reason);
    } else {
      await queueEvent(event);
    }
  } catch (error) {
    // The event is stored; the reconcile cron replays it. Telnyx must not be told to resend.
    console.error('[telephony] webhook event not handled inline', { eventId: event.providerEventId, error: safeError(error) });
  }
  return reply(200, { received: true });
}

/**
 * The body's bytes, stopping at `limit`: a declared Content-Length is not trusted, and a chunked body
 * has none. Past the limit the stream is cancelled and nothing more is read.
 */
async function readCapped(req: NextRequest, limit: number): Promise<Uint8Array | 'too_large'> {
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * A `call.initiated` for a call waiting to be authorized — as against the leg we created ourselves
 * when connecting one. Our leg carries `leg:<callId>` in its client state, and is only believed when
 * that call is connected (initiated or ringing), holds this provider session, and the event is an
 * outgoing leg other than the parked leg we stored. Anything uncertain is parked: it is
 * checked, and hung up on if it fails.
 */
async function isParkedCall(event: TelnyxEvent): Promise<boolean> {
  if (event.type !== 'call.initiated') return false;
  const ownCallId = legCallId(event.clientState);
  if (!ownCallId || !event.sessionId) return true;
  if (event.direction !== 'outgoing') return true;
  const call = await asSystem(() =>
    prisma.call.findFirst({
      where: { id: ownCallId, providerSessionId: event.sessionId, status: { in: ['initiated', 'ringing'] } },
      select: { providerControlId: true },
    })
  );
  return call === null || call.providerControlId === event.controlId;
}

async function markProcessed(providerEventId: string, note: string | null): Promise<void> {
  await asSystem(() =>
    prisma.telephonyEvent.updateMany({ where: { providerEventId, processedAt: null }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: note } })
  );
}

/**
 * Hand the event to the worker. The tenant is the call's, read from our own row; an event that
 * matches no call yet is left stored and unprocessed for the reconcile cron. The dedupe key makes
 * the job one per event id (a redelivery never reaches here, a replay reuses the same job).
 */
async function queueEvent(event: TelnyxEvent): Promise<void> {
  const call = await findCallForEvent(event);
  if (!call) return;
  await enqueue(
    JobType.TELEPHONY_EVENT,
    { providerEventId: event.providerEventId },
    {
      tenantId: call.tenantId,
      dedupeKey: `telephony:event:${event.providerEventId}`,
      delay: event.type === 'call.hangup' ? HANGUP_SETTLE_MS : undefined,
    }
  );
}
