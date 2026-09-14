import { clientIpFrom } from '@/lib/auth/loginThrottleStore';

/**
 * A small fixed-window attempt limiter for endpoints that guess at a secret.
 *
 * Login already has a limiter (`lib/auth/loginThrottle.ts`), and this does not replace it. That
 * one is built around the (ip, email) pair, with three scopes, progressive delay and a lockout
 * policy tuned to staff signing in — none of which transfers to "this user is retrying their own
 * current password" or "this visitor is guessing a share link's password". Reusing it would have
 * meant inventing a fake email for each caller.
 *
 * What is deliberately shared is the policy: the same Redis connection, the same rolling window
 * that cannot be pushed out by a sustained attack, and the same **fail-open** behaviour. Failing
 * closed on a Redis blip would convert a cache outage into a total outage and hand an attacker a
 * cheaper denial of service than the one being prevented. The guarded secret is still checked, so
 * an outage degrades rate limiting, not authentication — and it is logged so the gap is visible.
 */

export type AttemptDecision = {
  allowed: boolean;
  /** Attempts left in the current window. 0 once blocked. */
  remaining: number;
  /** Seconds until the window rolls over. Suitable for a Retry-After header. */
  retryAfterSeconds: number;
};

type LimiterRedis = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  del(key: string): Promise<unknown>;
};

let client: LimiterRedis | null = null;

/** Override the client — tests only. Pass null to restore the real one. */
export function __setAttemptLimitRedis(fake: LimiterRedis | null): void {
  client = fake;
}

async function getClient(): Promise<LimiterRedis | null> {
  if (client) return client;
  try {
    const { getConnection } = await import('@/lib/bullmq/connection');
    client = getConnection() as unknown as LimiterRedis;
    return client;
  } catch (err) {
    console.error('[attempt-limit] Redis unavailable:', err instanceof Error ? err.message : err);
    return null;
  }
}

function keyFor(bucket: string, subject: string): string {
  return `attempts:${bucket}:${subject}`;
}

/**
 * Count one attempt and say whether it may proceed.
 *
 * Call this *before* checking the secret, and only for attempts that can fail — counting a
 * successful action against the limit would lock a user out of their own correct password.
 */
export async function consumeAttempt(input: {
  /** What is being guarded, e.g. `password-change`, `share-link`. Namespaces the key. */
  bucket: string;
  /** Who or what is attempting: a user id, a token hash, an IP. Never a raw secret. */
  subject: string;
  limit: number;
  windowSeconds: number;
}): Promise<AttemptDecision> {
  const { bucket, subject, limit, windowSeconds } = input;
  const redis = await getClient();
  if (!redis) return { allowed: true, remaining: limit, retryAfterSeconds: 0 };

  const key = keyFor(bucket, subject);
  try {
    const count = await redis.incr(key);
    // TTL on first write only, so repeated attempts cannot keep pushing the expiry out.
    if (count === 1) await redis.expire(key, windowSeconds);

    if (count <= limit) {
      return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
    }

    const ttl = await redis.ttl(key);
    return { allowed: false, remaining: 0, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds };
  } catch (err) {
    console.error('[attempt-limit] failing open:', err instanceof Error ? err.message : err);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}

/** Forget the attempts for a subject. Call after the guarded secret was supplied correctly. */
export async function clearAttempts(bucket: string, subject: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;
  try {
    await redis.del(keyFor(bucket, subject));
  } catch (err) {
    console.error('[attempt-limit] clear failed:', err instanceof Error ? err.message : err);
  }
}

export { clientIpFrom };
