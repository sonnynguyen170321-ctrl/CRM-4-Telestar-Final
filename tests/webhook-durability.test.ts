import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * TEL-P1-032 — webhook configuration had no durable authority.
 *
 * It lived only in Redis under `webhooks:configs:<tenantId>` with `WEBHOOK_CACHE_TTL = 3600 * 24
 * * 30`. Three failures followed, all silent:
 *
 *   1. **It expired.** After 30 days without a rewrite every webhook stopped existing.
 *   2. **It did not survive Redis.** A restart without persistence, a flush, an eviction under
 *      memory pressure or a cache migration lost every tenant's configuration, with no record it
 *      had ever existed.
 *   3. **A write could silently do nothing.** `cacheSet` returns early with no client and
 *      swallows errors, so creating a webhook with Redis down answered `{ success: true }` and
 *      stored nothing.
 *
 * This is configuration, not a cached projection — there was no source of truth behind it to
 * rebuild from, against the `AGENTS.md` invariant that the database is workflow truth.
 *
 * These tests run the real store against real Postgres. Redis is substituted so each failure
 * mode can actually be produced: a cache that is empty, and a cache that throws.
 */

/** The fake cache, so "Redis is gone" and "Redis is broken" are reproducible rather than theoretical. */
const cache = {
  store: new Map<string, unknown>(),
  failWrites: false,
  failReads: false,
};

vi.mock('@/lib/cache', () => ({
  cacheGet: async (key: string) => {
    // The real `cacheGet` swallows its own errors and returns null. Mirror that: a cache that
    // is broken must look like a cache that is empty, never like an empty CONFIGURATION.
    if (cache.failReads) return null;
    return (cache.store.get(key) as never) ?? null;
  },
  cacheSet: async (key: string, value: unknown) => {
    if (cache.failWrites) return; // exactly what the real one does with no client
    cache.store.set(key, value);
  },
  cacheDel: async (prefix: string) => {
    for (const key of [...cache.store.keys()]) if (key.startsWith(prefix)) cache.store.delete(key);
  },
}));

const { prisma, tenantStorage } = await import('@/lib/prisma');
const store = await import('@/lib/webhooks/store');

const hasDb = Boolean(process.env.DATABASE_URL);
const T = 'webhook-durability-tenant';
const OTHER_T = 'webhook-durability-other';
const run = <R>(fn: () => Promise<R>) => tenantStorage.run({ tenantId: T, bypassRls: true }, fn);

async function cleanup() {
  await run(async () => {
    await prisma.webhook.deleteMany({ where: { tenantId: { in: [T, OTHER_T] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [T, OTHER_T] } } });
  });
}

beforeAll(async () => {
  if (!hasDb) return;
  await cleanup();
  await run(async () => {
    await prisma.tenant.create({ data: { id: T, name: 'Webhook Durability' } });
    // A real neighbouring tenant, so the scoping assertions are about scoping rather than
    // about a foreign key that happens to fail.
    await prisma.tenant.create({ data: { id: OTHER_T, name: 'Webhook Durability Other' } });
  });
});

afterAll(async () => {
  if (!hasDb) return;
  await cleanup();
});

beforeEach(async () => {
  cache.store.clear();
  cache.failWrites = false;
  cache.failReads = false;
  if (hasDb) await run(() => prisma.webhook.deleteMany({ where: { tenantId: { in: [T, OTHER_T] } } }));
});

describe.skipIf(!hasDb)('a webhook survives the cache being gone', () => {
  it('is still there after the cache is emptied — the 30-day TTL failure', async () => {
    const saved = await run(() =>
      store.saveWebhook(T, { url: 'https://hooks.example.com/a', events: ['lead.created'] }),
    );

    // Everything Redis knew is gone: eviction, flush, restart without persistence, or simply
    // thirty days passing. Under the old design this was the end of the webhook.
    cache.store.clear();

    const listed = await run(() => store.listWebhooks(T));
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(saved.id);
    expect(listed[0].url).toBe('https://hooks.example.com/a');
  });

  it('is still there when the cache never worked at all', async () => {
    cache.failWrites = true;
    cache.failReads = true;

    const saved = await run(() =>
      store.saveWebhook(T, { url: 'https://hooks.example.com/b', events: ['meeting.booked'] }),
    );

    const listed = await run(() => store.listWebhooks(T));
    expect(listed.map((w) => w.id)).toEqual([saved.id]);
  });

  it('reads through the cache when it is available', async () => {
    await run(() => store.saveWebhook(T, { url: 'https://hooks.example.com/c', events: ['lead.created'] }));
    await run(() => store.listWebhooks(T)); // populates
    expect(cache.store.size).toBeGreaterThan(0);
  });
});

