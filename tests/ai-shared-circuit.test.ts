/**
 * Shared AI circuit state across instances (TEL-P1-017).
 *
 * The breaker coordinated nothing beyond one Node process: its state was a `Map` and its
 * HALF_OPEN probe lease was a `Set`. Instance A opening a circuit did not stop instance B
 * hammering the same dead provider, and every instance sent its own probe the moment the
 * reset timeout elapsed.
 *
 * These tests run against a **real Redis** when `REDIS_URL` is reachable, because a fake
 * cannot prove that `SET NX PX` grants the lease to exactly one caller. They fall back to
 * an in-memory double only to keep the fail-open behaviour covered where Redis is absent -
 * and the certification ladder requires the real path (gate 09).
 */
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getRedisConfig } from '@/lib/bullmq/connection';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import {
  __setCircuitNamespace,
  __setCircuitRedis,
  clearSharedCircuits,
  publishSharedCircuit,
  readSharedCircuits,
  releaseProbeLease,
  tryAcquireProbeLease,
  type CircuitRedis,
} from '@/lib/ai/sharedCircuit';

const isCI = Boolean(process.env.CI);

/** A short-timeout probe, so a missing local Redis costs a second rather than a minute. */
async function isRedisReachable(): Promise<boolean> {
  const { url } = getRedisConfig();
  const probe = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    commandTimeout: 2_000,
    retryStrategy: () => null,
    maxRetriesPerRequest: null,
  });
  probe.on('error', () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

const reachable = await isRedisReachable();

// Skipping is correct on a developer machine and a lie on CI: there, an unreachable Redis
// means the service container is broken, and a silent skip would report that as success.
if (!reachable && isCI) {
  throw new Error(
    'REDIS_URL is unreachable on CI. Shared circuit coordination is the point of TEL-P1-017; ' +
      'skipping it here would turn a broken service container into a green run.',
  );
}

const client = reachable ? new Redis(getRedisConfig().url, { maxRetriesPerRequest: null }) : null;

afterAll(async () => {
  if (client) {
    __setCircuitRedis(client as unknown as CircuitRedis);
    await clearSharedCircuits().catch(() => undefined);
    client.disconnect();
  }
  __setCircuitRedis(null);
});

describe.skipIf(!reachable)('shared circuit state over real Redis', () => {
  beforeEach(async () => {
    __setCircuitRedis(client as unknown as CircuitRedis);
    // Its own namespace, so this file cannot open circuits for suites running beside it.
    __setCircuitNamespace('test-shared-circuit');
    await clearSharedCircuits();
    const leases = await client!.keys('ai:circuit:probe:*');
    for (const key of leases) await client!.del(key);
  });

  it('one instance publishes an open circuit and another observes it', async () => {
    // Instance A opens the circuit.
    await publishSharedCircuit('openai:gpt-4o-mini', {
      state: 'OPEN',
      consecutiveFailures: 3,
      lastFailureTime: Date.now(),
      openedAt: Date.now(),
    });

    // Instance B reads shared state and sees it.
    const observed = await readSharedCircuits();

    expect(observed['openai:gpt-4o-mini']).toBeDefined();
    expect(observed['openai:gpt-4o-mini'].state).toBe('OPEN');
    expect(observed['openai:gpt-4o-mini'].consecutiveFailures).toBe(3);
  });

  it('grants the HALF_OPEN probe to exactly one of many concurrent instances', async () => {
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () => tryAcquireProbeLease('groq:llama-3.3-70b-versatile', 30_000)),
    );

    expect(attempts.filter(Boolean)).toHaveLength(1);
    expect(attempts.filter((granted) => !granted)).toHaveLength(11);
  });

  it('lets the next instance probe once the lease is released', async () => {
    expect(await tryAcquireProbeLease('openai:probe-release', 30_000)).toBe(true);
    expect(await tryAcquireProbeLease('openai:probe-release', 30_000)).toBe(false);

    await releaseProbeLease('openai:probe-release');

    expect(await tryAcquireProbeLease('openai:probe-release', 30_000)).toBe(true);
  });

  it('expires a lease whose holder never came back', async () => {
    expect(await tryAcquireProbeLease('openai:probe-expiry', 300)).toBe(true);
    expect(await tryAcquireProbeLease('openai:probe-expiry', 300)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 500));

    // The TTL is what stops a crashed prober from blocking recovery forever.
    expect(await tryAcquireProbeLease('openai:probe-expiry', 300)).toBe(true);
  });

  it('reports a closed circuit so instances resume traffic together', async () => {
    await publishSharedCircuit('google:gemini-flash-latest', {
      state: 'OPEN',
      consecutiveFailures: 5,
      lastFailureTime: Date.now(),
      openedAt: Date.now(),
    });
    await publishSharedCircuit('google:gemini-flash-latest', {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureTime: null,
      openedAt: null,
    });

    const observed = await readSharedCircuits();
    expect(observed['google:gemini-flash-latest'].state).toBe('CLOSED');
    expect(observed['google:gemini-flash-latest'].consecutiveFailures).toBe(0);
  });
});

