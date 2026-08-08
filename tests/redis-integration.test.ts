/**
 * The only test in this repository that talks to a real Redis.
 *
 * Every other BullMQ suite mocks `bullmq` (`tests/bullmq.test.ts`, `tests/admin.test.ts`,
 * `tests/run-now-immediate.test.ts`), and `tests/redis-readiness.test.ts` only exercises
 * `assertUsableRedisUrl` and `getRedisConfig` — configuration, never a connection. That left
 * a gap with real consequences: an ioredis or BullMQ upgrade could change wire behaviour and
 * every gate would still be green, because nothing enqueued a job and watched it come back.
 *
 * This is the test that has to fail when that happens. It deliberately runs the *production*
 * helpers — `getRedisConfig()` and `collectQueueMetrics()` — rather than reimplementing them,
 * so a reply shape that changes under a new protocol surfaces here as a failed assertion.
 *
 * Written while holding the ioredis 6 bump, which switches to RESP3 by default.
 *
 * CI provides `redis:7` and `REDIS_URL`. Locally there is usually no Redis, so the suite
 * skips — but it must never skip silently on CI, where the whole point is that it runs.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { getRedisConfig } from '@/lib/bullmq/connection';
import { collectQueueMetrics } from '@/lib/bullmq/metrics';

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
  probe.on('error', () => {}); // Without a handler an unreachable host throws unhandled.
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
    'REDIS_URL is unreachable on CI. This suite is the only real-Redis coverage in the ' +
      'repository; skipping it here would turn a broken service container into a green run.'
  );
}

describe.skipIf(!reachable)('BullMQ against a real Redis', () => {
  // A unique name per run: these tests must not collide with each other, with a developer's
  // local queues, or with a concurrently running CI job on a shared instance.
  const queueName = `test-integration-${process.pid}-${Date.now()}`;
  let client: Redis;
  let queue: Queue;

  beforeAll(async () => {
    const { url, opts } = getRedisConfig();
    client = new Redis(url, opts);
    await client.connect();
    queue = new Queue(queueName, { connection: client });
  });

  afterAll(async () => {
    // obliterate() removes the keys themselves. close() alone would leave this run's queue
    // behind on a long-lived instance, once per test run, forever.
    await queue?.obliterate({ force: true }).catch(() => {});
    await queue?.close().catch(() => {});
    await client?.quit().catch(() => {});
  });

  it('round-trips a job through a real worker and returns its result', async () => {
    // Arrange: a worker gets its own connection — BullMQ's blocking reads cannot share one.
    const { url, opts } = getRedisConfig();
    const workerConnection = new Redis(url, opts);
    const processed: string[] = [];

    const worker = new Worker(
      queueName,
      async (job) => {
        processed.push(job.name);
        return { echoed: job.data.value };
      },
      { connection: workerConnection },
    );

    try {
      // Act
      const completed = new Promise<{ echoed: string }>((resolve, reject) => {
        worker.on('completed', (_job, result) => resolve(result));
        worker.on('failed', (_job, err) => reject(err));
      });
      await queue.add('echo', { value: 'hello' });
      const result = await completed;

      // Assert: the payload survived the round trip, not merely that something ran.
      expect(result).toEqual({ echoed: 'hello' });
      expect(processed).toEqual(['echo']);
    } finally {
      await worker.close();
      await workerConnection.quit().catch(() => {});
    }
  });

  it('reports a waiting job through collectQueueMetrics with a real age', async () => {
    // Arrange: pause first so the job stays waiting and cannot be consumed mid-assertion.
    await queue.pause();
    await queue.add('stuck', { value: 'waiting' });

    // Act: the production observability path, not a reimplementation of it.
    const metrics = await collectQueueMetrics(queueName, queue);

    // Assert: this is the shape /api/admin/worker-health depends on. `oldestWaitingAgeMs`
    // comes from getWaiting()[0].timestamp, which is exactly the kind of reply a protocol
    // change reshapes — a null here means the alerting cannot see a stalled queue.
    expect(metrics.error).toBeUndefined();
    expect(metrics.waiting).toBeGreaterThanOrEqual(1);
    expect(metrics.oldestWaitingAgeMs).not.toBeNull();
    expect(metrics.oldestWaitingAgeMs).toBeGreaterThanOrEqual(0);

    await queue.resume();
  });

  it('holds a delayed job in the delayed set, then runs it', async () => {
    // Delayed jobs are the one thing a Redis outage genuinely costs this system — the
    // maintenance `missing-delayed` repair exists to rebuild them from Task. They live in a
    // sorted set and move by score, which is a different code path from the waiting list.
    const { url, opts } = getRedisConfig();
    const workerConnection = new Redis(url, opts);
    const delayedQueueName = `${queueName}-delayed`;
    const delayedQueue = new Queue(delayedQueueName, { connection: client });

    try {
      // Arrange + Act: long enough to observe the delayed state, short enough to wait out.
      await delayedQueue.add('later', { value: 'delayed' }, { delay: 400 });

      // Assert: it is delayed, not waiting. A job that lands in `waiting` here would run
      // immediately in production — the schedule silently collapsing to "now".
      const counts = await delayedQueue.getJobCounts();
      expect(counts.delayed).toBe(1);
      expect(counts.waiting ?? 0).toBe(0);

      const worker = new Worker(delayedQueueName, async (job) => ({ ran: job.data.value }), {
        connection: workerConnection,
      });
      try {
        const result = await new Promise<{ ran: string }>((resolve, reject) => {
          worker.on('completed', (_job, r) => resolve(r));
          worker.on('failed', (_job, err) => reject(err));
        });
        expect(result).toEqual({ ran: 'delayed' });
      } finally {
        await worker.close();
      }
    } finally {
      await delayedQueue.obliterate({ force: true }).catch(() => {});
      await delayedQueue.close().catch(() => {});
      await workerConnection.quit().catch(() => {});
    }
  });

  it('retries a failing job and reports the attempt count', async () => {
    // Every worker in this system must be idempotent and retry-safe, so the retry counter
    // is load-bearing rather than cosmetic: attemptsMade is what distinguishes a first run
    // from a replay. It is stored on the job hash and incremented server-side.
    const { url, opts } = getRedisConfig();
    const workerConnection = new Redis(url, opts);
    const retryQueueName = `${queueName}-retry`;
    const retryQueue = new Queue(retryQueueName, { connection: client });
    const attempts: number[] = [];

    const worker = new Worker(
      retryQueueName,
      async (job) => {
        attempts.push(job.attemptsMade);
        if (job.attemptsMade < 1) throw new Error('first attempt fails on purpose');
        return { attemptsMade: job.attemptsMade };
      },
      { connection: workerConnection },
    );

    try {
      // Act
      const completed = new Promise<{ attemptsMade: number }>((resolve, reject) => {
        worker.on('completed', (_job, result) => resolve(result));
        // Only the final failure ends the test; the first one is expected.
        worker.on('failed', (job, err) => {
          if ((job?.attemptsMade ?? 0) >= 2) reject(err);
        });
      });
      await retryQueue.add(
        'flaky',
        { value: 'retry' },
        { attempts: 2, backoff: { type: 'fixed', delay: 100 } },
      );
      const result = await completed;

      // Assert: it ran twice and the second run succeeded — not that it merely finished.
      // Deliberately not asserting the absolute value of attemptsMade: its base has moved
      // between BullMQ versions, and pinning it here would make this test fail on an
      // upgrade that changed nothing about the behaviour we actually depend on.
      expect(attempts).toHaveLength(2);
      expect(attempts[1]).toBeGreaterThan(attempts[0]);
      expect(result.attemptsMade).toBe(attempts[1]);
    } finally {
      await worker.close();
      await retryQueue.obliterate({ force: true }).catch(() => {});
      await retryQueue.close().catch(() => {});
      await workerConnection.quit().catch(() => {});
    }
  });
});