describe.skipIf(!hasDb)('a write that did not happen is never reported as success', () => {
  it('persists to the database even when the cache write fails', async () => {
    // The exact TEL-P1-032 case: Redis down, `cacheSet` swallows it, the old route returned
    // `{ success: true }` having stored nothing.
    cache.failWrites = true;

    const saved = await run(() =>
      store.saveWebhook(T, { url: 'https://hooks.example.com/d', events: ['lead.created'] }),
    );

    const row = await run(() => prisma.webhook.findFirst({ where: { id: saved.id, tenantId: T } }));
    expect(row).not.toBeNull();
    expect(row?.url).toBe('https://hooks.example.com/d');
  });

  it('throws rather than returning when the database write fails', async () => {
    // A tenant that does not exist violates the foreign key. The caller must learn that.
    await expect(
      run(() =>
        store.saveWebhook('tenant-that-does-not-exist', {
          url: 'https://hooks.example.com/e',
          events: ['lead.created'],
        }),
      ),
    ).rejects.toThrow();
  });
});

describe.skipIf(!hasDb)('secrets', () => {
  it('generates a secret when none is supplied', async () => {
    const saved = await run(() =>
      store.saveWebhook(T, { url: 'https://hooks.example.com/f', events: ['lead.created'] }),
    );
    expect(saved.secret).toMatch(/^[0-9a-f]{48}$/);
  });

  it('keeps a supplied secret', async () => {
    const saved = await run(() =>
      store.saveWebhook(T, {
        url: 'https://hooks.example.com/g',
        events: ['lead.created'],
        secret: 'whsec_supplied_value',
      }),
    );
    expect(saved.secret).toBe('whsec_supplied_value');
  });

  it('does not treat a blank secret as supplied', async () => {
    const saved = await run(() =>
      store.saveWebhook(T, { url: 'https://hooks.example.com/h', events: ['lead.created'], secret: '   ' }),
    );
    expect(saved.secret).toMatch(/^[0-9a-f]{48}$/);
  });
});

describe.skipIf(!hasDb)('tenant scoping', () => {
  it('never lists another tenant’s webhooks', async () => {
    await run(() => store.saveWebhook(T, { url: 'https://hooks.example.com/mine', events: ['lead.created'] }));
    await run(() =>
      store.saveWebhook(OTHER_T, { url: 'https://hooks.example.com/theirs', events: ['lead.created'] }),
    );

    const mine = await run(() => store.listWebhooks(T));
    expect(mine).toHaveLength(1);
    expect(mine[0].url).toBe('https://hooks.example.com/mine');
  });

  it('refuses to delete across tenants, and says nothing was deleted', async () => {
    const theirs = await run(() =>
      store.saveWebhook(OTHER_T, { url: 'https://hooks.example.com/theirs', events: ['lead.created'] }),
    );

    const deleted = await run(() => store.deleteWebhook(T, theirs.id));
    expect(deleted).toBe(false);

    const stillThere = await run(() => prisma.webhook.findFirst({ where: { id: theirs.id } }));
    expect(stillThere).not.toBeNull();
  });

  it('refuses to update across tenants — an id from elsewhere must not overwrite', async () => {
    const theirs = await run(() =>
      store.saveWebhook(OTHER_T, { url: 'https://hooks.example.com/theirs', events: ['lead.created'] }),
    );

    // Same id, our tenant.
    const ours = await run(() =>
      store.saveWebhook(T, { id: theirs.id, url: 'https://evil.example.com/', events: ['lead.created'] }),
    );

    const untouched = await run(() => prisma.webhook.findFirst({ where: { id: theirs.id, tenantId: OTHER_T } }));
    expect(untouched?.url).toBe('https://hooks.example.com/theirs');

    // A fresh id, not the one supplied. Reusing it would collide on the primary key — which
    // both crashes and confirms that the id exists somewhere, an oracle for another tenant's
    // identifiers. The answer must be the same whether the id was a typo or a neighbour's.
    expect(ours.id).not.toBe(theirs.id);
    expect(ours.tenantId).toBe(T);
  });

  it('gives the same answer for a neighbour’s id and one that never existed', async () => {
    const theirs = await run(() =>
      store.saveWebhook(OTHER_T, { url: 'https://hooks.example.com/theirs2', events: ['lead.created'] }),
    );

    const fromNeighbourId = await run(() =>
      store.saveWebhook(T, { id: theirs.id, url: 'https://a.example.com/', events: ['lead.created'] }),
    );
    const fromNonsenseId = await run(() =>
      store.saveWebhook(T, { id: 'wh_never_existed', url: 'https://b.example.com/', events: ['lead.created'] }),
    );

    // Both created a new row under our tenant with a generated id. Indistinguishable.
    expect(fromNeighbourId.id).not.toBe(theirs.id);
    expect(fromNonsenseId.id).not.toBe('wh_never_existed');
  });
});

