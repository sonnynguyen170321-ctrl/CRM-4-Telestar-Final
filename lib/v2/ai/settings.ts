import "server-only";

import { prisma } from "@/lib/server/prisma";
import {
  AI_PROVIDERS,
  DEFAULT_AI_RATE_LIMIT,
  DEFAULT_AI_SETTINGS,
  PROVIDER_ENV_KEY,
  type AiMode,
  type AiProviderKind,
  type AiRateLimit,
  type AiSettings,
} from "./types";

// AI1: tenant-scoped AI settings read/write (Invariant 5). Returns defaults when no
// row exists so callers never crash on first use. Provider key presence is reported
// as a boolean only — the value is read server-side and NEVER returned or logged
// (Invariant 9).

type SettingsRow = {
  organizationId: string;
  enabled: boolean;
  mode: string;
  provider: string;
  defaultModelId: string | null;
  maxRowsPerUpload: number;
  dailyCreditBudget: number;
  resultHandling: string;
  environment: string;
};

function normMode(value: string): AiMode {
  return value === "OFF" || value === "UNCERTAIN_ONLY" || value === "ALL" ? value : "UNCERTAIN_ONLY";
}
function normProvider(value: string): AiProviderKind {
  return value === "GEMINI" || value === "OPENAI" || value === "ANTHROPIC" ? value : "GEMINI";
}

export async function getAiSettings(organizationId: string): Promise<AiSettings> {
  const rows = await prisma.$queryRawUnsafe<SettingsRow[]>(
    `SELECT "organizationId", "enabled", "mode"::text AS "mode", "provider"::text AS "provider",
            "defaultModelId", "maxRowsPerUpload", "dailyCreditBudget", "resultHandling", "environment"
       FROM "V2AiSettings" WHERE "organizationId" = $1 LIMIT 1`,
    organizationId
  );
  const r = rows[0];
  if (!r) return { organizationId, ...DEFAULT_AI_SETTINGS };
  return {
    organizationId: r.organizationId,
    enabled: r.enabled,
    mode: normMode(r.mode),
    provider: normProvider(r.provider),
    defaultModelId: r.defaultModelId,
    maxRowsPerUpload: Number(r.maxRowsPerUpload),
    dailyCreditBudget: Number(r.dailyCreditBudget),
    resultHandling: r.resultHandling,
    environment: r.environment,
  };
}

