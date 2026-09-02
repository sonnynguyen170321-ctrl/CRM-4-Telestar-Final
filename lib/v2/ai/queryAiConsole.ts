import "server-only";

import { prisma } from "@/lib/server/prisma";
import { budgetPercentUsed, creditsRemaining } from "./aiGate";
import { getAiRateLimit, getAiSettings, isProviderKeyPresent } from "./settings";
import { AI_PROVIDERS, DEFAULT_AI_MODELS, PROVIDER_ENV_KEY, type AiModelDef, type AiProviderKind, type AiRateLimit, type AiSettings } from "./types";
import { creditsUsedToday, queryAiHealth, queryAiRunLog, queryAiUsageDaily, type AiHealth, type AiRunLogRow, type AiUsagePoint } from "./usage";

// AI4: the single tenant-scoped read-model for /v2/ai (Invariant 5). Bundles settings,
// budget, per-provider key/health, model registry, usage chart, health, and run log.

export type AiProviderView = {
  provider: AiProviderKind;
  envKey: string;
  keyPresent: boolean;
  lastHealthAt: string | null;
  lastHealthOk: boolean | null;
  lastHealthLatencyMs: number | null;
  rateLimit: AiRateLimit;
};

export type AiConsoleData = {
  settings: AiSettings;
  creditsUsedToday: number;
  creditsRemaining: number;
  budgetPercentUsed: number;
  providers: AiProviderView[];
  models: AiModelDef[];
  health: AiHealth;
  usage: AiUsagePoint[];
  runLog: AiRunLogRow[];
};

type ProviderConfigRow = {
  provider: string;
  lastHealthAt: Date | null;
  lastHealthOk: boolean | null;
  lastHealthLatencyMs: number | null;
};

export async function queryAiConsole(organizationId: string): Promise<AiConsoleData> {
  const [settings, used, health, usage, runLog, configRows] = await Promise.all([
    getAiSettings(organizationId),
    creditsUsedToday(organizationId),
    queryAiHealth(organizationId),
    queryAiUsageDaily(organizationId, 14),
    queryAiRunLog(organizationId, 50),
    prisma.$queryRawUnsafe<ProviderConfigRow[]>(
      `SELECT "provider"::text AS "provider", "lastHealthAt", "lastHealthOk", "lastHealthLatencyMs"
         FROM "V2AiProviderConfig" WHERE "organizationId" = $1`,
      organizationId
    ),
  ]);

  const configByProvider = new Map(configRows.map((r) => [r.provider, r]));
  const rateLimits = await Promise.all(AI_PROVIDERS.map((p) => getAiRateLimit(organizationId, p)));

  const providers: AiProviderView[] = AI_PROVIDERS.map((provider, i) => {
    const cfg = configByProvider.get(provider);
    return {
      provider,
      envKey: PROVIDER_ENV_KEY[provider],
      keyPresent: isProviderKeyPresent(provider),
      lastHealthAt: cfg?.lastHealthAt ? new Date(cfg.lastHealthAt).toISOString() : null,
      lastHealthOk: cfg?.lastHealthOk ?? null,
      lastHealthLatencyMs: cfg?.lastHealthLatencyMs ?? null,
      rateLimit: rateLimits[i],
    };
  });

  return {
    settings,
    creditsUsedToday: used,
    creditsRemaining: creditsRemaining(settings, used),
    budgetPercentUsed: budgetPercentUsed(settings, used),
    providers,
    models: DEFAULT_AI_MODELS,
    health,
    usage,
    runLog,
  };
}
