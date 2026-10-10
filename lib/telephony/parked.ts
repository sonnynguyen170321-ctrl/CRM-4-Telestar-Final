import 'server-only';

import type { Call } from '@prisma/client';

import type { SessionUser } from '@/lib/auth';
import { prisma, tenantStorage } from '@/lib/prisma';

import { fromClientState, verifyCallToken } from './authToken';
import { loadCallGate } from './gate';
import { getTelephonyProvider } from './index';
import { legClientState } from './legMarker';
import type { TelnyxEvent } from './telnyx/events';

/**
 * The inline half of the webhook: a rep's browser placed a call, the provider parked it, and
 * `call.initiated` asks us whether it may go through (docs/dialer/ADR-001-park-and-authorize.md).
 *
 * The decision is made from our own records, never from the payload: the tenant, the rep, the lead and the
 * number come from the signed call token and the `Call` row it names. Then the gate runs again — a
 * call authorized at 16:59:59 must not connect at 17:00 — and the row is claimed with a guarded
 * `authorized -> initiated` update, so a token replayed within its 120 seconds finds nothing to
 * claim and is hung up on.
 *
 * FAIL CLOSED. A parked call is only ever connected by the single path at the bottom of
 * `connectIfAllowed`; every other exit — a missing, forged, expired or mismatched token, a blocked
 * gate, a lost claim, an exception anywhere — ends in a hang-up. If even the hang-up cannot be sent,
 * the provider's own park timeout drops the call.
 */

export type ParkedOutcome =
  | { action: 'connected'; callId: string }
  | { action: 'hung_up'; reason: string; callId: string | null };

/** Ring the lead this long before giving up. */
const RING_TIMEOUT_SECONDS = 30;

const asTenant = <T>(tenantId: string, fn: () => Promise<T>) => tenantStorage.run({ tenantId }, fn);
const digits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

async function hangUp(event: TelnyxEvent): Promise<void> {
  if (!event.controlId) return;
  try {
    await getTelephonyProvider().command(event.controlId, { action: 'hangup' }, `hangup:${event.providerEventId}`);
  } catch (error) {
    console.error('[telephony] could not hang up a parked call; the provider park timeout will drop it', {
      eventId: event.providerEventId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Refuse a call that was authorized: the row becomes `blocked` with why, unless another path already moved it. */
async function block(call: Call, reasons: string[]): Promise<void> {
  await prisma.call.updateMany({
    where: { id: call.id, tenantId: call.tenantId, status: 'authorized' },
    data: { status: 'blocked', blockedReasons: reasons },
  });
}

/** A caller ID from the tenant's own numbers: one in the dialled number's country first, then any outbound-capable one. */
async function pickCallerId(tenantId: string, numberCountry: string | null): Promise<string | null> {
  const numbers = await prisma.telephonyNumber.findMany({
    where: { tenantId, isActive: true, purpose: { in: ['outbound', 'both'] } },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { e164: true, country: true },
  });
  const wanted = numberCountry?.toUpperCase();
  return (numbers.find((n) => wanted && n.country.toUpperCase() === wanted) ?? numbers[0])?.e164 ?? null;
}

export async function handleParkedCall(event: TelnyxEvent, now: Date = new Date()): Promise<ParkedOutcome> {
  let callId: string | null = null;
  try {
    const outcome = await connectIfAllowed(event, now, (id) => {
      callId = id;
    });
    if (outcome.action === 'hung_up') await hangUp(event);
    return outcome;
  } catch (error) {
    console.error('[telephony] parked call failed closed', {
      eventId: event.providerEventId,
      error: error instanceof Error ? error.message : String(error),
    });
    await hangUp(event);
    return { action: 'hung_up', reason: 'error', callId };
  }
}

async function connectIfAllowed(event: TelnyxEvent, now: Date, noteCall: (id: string) => void): Promise<ParkedOutcome> {
  if (!event.controlId) return { action: 'hung_up', reason: 'no_control_id', callId: null };

  const token = verifyCallToken(fromClientState(event.clientState), Math.floor(now.getTime() / 1000));
  if (!token.ok) return { action: 'hung_up', reason: `token_${token.reason}`, callId: null };
  const { claims } = token;

  return asTenant(claims.tenantId, async () => {
    const call = await prisma.call.findFirst({ where: { id: claims.callId, tenantId: claims.tenantId } });
    if (!call) return { action: 'hung_up', reason: 'unknown_call', callId: null } as const;
    noteCall(call.id);

    const refuse = async (reason: string, reasons: string[] = [reason]) => {
      await block(call, reasons);
      return { action: 'hung_up', reason, callId: call.id } as const;
    };

    // What the token says must be what the row says, and what the rep's phone is dialling.
    if (call.direction !== 'outbound' || call.status !== 'authorized') return { action: 'hung_up', reason: 'not_authorized', callId: call.id } as const;
    if (call.userId !== claims.userId || call.toE164 !== claims.toE164 || !call.leadId) return refuse('token_mismatch');
    if (digits(event.to) !== digits(call.toE164)) return refuse('destination_mismatch');

    const user = await prisma.user.findFirst({
      where: { id: claims.userId, tenantId: claims.tenantId, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    if (!user) return refuse('user_inactive');
    const credential = await prisma.telephonyCredential.findFirst({
      where: { tenantId: claims.tenantId, userId: user.id, status: 'active', revokedAt: null },
      select: { sipUsername: true },
    });
    if (!credential) return refuse('no_credential');
    // The call must come from this rep's own login, not another rep's browser holding a copied token.
    if (event.from && !event.from.toLowerCase().includes(credential.sipUsername.toLowerCase())) return refuse('credential_mismatch');

    const sessionUser: SessionUser & { tenantId: string } = { ...user, tenantId: claims.tenantId };
    const { decision } = await loadCallGate({ user: sessionUser, leadId: call.leadId, contactId: call.contactId ?? undefined, now });
    if (!decision.allowed || decision.dryRun || decision.toE164 !== call.toE164) {
      return refuse('gate', [...decision.reasons, ...(decision.dryRun ? ['dry_run'] : [])]);
    }

    const fromE164 = await pickCallerId(claims.tenantId, decision.numberCountry);

    // The claim: only one webhook can move this row out of `authorized`.
    const claimed = await prisma.call.updateMany({
      where: { id: call.id, tenantId: call.tenantId, status: 'authorized' },
      data: { status: 'initiated', initiatedAt: now, providerSessionId: event.sessionId, providerControlId: event.controlId, fromE164 },
    });
    if (claimed.count === 0) return { action: 'hung_up', reason: 'token_reused', callId: call.id } as const;

    try {
      await getTelephonyProvider().command(
        event.controlId!,
        { action: 'transfer', to: call.toE164, ...(fromE164 ? { from: fromE164 } : {}), timeoutSecs: RING_TIMEOUT_SECONDS, clientState: legClientState(call.id) },
        // The same id on a retry or a redelivery makes the provider ignore the second transfer.
        `transfer:${call.id}`
      );
    } catch (error) {
      console.error('[telephony] could not connect an authorized call', { callId: call.id, error: error instanceof Error ? error.message : String(error) });
      // Nothing was dialled: end it here, and leave `initiatedAt` empty so it is not counted as an attempt.
      await prisma.call.updateMany({
        where: { id: call.id, tenantId: call.tenantId, status: 'initiated' },
        data: { status: 'failed', initiatedAt: null, endedAt: now, hangupCause: 'connect_failed', billedDurationSec: 0 },
      });
      return { action: 'hung_up', reason: 'connect_failed', callId: call.id } as const;
    }
    return { action: 'connected', callId: call.id } as const;
  });
}
