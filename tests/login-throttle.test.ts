import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  evaluateThrottle,
  normalizeEmail,
  progressiveDelayMs,
  throttleKey,
  THRESHOLDS,
  GENERIC_LOGIN_FAILURE,
  type ThrottleCounts,
} from '@/lib/auth/loginThrottle';
import {
  __setThrottleRedis,
  clearOnSuccess,
  clientIpFrom,
  getFailureCounts,
  recordFailure,
} from '@/lib/auth/loginThrottleStore';

const counts = (over: Partial<ThrottleCounts> = {}): ThrottleCounts => ({
  pair: 0,
  ip: 0,
  email: 0,
  ...over,
});

describe('evaluateThrottle — normal use', () => {
  it('lets a clean attempt straight through', () => {
    const d = evaluateThrottle(counts());
    expect(d.allowed).toBe(true);
    expect(d.delayMs).toBe(0);
    expect(d.alert).toBe(false);
  });

  it('does not delay a user who mistypes once or twice', () => {
    // Everyday typos must not be punished, or the throttle becomes a support burden.
    expect(evaluateThrottle(counts({ pair: 1 })).delayMs).toBe(0);
    expect(evaluateThrottle(counts({ pair: THRESHOLDS.pair.delayAfter })).delayMs).toBe(0);
  });
});

describe('evaluateThrottle — progressive delay', () => {
  it('starts delaying once a scope passes its threshold', () => {
    const d = evaluateThrottle(counts({ pair: THRESHOLDS.pair.delayAfter + 1 }));
    expect(d.allowed).toBe(true);
    expect(d.delayMs).toBeGreaterThan(0);
  });

  it('grows the delay with each further failure, then caps it', () => {
    const at = (n: number) => progressiveDelayMs(n, 0);
    expect(at(1)).toBeLessThan(at(2));
    expect(at(2)).toBeLessThan(at(3));
    // Uncapped doubling would tie up a request slot per attempt and hand the attacker a
    // cheaper denial of service than the one being prevented.
    expect(at(50)).toBe(at(99));
    expect(at(50)).toBeLessThanOrEqual(8_000);
  });

  it('takes the largest delay across scopes, not the first', () => {
    const d = evaluateThrottle(
      counts({ pair: THRESHOLDS.pair.delayAfter + 1, email: THRESHOLDS.email.delayAfter + 6 })
    );
    expect(d.delayMs).toBe(
      Math.max(
        progressiveDelayMs(THRESHOLDS.pair.delayAfter + 1, THRESHOLDS.pair.delayAfter),
        progressiveDelayMs(THRESHOLDS.email.delayAfter + 6, THRESHOLDS.email.delayAfter)
      )
    );
  });
});

