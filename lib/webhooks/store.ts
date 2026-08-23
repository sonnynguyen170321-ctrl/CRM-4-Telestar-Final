import crypto from 'crypto';

import { prisma } from '@/lib/prisma';
import { cacheGet, cacheSet, cacheDel } from '@/lib/cache';
import type { WebhookConfig, WebhookEvent } from '@/lib/webhooks/dispatcher';

/**
 * The durable authority for webhook configuration (TEL-P1-032).
 *
 * Webhooks used to live only in Redis, under `webhooks:configs:<tenantId>`, with a 30-day TTL.
 * Three failures followed and all three were silent:
 *
 *   1. after 30 days without a rewrite every webhook simply stopped existing;
 *   2. a Redis restart without persistence, a flush, an eviction under memory pressure or a
 *      cache migration lost every tenant's configuration, with no record it had ever existed;
 *   3. `cacheSet` returns early when there is no client and swallows errors, so creating a
 *      webhook with Redis down answered `{ success: true }` and stored nothing.
 *
 * This is configuration, not a cached projection of something durable — there was nothing behind
 * it to rebuild from. `AGENTS.md`: *the database is workflow truth; queues execute, never decide,
 * and are rebuildable from it.*
 *
 * So: **Postgres is the authority. Redis is a read cache and may be empty, stale or absent
 * without changing any answer.** Every write goes to the database first and invalidates the
 * cache after; a cache failure can never make a write appear to have succeeded.
 *
 * Tenant scoping is explicit on every query rather than left to the client extension, because
 * these functions are called from route handlers *and* from scripts with no session.
 */

/** How long a cached read may be trusted. Short: it is an optimisation, not a store. */
const CACHE_TTL_SECONDS = 300;

const cacheKey = (tenantId: string) => `webhooks:configs:${tenantId}`;

/** The database row shape, mapped to the API/dispatcher type. */
type WebhookRow = {
  id: string;
  tenantId: string;
  url: string;
  secret: string;
  events: string[];
  isActive: boolean;
  lastDeliveryAt: Date | null;
  lastStatus: number | null;
  createdAt: Date;
};

function toConfig(row: WebhookRow): WebhookConfig {
  return {
    id: row.id,
    tenantId: row.tenantId,
    url: row.url,
    secret: row.secret,
    events: row.events as WebhookEvent[],
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    lastDeliveryAt: row.lastDeliveryAt ? row.lastDeliveryAt.toISOString() : null,
    lastStatus: row.lastStatus,
  };
}

/**
 * Every webhook configured for a tenant.
 *
 * Reads through the cache, but the database is what decides. A cache miss is ordinary; a cache
 * that is permanently unavailable costs a query per call and changes nothing else.
 */
export async function listWebhooks(tenantId: string): Promise<WebhookConfig[]> {
  const cached = await cacheGet<WebhookConfig[]>(cacheKey(tenantId));
  if (cached) return cached;

  const rows = await prisma.webhook.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'asc' },
  });
  const configs = rows.map((row) => toConfig(row as WebhookRow));

  // Best-effort. `cacheSet` swallows its own errors, which is fine HERE — unlike the old code,
  // nothing depends on this having worked.
  await cacheSet(cacheKey(tenantId), configs, CACHE_TTL_SECONDS);
  return configs;
}

/** The active subscriptions for one event — what a dispatcher actually needs. */
export async function listActiveWebhooksForEvent(
  tenantId: string,
  event: WebhookEvent,
): Promise<WebhookConfig[]> {
  const all = await listWebhooks(tenantId);
  return all.filter((webhook) => webhook.isActive && webhook.events.includes(event));
}

export type SaveWebhookInput = {
  id?: string | null;
  url: string;
  events: WebhookEvent[];
  isActive?: boolean;
  secret?: string | null;
};

/**
 * Create or replace a webhook, durably.
 *
 * Returns the stored record INCLUDING the secret, so the caller can echo it once on creation.
 * The route is responsible for never returning it again.
 *
 * If the write fails, this throws. That is the point: the old path reported success when Redis
 * was down and nothing had been stored.
 */
export async function saveWebhook(
  tenantId: string,
  input: SaveWebhookInput,
): Promise<WebhookConfig> {
  const secret =
    typeof input.secret === 'string' && input.secret.trim()
      ? input.secret.trim()
      : crypto.randomBytes(24).toString('hex');

  const data = {
    tenantId,
    url: input.url.trim(),
    events: input.events,
    isActive: input.isActive !== false,
  };

  let row: WebhookRow;
  if (input.id) {
    // Scoped by tenant in the WHERE, not just the id: an id from another tenant must miss,
    // not update. `updateMany` returns a count rather than throwing on no match, so the
    // create-if-absent case stays explicit instead of relying on an exception.
    const updated = await prisma.webhook.updateMany({
      where: { id: input.id, tenantId },
      data: { ...data, secret },
    });
    if (updated.count === 0) {
      // The id matched nothing of ours. It might be a typo, or it might belong to another
      // tenant — and we must not be able to tell the difference from out here.
      //
      // Creating with the caller's id would do both wrong things: a primary-key collision when
      // the id exists elsewhere, which crashes AND confirms its existence, and an id chosen by
      // whoever asked. A fresh id is generated instead, so the outcome is identical either way.
      row = (await prisma.webhook.create({ data: { ...data, secret } })) as WebhookRow;
    } else {
      row = (await prisma.webhook.findFirst({
        where: { id: input.id, tenantId },
      })) as WebhookRow;
    }
  } else {
    row = (await prisma.webhook.create({ data: { ...data, secret } })) as WebhookRow;
  }

  await invalidate(tenantId);
  return toConfig(row);
}

/**
 * Delete a webhook.
 *
 * @returns whether a row belonging to this tenant was actually removed. A caller must be able
 *          to tell "deleted" from "there was nothing to delete", and neither is an error.
 */
export async function deleteWebhook(tenantId: string, id: string): Promise<boolean> {
  const result = await prisma.webhook.deleteMany({ where: { id, tenantId } });
  await invalidate(tenantId);
  return result.count > 0;
}

/**
 * Record the outcome of a delivery attempt.
 *
 * Deliberately tolerant: a webhook deleted between dispatch and completion is not an error, and
 * failing here must never fail the delivery it is describing.
 */
export async function recordDelivery(
  tenantId: string,
  id: string,
  status: number | null,
): Promise<void> {
  try {
    await prisma.webhook.updateMany({
      where: { id, tenantId },
      data: { lastDeliveryAt: new Date(), lastStatus: status },
    });
    await invalidate(tenantId);
  } catch {
    // Reporting is not the delivery. Losing a timestamp must not turn a successful send into a
    // failure, and the delivery result is already returned to the caller.
  }
}

/** Drop the cached view so the next read comes from the authority. */
async function invalidate(tenantId: string): Promise<void> {
  await cacheDel(cacheKey(tenantId));
}
