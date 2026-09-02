import "server-only";

import { isBullEnabled } from "./config";
import { getRedisConnection } from "./connection";

// Redis read-through cache for org-scoped, filter-independent read-models (lead facets,
// enrollment options, campaign options). Best-effort: when BullMQ/Redis is disabled every
// call falls through to the fetcher, so nothing depends on Redis being present. Short TTL
// keeps it self-healing; the `v2.readmodel.refresh` queue re-warms these keys after
// scoring/ingestion runs so the first page load after a big run doesn't pay the cold cost.

const CACHE_TTL_SECONDS = 300; // 5 minutes

type RedisStringClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttlSeconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
};

async function redisClient(): Promise<RedisStringClient | null> {
  if (!isBullEnabled()) return null;
  try {
    return (await getRedisConnection()) as unknown as RedisStringClient;
  } catch {
    return null;
  }
}

/** Read-through: Redis hit returns cached JSON; miss computes inline + writes back. */
export async function withFacetCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  ttlSeconds: number = CACHE_TTL_SECONDS
): Promise<T> {
  const redis = await redisClient();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached) as T;
    } catch (err) {
      console.error(`[FacetCache] read failed for ${cacheKey}`, err);
    }
  }

  const data = await fetcher();

  if (redis) {
    try {
      await redis.set(cacheKey, JSON.stringify(data), "EX", ttlSeconds);
    } catch (err) {
      console.error(`[FacetCache] write failed for ${cacheKey}`, err);
    }
  }
  return data;
}

/** Force-write a computed value into the cache (used by the refresh worker). */
export async function setFacetCache(cacheKey: string, value: unknown, ttlSeconds: number = CACHE_TTL_SECONDS): Promise<void> {
  const redis = await redisClient();
  if (!redis) return;
  try {
    await redis.set(cacheKey, JSON.stringify(value), "EX", ttlSeconds);
  } catch (err) {
    console.error(`[FacetCache] write failed for ${cacheKey}`, err);
  }
}

/**
 * Granular invalidation: delete specific cache keys so the very next read-through recomputes fresh
 * (instant), instead of serving up to `CACHE_TTL_SECONDS` of stale data or waiting for the rebuild
 * worker. Best-effort — no-op when Redis is disabled; the TTL is still the backstop. This is the
 * "revalidate on mutation" primitive: a write path deletes exactly the keys it invalidated, so a
 * router.refresh()/revalidatePath afterward sees new data without recomputing the whole tree.
 */
export async function invalidateFacetCache(cacheKeys: string[]): Promise<void> {
  if (cacheKeys.length === 0) return;
  const redis = await redisClient();
  if (!redis) return;
  try {
    await redis.del(...cacheKeys);
  } catch (err) {
    console.error("[FacetCache] invalidate failed", err);
  }
}

/** Convenience: invalidate every org-scoped facet/option/aggregate key at once (one DEL, lazy recompute). */
export async function invalidateOrgFacets(organizationId: string): Promise<void> {
  await invalidateFacetCache(Object.values(FACET_CACHE_KEYS).map((make) => make(organizationId)));
}

/** Org-scoped cache keys warmed by the readmodel-refresh worker. */
export const FACET_CACHE_KEYS = {
  leadFacets: (organizationId: string) => `v2:org:${organizationId}:facets:leads`,
  enrollOptions: (organizationId: string) => `v2:org:${organizationId}:options:enroll`,
  campaignOptions: (organizationId: string) => `v2:org:${organizationId}:options:campaigns`,
  // Heavy, filter-independent, slow-changing read-models (only change when accounts/projects/ICPs
  // change) — safe to read-through cache so a navigation/refresh doesn't recompute the whole tree.
  leadFilterOptions: (organizationId: string) => `v2:org:${organizationId}:options:leadFilters`,
  companyFilterOptions: (organizationId: string) => `v2:org:${organizationId}:options:companyFilters`,
  contextOptions: (organizationId: string) => `v2:org:${organizationId}:options:context`,
  companyAggregates: (organizationId: string) => `v2:org:${organizationId}:aggregates:companies`,
} as const;

/**
 * Best-effort: enqueue a readmodel-refresh for an org onto the registered
 * `v2.readmodel.refresh` queue (worker re-warms the FACET_CACHE_KEYS). No-op when Bull is
 * disabled; callers never await correctness from this — the TTL is the backstop.
 */
export async function enqueueFacetRebuild(organizationId: string): Promise<void> {
  if (!isBullEnabled()) return;
  try {
    const { addJob } = await import("./queues");
    const { V2_QUEUE_NAMES } = await import("./queueNames");
    await addJob(V2_QUEUE_NAMES.readmodelRefresh, "readmodel-refresh", { organizationId });
  } catch (err) {
    console.error("[FacetCache] enqueue rebuild failed", err);
  }
}