describe('evaluateThrottle — locking', () => {
  it('locks a single client grinding a single account', () => {
    const d = evaluateThrottle(counts({ pair: THRESHOLDS.pair.lockAfter }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('pair');
    expect(d.lockedForMs).toBeGreaterThan(0);
  });

  it('locks one address spraying many accounts', () => {
    const d = evaluateThrottle(counts({ ip: THRESHOLDS.ip.lockAfter }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('ip');
  });

  it('tolerates more failures per IP than per pair, for shared egress', () => {
    // One office NAT or VPN exit carries many people. Locking it takes them all out.
    expect(THRESHOLDS.ip.lockAfter).toBeGreaterThan(THRESHOLDS.pair.lockAfter);
  });
});

describe('evaluateThrottle — the two denial-of-service traps', () => {
  it('never locks an account no matter how many failures it accumulates', () => {
    // The trap: if a failing email locks, anyone who knows a colleague's address can lock
    // them out of the CRM. The throttle would become a weapon aimed at your own staff.
    for (const n of [50, 500, 5_000, 1_000_000]) {
      const d = evaluateThrottle(counts({ email: n }));
      expect(d.allowed).toBe(true);
      expect(d.lockedForMs).toBe(0);
    }
  });

  it('raises an alert instead, since that scope can never lock', () => {
    expect(evaluateThrottle(counts({ email: THRESHOLDS.email.alertAfter })).alert).toBe(true);
    expect(evaluateThrottle(counts({ email: THRESHOLDS.email.alertAfter - 1 })).alert).toBe(false);
  });

  it('stops one IP before it can work through the whole user table', () => {
    // The mirror trap: an attacker spraying many accounts from one address must be cut
    // off by their own IP counter well before they enumerate everyone.
    const sprayed = counts({ ip: THRESHOLDS.ip.lockAfter, pair: 1, email: 1 });
    expect(evaluateThrottle(sprayed).allowed).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('folds case and trims, so capitalisation is not a fresh budget', () => {
    expect(normalizeEmail('  Sonny@Telestar.VN ')).toBe('sonny@telestar.vn');
  });

  it('keeps plus-addressing distinct', () => {
    // Provider-specific aliasing; merging them would conflate genuinely separate accounts.
    expect(normalizeEmail('a+x@b.com')).not.toBe(normalizeEmail('a@b.com'));
  });

  it('counts differently-cased spellings as one bucket', () => {
    expect(throttleKey('email', '1.1.1.1', 'A@B.com')).toBe(
      throttleKey('email', '1.1.1.1', 'a@b.com')
    );
  });
});

describe('throttleKey', () => {
  it('never stores the address in clear', () => {
    const key = throttleKey('email', '1.1.1.1', 'sonny@telestar.vn');
    expect(key).not.toContain('sonny');
    expect(key).not.toContain('telestar.vn');
  });

  it('separates the three scopes', () => {
    const k = (s: 'pair' | 'ip' | 'email') => throttleKey(s, '1.1.1.1', 'a@b.com');
    expect(new Set([k('pair'), k('ip'), k('email')]).size).toBe(3);
  });

  it('keys the IP scope on the address alone, so it spans accounts', () => {
    expect(throttleKey('ip', '1.1.1.1', 'a@b.com')).toBe(throttleKey('ip', '1.1.1.1', 'z@z.com'));
  });
});

describe('clientIpFrom', () => {
  it('takes the last hop, which the trusted proxy appended', () => {
    // The leftmost entries are client-supplied and forgeable; trusting them would let an
    // attacker rotate a header value for a fresh budget on every request.
    const h = new Headers({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1, 203.0.113.7' });
    expect(clientIpFrom(h)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip, then to a constant', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIpFrom(new Headers())).toBe('unknown');
  });
});

describe('store', () => {
  const redis = {
    data: new Map<string, number>(),
    get: vi.fn(),
    mget: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
    del: vi.fn(),
  };

  beforeEach(() => {
    redis.data.clear();
    vi.clearAllMocks();
    redis.mget.mockImplementation(async (...keys: string[]) =>
      keys.map((k) => (redis.data.has(k) ? String(redis.data.get(k)) : null))
    );
    redis.incr.mockImplementation(async (k: string) => {
      const n = (redis.data.get(k) ?? 0) + 1;
      redis.data.set(k, n);
      return n;
    });
    redis.expire.mockResolvedValue(1);
    redis.del.mockImplementation(async (...keys: string[]) => {
      keys.forEach((k) => redis.data.delete(k));
      return keys.length;
    });
    __setThrottleRedis(redis as never);
  });

  it('counts a failure against all three scopes', async () => {
    await recordFailure('1.1.1.1', 'a@b.com');
    expect(await getFailureCounts('1.1.1.1', 'a@b.com')).toEqual({ pair: 1, ip: 1, email: 1 });
  });

  it('sets the expiry once, so a sustained attack cannot push the window out', async () => {
    await recordFailure('1.1.1.1', 'a@b.com');
    await recordFailure('1.1.1.1', 'a@b.com');
    await recordFailure('1.1.1.1', 'a@b.com');
    // Three failures x three scopes = 9 increments, but only the first per key sets a TTL.
    expect(redis.incr).toHaveBeenCalledTimes(9);
    expect(redis.expire).toHaveBeenCalledTimes(3);
  });

  it('shares counters across instances', async () => {
    // Same backing store, two callers — an in-process Map would give each a fresh budget.
    await recordFailure('1.1.1.1', 'a@b.com');
    await recordFailure('1.1.1.1', 'a@b.com');
    expect((await getFailureCounts('1.1.1.1', 'a@b.com')).pair).toBe(2);
  });

  it('clears the account scopes on success but keeps the IP counter', async () => {
    // Clearing the IP scope on success would let an attacker holding one valid credential
    // reset their spray budget at will.
    await recordFailure('1.1.1.1', 'a@b.com');
    await clearOnSuccess('1.1.1.1', 'a@b.com');
    const after = await getFailureCounts('1.1.1.1', 'a@b.com');
    expect(after.pair).toBe(0);
    expect(after.email).toBe(0);
    expect(after.ip).toBe(1);
  });

  it('fails open when Redis is unreachable', async () => {
    // A cache outage must degrade rate limiting, not authentication. Failing closed would
    // turn a Redis blip into a total lockout.
    redis.mget.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await getFailureCounts('1.1.1.1', 'a@b.com')).toEqual({ pair: 0, ip: 0, email: 0 });
  });

  it('does not throw when recording fails', async () => {
    redis.incr.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(recordFailure('1.1.1.1', 'a@b.com')).resolves.toBeUndefined();
  });
});

describe('user-facing failure message', () => {
  it('is one string, so it cannot vary by cause', () => {
    // Any variation between "no such account", "wrong password" and "throttled" turns the
    // login form into an account-enumeration oracle.
    expect(GENERIC_LOGIN_FAILURE).toBe('Invalid email or password.');
    expect(GENERIC_LOGIN_FAILURE).not.toMatch(/locked|throttl|attempt|exist|unknown/i);
  });
});