/** Upsert the org's AI settings (admin-gated at the route/action layer). */
export async function updateAiSettings(
  organizationId: string,
  patch: Partial<Omit<AiSettings, "organizationId">>
): Promise<void> {
  const current = await getAiSettings(organizationId);
  const next: AiSettings = { ...current, ...patch, organizationId };
  await prisma.$queryRawUnsafe(
    `INSERT INTO "V2AiSettings"
       ("id", "organizationId", "enabled", "mode", "provider", "defaultModelId",
        "maxRowsPerUpload", "dailyCreditBudget", "resultHandling", "environment", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4::"V2AiMode", $5::"V2AiProviderKind", $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId") DO UPDATE SET
       "enabled" = EXCLUDED."enabled", "mode" = EXCLUDED."mode", "provider" = EXCLUDED."provider",
       "defaultModelId" = EXCLUDED."defaultModelId", "maxRowsPerUpload" = EXCLUDED."maxRowsPerUpload",
       "dailyCreditBudget" = EXCLUDED."dailyCreditBudget", "resultHandling" = EXCLUDED."resultHandling",
       "environment" = EXCLUDED."environment", "updatedAt" = CURRENT_TIMESTAMP`,
    `aiset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    organizationId,
    next.enabled,
    next.mode,
    next.provider,
    next.defaultModelId,
    next.maxRowsPerUpload,
    next.dailyCreditBudget,
    next.resultHandling,
    next.environment
  );
}

/** True when the provider's API key env var is set. Never exposes the value. */
export function isProviderKeyPresent(provider: AiProviderKind, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[PROVIDER_ENV_KEY[provider]] ?? "").trim().length > 0;
}

export type AiProviderStatus = { provider: AiProviderKind; keyPresent: boolean };

export function listProviderKeyStatus(env: NodeJS.ProcessEnv = process.env): AiProviderStatus[] {
  return AI_PROVIDERS.map((provider) => ({ provider, keyPresent: isProviderKeyPresent(provider, env) }));
}

/** Resolve a provider's API key from env, server-side. Returns null when absent; the
 *  value itself is never returned to callers that don't already hold env (Invariant 9). */
export function getProviderKey(provider: AiProviderKind, env: NodeJS.ProcessEnv = process.env): string | null {
  const v = (env[PROVIDER_ENV_KEY[provider]] ?? "").trim();
  return v.length > 0 ? v : null;
}

type RateLimitRow = {
  rpmSoftLimit: number;
  tpmSoftLimit: number;
  requestDelayMs: number;
  maxRetries: number;
  backoffBaseSeconds: number;
  backoffMaxSeconds: number;
};

/** Org+provider soft rate limit. Returns defaults when no row exists. */
export async function getAiRateLimit(organizationId: string, provider: AiProviderKind): Promise<AiRateLimit> {
  const rows = await prisma.$queryRawUnsafe<RateLimitRow[]>(
    `SELECT "rpmSoftLimit", "tpmSoftLimit", "requestDelayMs", "maxRetries", "backoffBaseSeconds", "backoffMaxSeconds"
       FROM "V2AiRateLimit" WHERE "organizationId" = $1 AND "provider" = $2::"V2AiProviderKind" LIMIT 1`,
    organizationId,
    provider
  );
  const r = rows[0];
  if (!r) return { provider, ...DEFAULT_AI_RATE_LIMIT };
  return {
    provider,
    rpmSoftLimit: Number(r.rpmSoftLimit),
    tpmSoftLimit: Number(r.tpmSoftLimit),
    requestDelayMs: Number(r.requestDelayMs),
    maxRetries: Number(r.maxRetries),
    backoffBaseSeconds: Number(r.backoffBaseSeconds),
    backoffMaxSeconds: Number(r.backoffMaxSeconds),
  };
}

/** Upsert the org+provider soft rate limit (admin-gated at the action layer). */
export async function updateAiRateLimit(
  organizationId: string,
  provider: AiProviderKind,
  patch: Partial<Omit<AiRateLimit, "provider">>
): Promise<void> {
  const current = await getAiRateLimit(organizationId, provider);
  const next = { ...current, ...patch };
  await prisma.$queryRawUnsafe(
    `INSERT INTO "V2AiRateLimit"
       ("id", "organizationId", "provider", "rpmSoftLimit", "tpmSoftLimit", "requestDelayMs", "maxRetries", "backoffBaseSeconds", "backoffMaxSeconds", "createdAt", "updatedAt")
     VALUES ($1, $2, $3::"V2AiProviderKind", $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "provider") DO UPDATE SET
       "rpmSoftLimit" = EXCLUDED."rpmSoftLimit", "tpmSoftLimit" = EXCLUDED."tpmSoftLimit",
       "requestDelayMs" = EXCLUDED."requestDelayMs", "maxRetries" = EXCLUDED."maxRetries",
       "backoffBaseSeconds" = EXCLUDED."backoffBaseSeconds", "backoffMaxSeconds" = EXCLUDED."backoffMaxSeconds",
       "updatedAt" = CURRENT_TIMESTAMP`,
    `airl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    organizationId,
    provider,
    next.rpmSoftLimit,
    next.tpmSoftLimit,
    next.requestDelayMs,
    next.maxRetries,
    next.backoffBaseSeconds,
    next.backoffMaxSeconds
  );
}

/** Upsert the last-known health of a provider (drives the /v2/ai Providers tab). */
export async function recordProviderHealth(
  organizationId: string,
  provider: AiProviderKind,
  ok: boolean,
  latencyMs: number | null
): Promise<void> {
  await prisma.$queryRawUnsafe(
    `INSERT INTO "V2AiProviderConfig"
       ("id", "organizationId", "provider", "enabled", "lastHealthAt", "lastHealthOk", "lastHealthLatencyMs", "createdAt", "updatedAt")
     VALUES ($1, $2, $3::"V2AiProviderKind", true, CURRENT_TIMESTAMP, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("organizationId", "provider") DO UPDATE SET
       "lastHealthAt" = CURRENT_TIMESTAMP,
       "lastHealthOk" = EXCLUDED."lastHealthOk",
       "lastHealthLatencyMs" = EXCLUDED."lastHealthLatencyMs",
       "updatedAt" = CURRENT_TIMESTAMP`,
    `aipc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    organizationId,
    provider,
    ok,
    latencyMs
  );
}