describe.skipIf(!reachable)('circuit state is namespaced per deployment', () => {
  beforeEach(async () => {
    __setCircuitRedis(client as unknown as CircuitRedis);
  });

  afterEach(() => {
    __setCircuitNamespace(null);
  });

  it('does not leak an open circuit from one namespace into another', async () => {
    // Sharing circuit state between instances of the same deployment is the feature.
    // Sharing it between different deployments on one Redis is a defect: a staging run that
    // exhausts a provider would open production's circuits. It is also what made the AI
    // suites interfere with each other, since a test process with no API keys opens every
    // circuit and the record then outlives the run by 24 hours.
    __setCircuitNamespace('deployment-a');
    await clearSharedCircuits();
    await publishSharedCircuit('openai:gpt-4o-mini', {
      state: 'OPEN',
      consecutiveFailures: 9,
      lastFailureTime: Date.now(),
      openedAt: Date.now(),
    });

    expect((await readSharedCircuits())['openai:gpt-4o-mini']?.state).toBe('OPEN');

    __setCircuitNamespace('deployment-b');
    expect(await readSharedCircuits()).toEqual({});
  });

  it('keeps probe leases separate across namespaces', async () => {
    __setCircuitNamespace('deployment-a');
    expect(await tryAcquireProbeLease('openai:gpt-4o-mini', 30_000)).toBe(true);
    expect(await tryAcquireProbeLease('openai:gpt-4o-mini', 30_000)).toBe(false);

    // A different deployment is entitled to its own probe.
    __setCircuitNamespace('deployment-b');
    expect(await tryAcquireProbeLease('openai:gpt-4o-mini', 30_000)).toBe(true);
  });

  it('clears only its own namespace', async () => {
    __setCircuitNamespace('deployment-a');
    await publishSharedCircuit('groq:llama-3.1-8b-instant', {
      state: 'OPEN',
      consecutiveFailures: 3,
      lastFailureTime: Date.now(),
      openedAt: Date.now(),
    });

    __setCircuitNamespace('deployment-b');
    await clearSharedCircuits();

    __setCircuitNamespace('deployment-a');
    expect((await readSharedCircuits())['groq:llama-3.1-8b-instant']?.state).toBe('OPEN');
    await clearSharedCircuits();
  });
});

