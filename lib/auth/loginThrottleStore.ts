/**
 * Shared failure counters for login throttling.
 *
 * State lives in Redis because the web tier is serverless and horizontally scaled: an
 * in-process counter would give an attacker a fresh budget on every instance, which is no
 * throttle at all. The plan's "limits shared across instances" requirement is the reason
 * this is not a Map.
 *
 * Policy lives in `loginThrottle.ts`; this module only counts.
 */

import type { Redis } from 'ioredis';
import {
  FAILURE_WINDOW_SECONDS,
  throttleKey,
  type ThrottleCounts,
  type ThrottleScope,
} from './loginThrottle';

const SCOPES: ThrottleScope[] = ['pair', 'ip', 'email'];

/** Injected so tests can drive this with a fake, and so the client is created lazily. */
export type ThrottleRedis = Pick<Redis, 'get' | 'incr' | 'expire' | 'del' | 'mget'>;

let client: ThrottleRedis | null = null;

/** Override the client — tests only. Pass null to restore the real one. */
export function __setThrottleRedis(fake: ThrottleRedis | null): void {
  client = fake;
}

async function getClient(): Promise<ThrottleRedis | null> {
  if (client) return client;
  try {
    const { getConnection } = await import('@/lib/bullmq/connection');
    client = getConnection();
    return client;
  } catch (err) {
    console.error('[login-throttle] Redis unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Read the current failure count for all three scopes.
 *
 * Returns zeros when Redis is unreachable — the throttle **fails open**.
 *
 * That is a deliberate availability trade, not an oversight. Failing closed would mean a
 * Redis blip locks every user out of the CRM, converting a cache outage into a total
 * outage and handing an attacker a cheaper denial of service than the one being prevented.
 * Passwords are still verified, so a Redis outage degrades rate limiting, not
 * authentication. It is logged loudly so the gap is visible rather than silent.
 */
export async function getFailureCounts(ip: string, email: string): Promise<ThrottleCounts> {
  const redis = await getClient();
  if (!redis) return { pair: 0, ip: 0, email: 0 };

  try {
    const keys = SCOPES.map((s) => throttleKey(s, ip, email));
    const values = await redis.mget(...keys);
    return {
      pair: Number(values[0] ?? 0),
      ip: Number(values[1] ?? 0),
      email: Number(values[2] ?? 0),
    };
  } catch (err) {
    console.error('[login-throttle] count read failed, failing open:', err instanceof Error ? err.message : err);
    return { pair: 0, ip: 0, email: 0 };
  }
}

/** Count a failed attempt against all three scopes. Each key expires on its own window. */
export async function recordFailure(ip: string, email: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  try {
    for (const scope of SCOPES) {
      const key = throttleKey(scope, ip, email);
      const n = await redis.incr(key);
      // Set the TTL only on first write, so a sustained attack cannot keep pushing the
      // expiry out — the window is rolling per key, not per attempt.
      if (n === 1) await redis.expire(key, FAILURE_WINDOW_SECONDS);
    }
  } catch (err) {
    console.error('[login-throttle] failure record failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Clear counters after a successful sign-in.
 *
 * Clears `pair` and `email`, **not** `ip`.
 *
 * Clearing the IP counter on success would let an attacker who holds one valid credential
 * reset their spray budget at will: fail against thirty accounts, log into the account
 * they own, repeat. The IP window is short and expires on its own, so leaving it is
 * cheap; the cost of clearing it is the whole point of having an IP scope.
 */
export async function clearOnSuccess(ip: string, email: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;

  try {
    await redis.del(throttleKey('pair', ip, email), throttleKey('email', ip, email));
  } catch (err) {
    console.error('[login-throttle] reset failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Best-effort client address from proxy headers.
 *
 * `x-forwarded-for` is client-controlled, so the LAST entry is the one the closest trusted
 * proxy appended and the leftmost entries can be forged. Caddy sits in front of the app
 * and appends the real peer, so taking the last hop is correct here — taking the first
 * would let an attacker rotate a header value and get a fresh budget per request.
 */
export function clientIpFrom(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return headers.get('x-real-ip')?.trim() || 'unknown';
}
