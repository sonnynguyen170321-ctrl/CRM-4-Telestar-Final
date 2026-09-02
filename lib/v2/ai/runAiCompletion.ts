import "server-only";

// AI2: the single server-side entry point for any AI request. It enforces, in order:
//   1. the AI gate (enabled / mode / daily budget)        — AI is never forced (Inv 9 spirit)
//   2. provider API key presence (server-only env)
//   3. the soft rpm/tpm rate limit
// then calls the provider with retry/backoff and records usage (credit = 1) + a run-log
// row. A skip/error degrades gracefully — the caller falls back to deterministic output.

import { decideAiGate, type AiCallReason } from "./aiGate";
import { getProvider } from "./providers";
import { AiProviderError, type AiCompletionResult } from "./providers/types";
import { resolveAiCall, sharedRateLimiter, type RateLimiterState } from "./rateLimiter";
import { getAiRateLimit, getAiSettings, getProviderKey, recordProviderHealth } from "./settings";
import { DEFAULT_AI_MODELS, type AiProviderKind, type AiSettings } from "./types";
import { creditsUsedToday, recordAiRun, recordAiUsage } from "./usage";

export type RunAiInput = {
  organizationId: string;
  purpose: string;
  prompt: string;
  system?: string;
  uncertain?: boolean;
  provider?: AiProviderKind;
  modelId?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  companyId?: string | null;
  createdByUserId?: string | null;
  // Test seams (never set in production):
  settings?: AiSettings;
  rateLimiter?: RateLimiterState;
  now?: number;
};

export type RunAiOutcome =
  | { ok: true; text: string; provider: AiProviderKind; modelId: string; result: AiCompletionResult }
  | { ok: false; skipped: true; reason: AiCallReason | "no_key" | "rate_limited"; retryAfterMs?: number }
  | { ok: false; skipped: false; reason: "TIMEOUT" | "ERROR" | "RATE_LIMITED"; message: string };

function resolveModel(settings: AiSettings, provider: AiProviderKind, modelId?: string) {
  if (modelId) return modelId;
  if (settings.defaultModelId) {
    const known = DEFAULT_AI_MODELS.find((m) => m.modelId === settings.defaultModelId && m.provider === provider);
    if (known) return known.modelId;
  }
  const first = DEFAULT_AI_MODELS.find((m) => m.provider === provider);
  return first?.modelId ?? "gemini-flash-latest";
}

export async function runAiCompletion(input: RunAiInput): Promise<RunAiOutcome> {
  const settings = input.settings ?? (await getAiSettings(input.organizationId));
  const provider = input.provider ?? settings.provider;
  const modelId = resolveModel(settings, provider, input.modelId);
  const limiter = input.rateLimiter ?? sharedRateLimiter;
  const now = input.now ?? Date.now();

  const used = await creditsUsedToday(input.organizationId);
  const gate = decideAiGate(settings, { uncertain: input.uncertain ?? false, creditsUsedToday: used });
  const keyPresent = getProviderKey(provider) !== null;
  const modelDef = DEFAULT_AI_MODELS.find((m) => m.modelId === modelId && m.provider === provider);
  const maxOut = input.maxOutputTokens ?? modelDef?.maxOutputTokens ?? 1024;
  const temperature = input.temperature ?? modelDef?.defaultTemperature ?? 0.2;
  const estTokens = Math.ceil(input.prompt.length / 4) + maxOut;

  // Honor the org+provider configured soft limit (set in /v2/ai). Only read it when we
  // actually intend to call (gate passed + key present), to avoid a needless query.
  const rateLimit = gate.allow && keyPresent ? await getAiRateLimit(input.organizationId, provider) : null;
  const rpm = rateLimit
    ? limiter.check(
        `${input.organizationId}:${provider}`,
        { rpmSoftLimit: rateLimit.rpmSoftLimit, tpmSoftLimit: rateLimit.tpmSoftLimit, estTokens },
        now
      )
    : { ok: true, retryAfterMs: 0, usedInWindow: 0 };

  const verdict = resolveAiCall({ gate, keyPresent, rpm });
  if (verdict.action === "skip") {
    await recordAiRun({
      organizationId: input.organizationId,
      provider,
      modelId,
      purpose: input.purpose,
      status: "SKIPPED",
      creditsUsed: 0,
      errorCode: verdict.reason,
      companyId: input.companyId ?? null,
      createdByUserId: input.createdByUserId ?? null,
    });
    return { ok: false, skipped: true, reason: verdict.reason, retryAfterMs: verdict.retryAfterMs };
  }

  const apiKey = getProviderKey(provider) as string;
  const providerImpl = getProvider(provider);
  const maxRetries = rateLimit?.maxRetries ?? 3;
  let lastErr: AiProviderError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await providerImpl.complete(
        { modelId, prompt: input.prompt, system: input.system, maxOutputTokens: maxOut, temperature, timeoutMs: input.timeoutMs ?? 20_000 },
        apiKey
      );
      await recordAiUsage({
        organizationId: input.organizationId,
        provider,
        modelId,
        inputTokens: result.inputTokens ?? 0,
        outputTokens: result.outputTokens ?? 0,
      });
      await recordAiRun({
        organizationId: input.organizationId,
        provider,
        modelId,
        purpose: input.purpose,
        status: "OK",
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        companyId: input.companyId ?? null,
        createdByUserId: input.createdByUserId ?? null,
      });
      return { ok: true, text: result.text, provider, modelId, result };
    } catch (err) {
      lastErr = err instanceof AiProviderError ? err : new AiProviderError("ERROR", "unknown provider error");
      // Retry only transient classes; honour a bounded exponential backoff.
      const transient = lastErr.code === "RATE_LIMITED" || lastErr.code === "TIMEOUT";
      if (!transient || attempt === maxRetries) break;
      await sleep(Math.min(8_000, 500 * 2 ** attempt));
    }
  }

  const code = lastErr?.code ?? "ERROR";
  await recordAiUsage({ organizationId: input.organizationId, provider, modelId, credits: 0, isError: true });
  await recordAiRun({
    organizationId: input.organizationId,
    provider,
    modelId,
    purpose: input.purpose,
    status: code,
    creditsUsed: 0,
    errorCode: code,
    errorMessage: lastErr?.message?.slice(0, 500) ?? null,
    companyId: input.companyId ?? null,
    createdByUserId: input.createdByUserId ?? null,
  });
  return { ok: false, skipped: false, reason: code, message: lastErr?.message ?? "provider error" };
}