describe('behaviour when Redis is unavailable is defined, not accidental', () => {
  afterEach(() => {
    __setCircuitRedis(null);
  });

  /** A client whose every command rejects, standing in for an unreachable Redis. */
  function brokenRedis(): CircuitRedis {
    const fail = () => Promise.reject(new Error('connection refused'));
    return {
      hgetall: fail,
      hset: fail,
      del: fail,
      set: fail,
      keys: fail,
      pexpire: fail,
    } as unknown as CircuitRedis;
  }

  it('reading returns no shared state rather than erasing the local view', async () => {
    __setCircuitRedis(brokenRedis());

    expect(await readSharedCircuits()).toEqual({});
  });

  it('publishing reports failure instead of throwing into the AI request path', async () => {
    __setCircuitRedis(brokenRedis());

    await expect(
      publishSharedCircuit('openai:gpt-4o-mini', {
        state: 'OPEN',
        consecutiveFailures: 3,
        lastFailureTime: Date.now(),
        openedAt: Date.now(),
      }),
    ).resolves.toBe(false);
  });

  it('grants the probe locally so a Redis outage does not become an AI outage', async () => {
    __setCircuitRedis(brokenRedis());

    // Fail open: the process falls back to its own single-process lease, which is exactly
    // the behaviour that existed before shared state. Failing closed would turn a cache
    // blip into a total AI outage.
    expect(await tryAcquireProbeLease('openai:gpt-4o-mini', 30_000)).toBe(true);
  });

  it('releasing a lease is a no-op rather than an error', async () => {
    __setCircuitRedis(brokenRedis());

    await expect(releaseProbeLease('openai:gpt-4o-mini')).resolves.toBeUndefined();
  });
});

/**
 * The probe marker `isAvailable` sets must always be released.
 *
 * `isAvailable` records, in a process-local set, that this instance is probing a recovering
 * model. Only `recordSuccess` and `recordFailure` clear it — and both describe the outcome of
 * a call. Every path that enters HALF_OPEN and then declines to call leaves the marker set,
 * and from then on `isAvailable` returns false for that model for the lifetime of the process.
 *
 * Found by running the provider-dependent chat journeys for the first time: the chat route
 * answered "Telestar AI is temporarily unavailable" in four milliseconds, for over two hours,
 * while the same three providers passed a CLI smoke test 14/14. The circuits in Redis had been
 * open since a single transient failure, long past the thirty-second reset.
 */
describe('the half-open probe marker is released on every path', () => {
  beforeEach(() => {
    __setCircuitRedis(null);
    circuitBreaker.reset();
  });

  afterEach(() => {
    __setCircuitRedis(null);
    circuitBreaker.reset();
  });

  /** Opens the circuit for one model and lets the reset timeout elapse. */
  function openLongAgo(provider: string, modelId: string): void {
    circuitBreaker.recordFailure(provider, modelId, true);
    const statuses = circuitBreaker.getStatuses();
    expect(statuses[`${provider}:${modelId}`].state).toBe('OPEN');
    // The breaker reads `lastFailureTime` first, so age the clock rather than the record.
    vi.setSystemTime(Date.now() + 60_000);
  }

  it('a model stays reachable after losing the probe race', async () => {
    vi.useFakeTimers();
    try {
      openLongAgo('groq', 'openai/gpt-oss-20b');

      // A recovering model: available, so the caller asks for the shared lease.
      expect(circuitBreaker.isAvailable('groq', 'openai/gpt-oss-20b')).toBe(true);

      // Another instance holds it. No call is made, so no outcome is recorded.
      __setCircuitRedis({
        hgetall: async () => ({}),
        hset: async () => 0,
        del: async () => 0,
        set: async () => null, // NX fails: the lease is taken
        keys: async () => [],
        pexpire: async () => 1,
      } as unknown as CircuitRedis);
      expect(await circuitBreaker.tryEnterHalfOpen('groq', 'openai/gpt-oss-20b')).toBe(false);

      // The next request must still be able to probe. Before the fix this was false forever.
      expect(circuitBreaker.isAvailable('groq', 'openai/gpt-oss-20b')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a model stays reachable after an attempt is abandoned before the call', async () => {
    vi.useFakeTimers();
    try {
      openLongAgo('openai', 'gpt-5.6-luna');
      expect(circuitBreaker.isAvailable('openai', 'gpt-5.6-luna')).toBe(true);

      // The gateway abandons this attempt — an unresolvable price, say — and releases.
      await circuitBreaker.exitHalfOpen('openai', 'gpt-5.6-luna');

      expect(circuitBreaker.isAvailable('openai', 'gpt-5.6-luna')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
