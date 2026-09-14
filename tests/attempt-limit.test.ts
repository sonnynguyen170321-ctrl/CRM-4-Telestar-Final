import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { consumeAttempt, clearAttempts, __setAttemptLimitRedis } from '@/lib/security/attemptLimit';

/**
 * The attempt limiter behind password-change and share-link password guesses.
 *
 * Two behaviours matter and neither is visible from the endpoints: the window must roll from the
 * first attempt and never be pushed out by later ones, and a Redis outage must fail *open* — the
 * same trade the login throttle makes, so a cache blip does not become a total outage.
 */

/** An in-memory stand-in for the four Redis calls the limiter uses. */
function fakeRedis() {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    counts,
    ttls,
    async incr(key: string) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return n;
    },
    async expire(key: string, seconds: number) {
      ttls.set(key, seconds);
      return 1;
    },
    async ttl(key: string) {
      return ttls.get(key) ?? -1;
    },
    async del(key: string) {
      counts.delete(key);
      ttls.delete(key);
      return 1;
    },
  };
}

const ARGS = { bucket: 'test', subject: 'user-1', limit: 3, windowSeconds: 900 } as const;

describe('consumeAttempt', () => {
  let redis: ReturnType<typeof fakeRedis>;

  beforeEach(() => {
    redis = fakeRedis();
    __setAttemptLimitRedis(redis);
  });

  afterEach(() => {
    __setAttemptLimitRedis(null);
    vi.restoreAllMocks();
  });

  it('allows up to the limit and then refuses', async () => {
    expect((await consumeAttempt(ARGS)).allowed).toBe(true);
    expect((await consumeAttempt(ARGS)).allowed).toBe(true);
    const last = await consumeAttempt(ARGS);
    expect(last).toEqual({ allowed: true, remaining: 0, retryAfterSeconds: 0 });

    const blocked = await consumeAttempt(ARGS);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBe(900);
  });

  it('sets the window on the first attempt only, so a sustained attack cannot extend it', async () => {
    const expire = vi.spyOn(redis, 'expire');
    for (let i = 0; i < 5; i++) await consumeAttempt(ARGS);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenCalledWith('attempts:test:user-1', 900);
  });

  it('keeps subjects and buckets apart', async () => {
    for (let i = 0; i < 3; i++) await consumeAttempt(ARGS);
    expect((await consumeAttempt(ARGS)).allowed).toBe(false);

    expect((await consumeAttempt({ ...ARGS, subject: 'user-2' })).allowed).toBe(true);
    expect((await consumeAttempt({ ...ARGS, bucket: 'other' })).allowed).toBe(true);
  });

  it('forgets a subject on clearAttempts', async () => {
    for (let i = 0; i < 3; i++) await consumeAttempt(ARGS);
    expect((await consumeAttempt(ARGS)).allowed).toBe(false);

    await clearAttempts(ARGS.bucket, ARGS.subject);

    expect((await consumeAttempt(ARGS)).allowed).toBe(true);
  });

  it('fails open when Redis throws, and says so', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(redis, 'incr').mockRejectedValue(new Error('READONLY You can\'t write against a read only replica'));

    const decision = await consumeAttempt(ARGS);

    expect(decision).toEqual({ allowed: true, remaining: 3, retryAfterSeconds: 0 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('failing open'), expect.any(String));
  });

  it('falls back to the window length when the key has no TTL to report', async () => {
    for (let i = 0; i < 4; i++) await consumeAttempt(ARGS);
    redis.ttls.clear();
    expect((await consumeAttempt(ARGS)).retryAfterSeconds).toBe(900);
  });
});
