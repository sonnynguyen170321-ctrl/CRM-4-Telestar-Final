import { createPublicKey, verify as verifySignature, type KeyObject } from 'node:crypto';

/**
 * Telnyx webhook signature verification.
 *
 * Telnyx signs `${telnyx-timestamp}|${rawBody}` with Ed25519 and sends the signature base64 in
 * `telnyx-signature-ed25519`. The public key in the portal is the raw 32-byte key, base64; Node
 * wants it wrapped as SPKI DER, which for Ed25519 is a fixed 12-byte prefix in front of it.
 *
 * Verify the raw body exactly as received — re-serialising parsed JSON changes the bytes and the
 * signature no longer matches. A timestamp more than five minutes from now is refused, so a captured
 * webhook cannot be replayed later.
 */

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
export const MAX_WEBHOOK_SKEW_SECONDS = 300;

export type WebhookCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_headers' | 'bad_timestamp' | 'stale' | 'bad_signature' | 'bad_key' };

function publicKeyFrom(base64Key: string): KeyObject | null {
  const raw = Buffer.from(base64Key, 'base64');
  if (raw.length !== 32) return null;
  try {
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

export function verifyTelnyxWebhook(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string;
  nowSeconds?: number;
}): WebhookCheck {
  if (!input.signature || !input.timestamp) return { ok: false, reason: 'missing_headers' };
  if (!/^\d+$/.test(input.timestamp)) return { ok: false, reason: 'bad_timestamp' };
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(input.timestamp)) > MAX_WEBHOOK_SKEW_SECONDS) return { ok: false, reason: 'stale' };

  const key = publicKeyFrom(input.publicKey);
  if (!key) return { ok: false, reason: 'bad_key' };

  let signature: Buffer;
  try {
    signature = Buffer.from(input.signature, 'base64');
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
  const message = Buffer.from(`${input.timestamp}|${input.rawBody}`, 'utf8');
  try {
    return verifySignature(null, message, key, signature) ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}
