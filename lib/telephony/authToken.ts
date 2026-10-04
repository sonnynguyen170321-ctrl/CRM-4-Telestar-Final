import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The per-call token that ties what the server authorized to what the provider parks
 * (docs/dialer/ADR-001-park-and-authorize.md).
 *
 * `POST /api/telephony/calls` issues one after the compliance gate passes; the softphone sends it as
 * the call's client state; the webhook for the parked call only connects it if the token is valid,
 * unexpired, and names the same call, tenant, user and destination. HMAC-SHA256 under
 * `TELEPHONY_AUTH_SECRET`, compared in constant time.
 */

export const CALL_TOKEN_TTL_SECONDS = 120;

export type CallTokenClaims = {
  callId: string;
  tenantId: string;
  userId: string;
  toE164: string;
  /** Unix seconds. */
  expiresAt: number;
};

type Wire = { c: string; t: string; u: string; n: string; e: number };

export const MIN_AUTH_SECRET_LENGTH = 32;

/** The one test of a usable signing secret, shared by the signer, the flags and the deploy gate. */
export function isUsableAuthSecret(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() === value && value.length >= MIN_AUTH_SECRET_LENGTH;
}

function secret(): string {
  const value = process.env.TELEPHONY_AUTH_SECRET;
  if (!isUsableAuthSecret(value)) throw new Error('TELEPHONY_AUTH_SECRET is missing, shorter than 32 characters, or has surrounding whitespace');
  return value;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function issueCallToken(claims: Omit<CallTokenClaims, 'expiresAt'>, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const wire: Wire = { c: claims.callId, t: claims.tenantId, u: claims.userId, n: claims.toE164, e: nowSeconds + CALL_TOKEN_TTL_SECONDS };
  const payload = Buffer.from(JSON.stringify(wire), 'utf8').toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export type CallTokenCheck =
  | { ok: true; claims: CallTokenClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export function verifyCallToken(token: string | null | undefined, nowSeconds = Math.floor(Date.now() / 1000)): CallTokenCheck {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payload, signature] = parts;

  const expected = Buffer.from(sign(payload), 'utf8');
  const given = Buffer.from(signature, 'utf8');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false, reason: 'bad_signature' };

  let wire: Wire;
  try {
    wire = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Wire;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!wire || typeof wire !== 'object') return { ok: false, reason: 'malformed' };
  if (![wire.c, wire.t, wire.u, wire.n].every((v) => typeof v === 'string' && v) || typeof wire.e !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (nowSeconds >= wire.e) return { ok: false, reason: 'expired' };
  return { ok: true, claims: { callId: wire.c, tenantId: wire.t, userId: wire.u, toE164: wire.n, expiresAt: wire.e } };
}

/** The token as the browser SDK carries it: Telnyx `client_state` is base64. */
export function toClientState(token: string): string {
  return Buffer.from(token, 'utf8').toString('base64');
}

export function fromClientState(clientState: string | null | undefined): string | null {
  if (!clientState) return null;
  try {
    return Buffer.from(clientState, 'base64').toString('utf8');
  } catch {
    return null;
  }
}
