import 'server-only';

import type { Call } from '@prisma/client';

import type { SessionUser } from '@/lib/auth';
import { prisma, tenantStorage } from '@/lib/prisma';

import { fromClientState, verifyCallToken } from './authToken';
import { loadCallGate } from './gate';
import { getTelephonyProvider } from './index';
import { pickCallerId } from './callerId';
import { legClientState } from './legMarker';
import { safeError } from './safeError';
import type { TelnyxEvent } from './telnyx/events';
import { TelephonyProviderError } from './provider';

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
  /** The connect command's result is unknown (timeout, 5xx). Left `initiated` for the reconcile cron; not hung up, as the transfer may have gone through. */
  | { action: 'unknown'; reason: string; callId: string }
  | { action: 'hung_up'; reason: string; callId: string | null };


const MAX_FROM_LENGTH = 256;

/**
 * The user part of a SIP address (`sip:gencredX@sip.telnyx.com`, `<sip:gencredX@host>;tag=1`, `gencredX@host`),
 * lower-cased; null when `from` is missing, oversized or has no user part. Compared for equality, never as a substring.
 */
export function sipUserOf(from: string | null | undefined): string | null {
  if (!from || from.length > MAX_FROM_LENGTH) return null;
  let address = from.trim();
  const open = address.indexOf('<');
  if (open >= 0) {
    const close = address.indexOf('>', open);
    if (close < 0) return null;
    address = address.slice(open + 1, close).trim();
  } else {
    address = address.split(';')[0];
  }
  address = address.replace(/^sips?:/i, '');
  const at = address.indexOf('@');
  if (at <= 0) return null;
  const user = address.slice(0, at);
  return /^[A-Za-z0-9._~%+-]+$/.test(user) ? user.toLowerCase() : null;
}

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
      error: safeError(error),
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

export async function handleParkedCall(event: TelnyxEvent, now: Date = new Date()): Promise<ParkedOutcome> {
  let callId: string | null = null;
  try {
    const outcome = await connectIfAllowed(event, now, (id) => {
      callId = id;
    });
    if (outcome.action === 'hung_up') await hangUp(event);
    return outcome;
  } catch (error) {
    console.error('[telephony] parked call failed closed', { eventId: event.providerEventId, error: safeError(error) });
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

    // A refusal that is not provably the token holder's own attempt only hangs up the offending leg. The
    // row belongs to the rep it was authorized for; a copied or mismatched token must not cancel it.
    const hangUpOnly = (reason: string) => ({ action: 'hung_up', reason, callId: call.id }) as const;
    if (call.direction !== 'outbound' || call.status !== 'authorized') return hangUpOnly('not_authorized');
    if (call.userId !== claims.userId || call.toE164 !== claims.toE164 || !call.leadId) return hangUpOnly('token_mismatch');

    const user = await prisma.user.findFirst({
      where: { id: claims.userId, tenantId: claims.tenantId, isActive: true },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
    if (!user) return hangUpOnly('user_inactive');
    const credential = await prisma.telephonyCredential.findFirst({
      where: { tenantId: claims.tenantId, userId: user.id, status: 'active', revokedAt: null },
      select: { sipUsername: true },
    });
    if (!credential) return hangUpOnly('no_credential');
    // The call must come from this rep's own login, not another rep's browser holding a copied token.
    // Missing, oversized or different: hang up that leg and leave the rep's row alone.
    if (sipUserOf(event.from) !== credential.sipUsername.toLowerCase()) return hangUpOnly('credential_mismatch');
    // From here the token is valid and the call is the token holder's own, so a refusal is its verdict.
    if (digits(event.to) !== digits(call.toE164)) return refuse('destination_mismatch');

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
      console.error('[telephony] could not connect an authorized call', { callId: call.id, error: safeError(error) });
      // A timeout or a 5xx does not say whether the transfer happened. Leave the row `initiated`: events
      // finish it if it did, and the reconcile cron asks the provider if they never come.
      if (error instanceof TelephonyProviderError && error.retryable) return { action: 'unknown', reason: 'connect_unknown', callId: call.id } as const;
      // The provider refused: nothing was dialled. End it here, and leave `initiatedAt` empty so it is not counted as an attempt.
      await prisma.call.updateMany({
        where: { id: call.id, tenantId: call.tenantId, status: 'initiated' },
        data: { status: 'failed', initiatedAt: null, endedAt: now, hangupCause: 'connect_failed', billedDurationSec: 0 },
      });
      return { action: 'hung_up', reason: 'connect_failed', callId: call.id } as const;
    }
    return { action: 'connected', callId: call.id } as const;
  });
}
