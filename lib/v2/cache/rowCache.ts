import "server-only";

import { isBullEnabled } from "../bullmq/config";
import { getRedisConnection } from "../bullmq/connection";

// Best-effort JSON cache on the shared Redis connection (same one BullMQ uses). It exists
// to make the activity-recap row inspector drawer open instantly: the row API caches its
// payload here so repeat / prefetch opens skip Postgres. Strictly best-effort — when
// Redis is disabled (V2_BULL_ENABLED=0) every call is a no-op and callers fall back to
// the DB, so nothing depends on Redis being present. Short TTLs keep it self-healing
// (no write-through invalidation needed while a job is still processing).

type RedisCacheClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
};

async function client(): Promise<RedisCacheClient | null> {
  if (!isBullEnabled()) return null;
  try {
    return (await getRedisConnection()) as unknown as RedisCacheClient;
  } catch {
    return null;
  }
}

export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const redis = await client();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = await client();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // best-effort
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = await client();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // best-effort
  }
}

export function ingestionRowCacheKey(organizationId: string, rowId: string): string {
  return `v2:ingrow:${organizationId}:${rowId}`;
}