describe.skipIf(!hasDb)('delete and update', () => {
  it('deletes and reports that something was deleted', async () => {
    const saved = await run(() => store.saveWebhook(T, { url: 'https://hooks.example.com/x', events: ['lead.created'] }));
    expect(await run(() => store.deleteWebhook(T, saved.id))).toBe(true);
    expect(await run(() => store.listWebhooks(T))).toHaveLength(0);
  });

  it('reports false when there was nothing to delete', async () => {
    // "Deleted" and "there was nothing there" are different answers, and neither is an error.
    expect(await run(() => store.deleteWebhook(T, 'wh_does_not_exist'))).toBe(false);
  });

  it('updates in place rather than duplicating', async () => {
    const saved = await run(() => store.saveWebhook(T, { url: 'https://hooks.example.com/one', events: ['lead.created'] }));
    await run(() =>
      store.saveWebhook(T, { id: saved.id, url: 'https://hooks.example.com/two', events: ['meeting.booked'] }),
    );

    const listed = await run(() => store.listWebhooks(T));
    expect(listed).toHaveLength(1);
    expect(listed[0].url).toBe('https://hooks.example.com/two');
    expect(listed[0].events).toEqual(['meeting.booked']);
  });
});

describe.skipIf(!hasDb)('event filtering', () => {
  it('returns only active webhooks subscribed to the event', async () => {
    await run(() => store.saveWebhook(T, { url: 'https://a.example.com/', events: ['lead.created'] }));
    await run(() => store.saveWebhook(T, { url: 'https://b.example.com/', events: ['meeting.booked'] }));
    await run(() =>
      store.saveWebhook(T, { url: 'https://c.example.com/', events: ['lead.created'], isActive: false }),
    );

    const matching = await run(() => store.listActiveWebhooksForEvent(T, 'lead.created'));
    expect(matching.map((w) => w.url)).toEqual(['https://a.example.com/']);
  });
});

describe.skipIf(!hasDb)('delivery recording', () => {
  it('records the outcome of an attempt', async () => {
    const saved = await run(() => store.saveWebhook(T, { url: 'https://hooks.example.com/y', events: ['lead.created'] }));
    await run(() => store.recordDelivery(T, saved.id, 200));

    const listed = await run(() => store.listWebhooks(T));
    expect(listed[0].lastStatus).toBe(200);
    expect(listed[0].lastDeliveryAt).not.toBeNull();
  });

  it('does not throw when the webhook was deleted mid-flight', async () => {
    // Reporting is not the delivery. Losing a timestamp must never turn a successful send into
    // a failure.
    await expect(run(() => store.recordDelivery(T, 'wh_gone', 500))).resolves.toBeUndefined();
  });

  it('distinguishes never-delivered from delivered-and-failed', async () => {
    const saved = await run(() => store.saveWebhook(T, { url: 'https://hooks.example.com/z', events: ['lead.created'] }));
    const before = await run(() => store.listWebhooks(T));
    expect(before[0].lastDeliveryAt).toBeNull();
    expect(before[0].lastStatus).toBeNull();

    await run(() => store.recordDelivery(T, saved.id, null));
    const after = await run(() => store.listWebhooks(T));
    expect(after[0].lastDeliveryAt).not.toBeNull();
    expect(after[0].lastStatus).toBeNull();
  });
});

describe('the routes read the authority, not the cache', () => {
  const route = readFileSync(join(process.cwd(), 'app', 'api', 'webhooks', 'route.ts'), 'utf8');
  const testRoute = readFileSync(join(process.cwd(), 'app', 'api', 'webhooks', 'test', 'route.ts'), 'utf8');

  it('no route reaches for the webhook cache key directly', () => {
    for (const source of [route, testRoute]) {
      expect(source).not.toContain('webhooks:configs:');
      expect(source).not.toContain('cacheGet');
      expect(source).not.toContain('cacheSet');
    }
  });

  it('the 30-day TTL that expired configuration is gone', () => {
    expect(route).not.toContain('3600 * 24 * 30');
    expect(route).not.toContain('WEBHOOK_CACHE_TTL');
  });

  it('every verb goes through the store', () => {
    expect(route).toContain('listWebhooks');
    expect(route).toContain('saveWebhook');
    expect(route).toContain('deleteWebhook');
  });

  it('the test ping resolves the webhook from the store', () => {
    expect(testRoute).toContain('listWebhooks');
  });

  it('a delete that matched nothing is a 404, not a success', () => {
    // The old route filtered a list and always answered `{ success: true }`, so deleting
    // another tenant's id — or a typo — reported success.
    expect(route).toMatch(/if \(!deleted\)/);
    expect(route).toContain("'Webhook not found'");
  });

  it('the schema carries the model, so there is something to rebuild from', () => {
    const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');
    expect(schema).toMatch(/^model Webhook \{/m);
    expect(schema).toContain('webhooks                 Webhook[]');
  });
});
