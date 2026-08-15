import { Redis } from 'ioredis';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';
const CACHE_PREFIX = 'crm4u:cache:';

let client: Redis | null = null;

function getClient(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL || DEFAULT_REDIS_URL;
  try {
    client = new Redis(url, {
      lazyConnect: true,
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    return client;
  } catch {
    return null;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const c = getClient();
  if (!c) return null;
  try {
    const raw = await c.get(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function cacheSet<T>(key: string, value: T, ttl: number = 60): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    await c.setex(`${CACHE_PREFIX}${key}`, ttl, JSON.stringify(value));
  } catch {
    // silently fail — cache is optional
  }
}

/**
 * Invalidate every cached key that starts with `prefix` (e.g. `cacheDel('campaigns:')`
 * clears `campaigns:list` + `campaigns:clients`). Callers pass a prefix, and the GET
 * handlers cache under keyed variants (`sequences:false`, `templates:<channel>:<search>`),
 * so a single-key delete would miss them — we SCAN + DEL the whole prefix instead. Uses a
 * non-blocking cursor scan; still a safe no-op when Redis is absent.
 */
export async function cacheDel(prefix: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  try {
    const pattern = `${CACHE_PREFIX}${prefix}*`;
    let cursor = '0';
    do {
      const [next, keys] = await c.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) await c.del(...keys);
    } while (cursor !== '0');
  } catch {
    // silently fail — cache is optional
  }
}

// ─── Tenant-scoped list-cache helpers ────────────────────────────────────────
// Cached list endpoints (campaigns / sequences / templates) are org-wide *within a
// tenant*, so keys must be tenant-scoped to avoid cross-tenant reads. `listKey` builds
// the read key and `invalidateList` clears the whole tenant+resource prefix on writes —
// defining the prefix in one place so reads and invalidations can never drift apart.
/**
 * The cache namespace for a tenant's list endpoint.
 *
 * There is deliberately no fallback tenant. A key built without one is not "unscoped" — it is a
 * *shared* namespace, so two tenants that both arrived without a tenant id would read each
 * other's cached campaign, sequence and template lists. That is a cross-tenant read produced by a
 * cache, which is the hardest kind to notice: the database was never asked.
 */
function tenantNamespace(tenantId: string | undefined): string {
  if (!tenantId) {
    throw new Error('Cache key requires a tenant: refusing to build a shared cache namespace');
  }
  return tenantId;
}

export function listKey(tenantId: string | undefined, resource: string, variant: string): string {
  return `${tenantNamespace(tenantId)}:${resource}:${variant}`;
}

export async function invalidateList(tenantId: string | undefined, resource: string): Promise<void> {
  await cacheDel(`${tenantNamespace(tenantId)}:${resource}:`);
}
