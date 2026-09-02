import "server-only";

import { prisma } from "@/lib/server/prisma";

// P4 (budget rail): org-level daily provider-call accounting + gate. The enrichment
// handler checks the search budget before researching and records usage after; over the
// cap, search is skipped and enrichment degrades to website-only (never a hard failure).

export const SEARCH_PROVIDER_KEY = "search";

/** Pure: is `used` at/over a positive daily cap? (cap<=0 => unlimited). */
export function overBudget(used: number, cap: number): boolean {
  return cap > 0 && used >= cap;
}

/** COMPANY_INTEL_MAX_PROVIDER_CALLS_PER_ORG_PER_DAY (default 5000; 0 => unlimited). */
export function readProviderDailyCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.COMPANY_INTEL_MAX_PROVIDER_CALLS_PER_ORG_PER_DAY);
  return Number.isFinite(raw) && raw >= 0 ? raw : 5000;
}

export async function getProviderRequestsToday(organizationId: string, provider: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ requests: number | null }>>(
    `SELECT "requests" FROM "V2ProviderUsageDaily"
      WHERE "organizationId"=$1 AND "provider"=$2 AND "usageDate"=CURRENT_DATE LIMIT 1`,
    organizationId,
    provider
  );
  return Number(rows[0]?.requests ?? 0);
}

export async function isSearchOverBudget(organizationId: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const cap = readProviderDailyCap(env);
  if (cap <= 0) return false;
  return overBudget(await getProviderRequestsToday(organizationId, SEARCH_PROVIDER_KEY), cap);
}

/** Idempotent-per-day increment of provider usage counters. */
export async function recordProviderUsage(
  organizationId: string,
  provider: string,
  delta: { requests?: number; errors?: number; rateLimited?: number }
): Promise<void> {
  const requests = Math.max(0, delta.requests ?? 0);
  const errors = Math.max(0, delta.errors ?? 0);
  const rateLimited = Math.max(0, delta.rateLimited ?? 0);
  if (requests + errors + rateLimited === 0) return;
  await prisma.$executeRawUnsafe(
    `INSERT INTO "V2ProviderUsageDaily"
       ("id","organizationId","provider","usageDate","requests","errors","rateLimited","createdAt","updatedAt")
     VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId","provider","usageDate") DO UPDATE SET
       "requests"="V2ProviderUsageDaily"."requests"+EXCLUDED."requests",
       "errors"="V2ProviderUsageDaily"."errors"+EXCLUDED."errors",
       "rateLimited"="V2ProviderUsageDaily"."rateLimited"+EXCLUDED."rateLimited",
       "updatedAt"=CURRENT_TIMESTAMP`,
    `pud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    organizationId,
    provider,
    requests,
    errors,
    rateLimited
  );
}
