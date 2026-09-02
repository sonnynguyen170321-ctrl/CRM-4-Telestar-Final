import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { AiProviderKind, AiRunStatus } from "./types";

// AI1: usage accounting (credit = 1 request) + append-only run log + 24h health.
// Tenant-scoped (Invariant 5). recordAiUsage/recordAiRun are called by AI2 on every
// provider call; the reads drive the /v2/ai usage chart, history, logs, and health.

export async function creditsUsedToday(organizationId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ used: number | null }>>(
    `SELECT COALESCE(SUM("creditsUsed"), 0)::int AS "used"
       FROM "V2AiUsageDaily" WHERE "organizationId" = $1 AND "usageDate" = CURRENT_DATE`,
    organizationId
  );
  return Number(rows[0]?.used ?? 0);
}

/** Idempotent-per-day increment of usage (credit = 1 request). */
export async function recordAiUsage(input: {
  organizationId: string;
  provider: AiProviderKind;
  modelId: string;
  credits?: number;
  inputTokens?: number;
  outputTokens?: number;
  isError?: boolean;
}): Promise<void> {
  await prisma.$queryRawUnsafe(
    `INSERT INTO "V2AiUsageDaily"
       ("id", "organizationId", "usageDate", "provider", "modelId", "requests", "creditsUsed",
        "inputTokens", "outputTokens", "errors", "createdAt", "updatedAt")
     VALUES ($1, $2, CURRENT_DATE, $3::"V2AiProviderKind", $4, 1, $5, $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "usageDate", "provider", "modelId") DO UPDATE SET
       "requests" = "V2AiUsageDaily"."requests" + 1,
       "creditsUsed" = "V2AiUsageDaily"."creditsUsed" + EXCLUDED."creditsUsed",
       "inputTokens" = "V2AiUsageDaily"."inputTokens" + EXCLUDED."inputTokens",
       "outputTokens" = "V2AiUsageDaily"."outputTokens" + EXCLUDED."outputTokens",
       "errors" = "V2AiUsageDaily"."errors" + EXCLUDED."errors",
       "updatedAt" = CURRENT_TIMESTAMP`,
    `aiusage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    input.organizationId,
    input.provider,
    input.modelId,
    input.credits ?? 1,
    input.inputTokens ?? 0,
    input.outputTokens ?? 0,
    input.isError ? 1 : 0
  );
}

export async function recordAiRun(input: {
  organizationId: string;
  provider: AiProviderKind;
  modelId: string;
  purpose: string;
  status: AiRunStatus;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  creditsUsed?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  companyId?: string | null;
  createdByUserId?: string | null;
}): Promise<void> {
  await prisma.$queryRawUnsafe(
    `INSERT INTO "V2AiRunLog"
       ("id", "organizationId", "provider", "modelId", "purpose", "status", "latencyMs",
        "inputTokens", "outputTokens", "creditsUsed", "errorCode", "errorMessage", "companyId", "createdByUserId", "createdAt")
     VALUES ($1, $2, $3::"V2AiProviderKind", $4, $5, $6::"V2AiRunStatus", $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP)`,
    `airun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    input.organizationId,
    input.provider,
    input.modelId,
    input.purpose,
    input.status,
    input.latencyMs ?? null,
    input.inputTokens ?? null,
    input.outputTokens ?? null,
    input.creditsUsed ?? 1,
    input.errorCode ?? null,
    input.errorMessage ?? null,
    input.companyId ?? null,
    input.createdByUserId ?? null
  );
}

export type AiUsagePoint = { date: string; requests: number; credits: number };

export async function queryAiUsageDaily(organizationId: string, days = 14): Promise<AiUsagePoint[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ d: Date; requests: number; credits: number }>>(
    `SELECT "usageDate" AS d, SUM("requests")::int AS "requests", SUM("creditsUsed")::int AS "credits"
       FROM "V2AiUsageDaily"
      WHERE "organizationId" = $1 AND "usageDate" >= CURRENT_DATE - ($2::int - 1)
      GROUP BY "usageDate" ORDER BY "usageDate" ASC`,
    organizationId,
    days
  );
  return rows.map((r) => ({ date: new Date(r.d).toISOString().slice(0, 10), requests: Number(r.requests), credits: Number(r.credits) }));
}

export type AiRunLogRow = {
  id: string; provider: string; modelId: string; purpose: string; status: string;
  latencyMs: number | null; creditsUsed: number; errorCode: string | null; createdAt: string;
};

export async function queryAiRunLog(organizationId: string, limit = 50): Promise<AiRunLogRow[]> {
  const rows = await prisma.$queryRawUnsafe<Array<Omit<AiRunLogRow, "createdAt"> & { createdAt: Date }>>(
    `SELECT "id", "provider"::text AS "provider", "modelId", "purpose", "status"::text AS "status",
            "latencyMs", "creditsUsed", "errorCode", "createdAt"
       FROM "V2AiRunLog" WHERE "organizationId" = $1
      ORDER BY "createdAt" DESC LIMIT $2`,
    organizationId,
    Math.min(Math.max(limit, 1), 500)
  );
  return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
}

export type AiHealth = {
  avgLatencyMs: number | null;
  successRate: number | null; // 0..1
  timeouts: number;
  errors: number;
  total: number;
};

export async function queryAiHealth(organizationId: string): Promise<AiHealth> {
  const rows = await prisma.$queryRawUnsafe<Array<{ total: number; ok: number; timeouts: number; errors: number; avg: number | null }>>(
    `SELECT COUNT(*)::int AS "total",
            COUNT(*) FILTER (WHERE "status" = 'OK')::int AS "ok",
            COUNT(*) FILTER (WHERE "status" = 'TIMEOUT')::int AS "timeouts",
            COUNT(*) FILTER (WHERE "status" IN ('ERROR','RATE_LIMITED'))::int AS "errors",
            AVG("latencyMs") FILTER (WHERE "latencyMs" IS NOT NULL) AS "avg"
       FROM "V2AiRunLog"
      WHERE "organizationId" = $1 AND "createdAt" >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
    organizationId
  );
  const r = rows[0];
  const total = Number(r?.total ?? 0);
  return {
    avgLatencyMs: r?.avg != null ? Math.round(Number(r.avg)) : null,
    successRate: total > 0 ? Number(r?.ok ?? 0) / total : null,
    timeouts: Number(r?.timeouts ?? 0),
    errors: Number(r?.errors ?? 0),
    total,
  };
}