export type TestConnectionResult = { ok: boolean; provider: AiProviderKind; modelId: string; latencyMs: number | null; error?: string };

/** Admin diagnostic: ping a provider with a tiny prompt, bypassing the mode/budget gate
 *  (a connection test must work even when AI is disabled), but still requires a key and
 *  records health + a run-log row. */
export async function testAiConnection(
  organizationId: string,
  provider: AiProviderKind,
  modelId?: string,
  createdByUserId?: string | null
): Promise<TestConnectionResult> {
  const settings = await getAiSettings(organizationId);
  const resolvedModel = resolveModel(settings, provider, modelId);
  const apiKey = getProviderKey(provider);
  if (!apiKey) {
    await recordProviderHealth(organizationId, provider, false, null);
    await recordAiRun({ organizationId, provider, modelId: resolvedModel, purpose: "health_check", status: "ERROR", creditsUsed: 0, errorCode: "no_key", createdByUserId: createdByUserId ?? null });
    return { ok: false, provider, modelId: resolvedModel, latencyMs: null, error: "API key not configured" };
  }
  try {
    const result = await getProvider(provider).complete(
      { modelId: resolvedModel, prompt: "Reply with the single word: ok", maxOutputTokens: 8, temperature: 0, timeoutMs: 12_000 },
      apiKey
    );
    await recordProviderHealth(organizationId, provider, true, result.latencyMs);
    await recordAiUsage({ organizationId, provider, modelId: resolvedModel, inputTokens: result.inputTokens ?? 0, outputTokens: result.outputTokens ?? 0 });
    await recordAiRun({ organizationId, provider, modelId: resolvedModel, purpose: "health_check", status: "OK", latencyMs: result.latencyMs, inputTokens: result.inputTokens, outputTokens: result.outputTokens, createdByUserId: createdByUserId ?? null });
    return { ok: true, provider, modelId: resolvedModel, latencyMs: result.latencyMs };
  } catch (err) {
    const e = err instanceof AiProviderError ? err : new AiProviderError("ERROR", "connection failed");
    await recordProviderHealth(organizationId, provider, false, null);
    await recordAiRun({ organizationId, provider, modelId: resolvedModel, purpose: "health_check", status: e.code, creditsUsed: 0, errorCode: e.code, errorMessage: e.message.slice(0, 500), createdByUserId: createdByUserId ?? null });
    return { ok: false, provider, modelId: resolvedModel, latencyMs: null, error: e.message };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
