/**
 * Shared AI provider circuit state (TEL-P1-017).
 *
 * The circuit breaker kept its state in a process-local `Map` and its HALF_OPEN probe lease
 * in a process-local `Set`. Neither coordinates anything beyond one Node process, so:
 *
 *   - instance A opening a circuit did not stop instance B hammering the same dead provider;
 *   - every instance sent its own probe the moment the reset timeout elapsed, so a
 *     recovering provider was hit by N simultaneous probes rather than one.
 *
 * Redis is already an operational dependency (BullMQ), so shared state lives there.
 *
 * ## Behaviour when Redis is unavailable
 *
 * Explicitly **fail open to local-only behaviour**: the breaker keeps working exactly as it
 * did before, per process, and the degradation is logged. Failing closed would convert a
 * Redis blip into a total AI outage, and "AI down must never mean CRM down" cuts the other
 * way too - a cache outage must not become a product outage. Correctness lost is
 * coordination, not safety: each process still protects itself.
 */

import type { Redis } from 'ioredis';

export type SharedCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface SharedCircuitRecord {
  state: SharedCircuitState;
  consecutiveFailures: number;
  lastFailureTime: number | null;
  openedAt: number | null;
}

/** Only the commands this module uses, so tests can supply a small fake. */
export type CircuitRedis = Pick<Redis, 'hgetall' | 'hset' | 'del' | 'set' | 'keys' | 'pexpire'>;

const KEY_PREFIX = 'ai:circuit:';
const PROBE_PREFIX = 'ai:circuit:probe:';

/** Circuit records outlive a short outage but must not accumulate forever. */
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

let client: CircuitRedis | null = null;
let unavailableLogged = false;

/** Override the client - tests only. Pass null to restore the real one. */
export function __setCircuitRedis(fake: CircuitRedis | null): void {
  client = fake;
  unavailableLogged = false;
}

async function getClient(): Promise<CircuitRedis | null> {
  if (client) return client;
  try {
    const { getConnection } = await import('@/lib/bullmq/connection');
    client = getConnection();
    return client;
  } catch (error) {
    if (!unavailableLogged) {
      unavailableLogged = true;
      console.error(
        '[ai-circuit] Redis unavailable; circuit state is process-local until it returns:',
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
}

export function circuitKey(provider: string, modelId?: string): string {
  return modelId ? `${provider}:${modelId}` : provider;
}

/**
 * Reads every shared circuit record.
 *
 * Returns an empty map when Redis is unreachable, which leaves the caller on its local
 * view rather than erasing it.
 */
export async function readSharedCircuits(): Promise<Record<string, SharedCircuitRecord>> {
  const redis = await getClient();
  if (!redis) return {};

  try {
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    const circuitKeys = keys.filter((key) => !key.startsWith(PROBE_PREFIX));
    const records: Record<string, SharedCircuitRecord> = {};

    for (const key of circuitKeys) {
      const raw = await redis.hgetall(key);
      if (!raw || !raw.state) continue;
      records[key.slice(KEY_PREFIX.length)] = {
        state: raw.state as SharedCircuitState,
        consecutiveFailures: Number(raw.consecutiveFailures ?? 0),
        lastFailureTime: raw.lastFailureTime ? Number(raw.lastFailureTime) : null,
        openedAt: raw.openedAt ? Number(raw.openedAt) : null,
      };
    }
    return records;
  } catch (error) {
    console.error(
      '[ai-circuit] failed to read shared circuit state:',
      error instanceof Error ? error.message : error,
    );
    return {};
  }
}

/** Publishes one circuit's state so other instances observe it. */
export async function publishSharedCircuit(
  key: string,
  record: SharedCircuitRecord,
): Promise<boolean> {
  const redis = await getClient();
  if (!redis) return false;

  try {
    const redisKey = `${KEY_PREFIX}${key}`;
    await redis.hset(redisKey, {
      state: record.state,
      consecutiveFailures: String(record.consecutiveFailures),
      lastFailureTime: record.lastFailureTime === null ? '' : String(record.lastFailureTime),
      openedAt: record.openedAt === null ? '' : String(record.openedAt),
    });
    await redis.pexpire(redisKey, RECORD_TTL_MS);
    return true;
  } catch (error) {
    console.error(
      '[ai-circuit] failed to publish circuit state:',
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Grants the HALF_OPEN probe to exactly one instance.
 *
 * `SET key value NX PX ttl` is atomic: the first caller creates the key and every other
 * caller sees it already present, so a recovering provider receives one probe rather than
 * one per replica. The TTL means a crashed prober cannot hold the lease forever.
 *
 * With Redis unreachable this returns `true` - the caller falls back to its local lease,
 * which is the pre-existing single-process behaviour.
 */
export async function tryAcquireProbeLease(key: string, ttlMs: number): Promise<boolean> {
  const redis = await getClient();
  if (!redis) return true;

  try {
    const result = await redis.set(`${PROBE_PREFIX}${key}`, String(process.pid), 'PX', ttlMs, 'NX');
    return result === 'OK';
  } catch (error) {
    console.error(
      '[ai-circuit] failed to acquire probe lease:',
      error instanceof Error ? error.message : error,
    );
    return true;
  }
}

/** Releases a probe lease once the probe has resolved, so recovery is not delayed. */
export async function releaseProbeLease(key: string): Promise<void> {
  const redis = await getClient();
  if (!redis) return;
  try {
    await redis.del(`${PROBE_PREFIX}${key}`);
  } catch (error) {
    console.error(
      '[ai-circuit] failed to release probe lease:',
      error instanceof Error ? error.message : error,
    );
  }
}

/** Clears all shared circuit state. Test and operational-reset use only. */
export async function clearSharedCircuits(): Promise<void> {
  const redis = await getClient();
  if (!redis) return;
  try {
    const keys = await redis.keys(`${KEY_PREFIX}*`);
    for (const key of keys) await redis.del(key);
  } catch (error) {
    console.error(
      '[ai-circuit] failed to clear shared circuit state:',
      error instanceof Error ? error.message : error,
    );
  }
}
