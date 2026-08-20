/**
 * The one price resolver for Telestar AI.
 *
 * Rates are **not** kept here. They live on `ModelMetadata.pricing` in the registry, beside
 * the model they describe, and this module is the arithmetic that turns them into dollars.
 * A separate price table is a second source of truth about the same three models, and it
 * drifts the moment one of them changes: the table this replaced named
 * `llama-3.3-70b-versatile`, `gemma2-9b-it` and `gemini-flash-latest` — none of which the
 * product calls any more — while knowing nothing about the models it actually does call.
 * Every such call priced at `null`, which meant a zero-cost budget reconciliation and a spend
 * report that read as free.
 *
 * ## Three rules that are not optional
 *
 * **Effective dates.** Gemini's introductory rate ends 2026-12-31. Pricing a call by "the"
 * rate would be silently wrong from 2027-01-01, and a reconciliation of historical calls
 * would be wrong in the other direction. Every call is priced at the rate in force at the
 * moment it happened.
 *
 * **Long context re-prices the whole request.** Above 272K prompt tokens OpenAI charges 2x
 * input and 1.5x output for the *entire* Luna request, not just the excess. A linear
 * estimator under-reserves by 100% on exactly the calls big enough to matter.
 *
 * **A registered model with no resolvable rate is an error, never $0.** `estimatedCostUsd = 0`
 * against a real token count does not look like a bug in a spend report — it looks like a
 * free call, and it silently bypasses the tenant's budget cap. This module throws
 * `PricingConfigurationError` instead, and the gateway degrades non-essential AI rather than
 * spending unmeasured money. Rates for USD per call (search/fetch) keep the older
 * `null`-for-unknown-provider contract, because those providers are not in the registry and
 * an unknown one is a caller error rather than a misconfigured model.
 */

import {
  MODEL_REGISTRY,
  findModelMetadata,
  type ModelMetadata,
  type ModelPricePeriod,
} from './registry';

/**
 * A registered production model whose price cannot be resolved for a given moment.
 *
 * Distinct from "unknown model" on purpose: an unknown id is a caller mistake, this is a
 * deployment that can spend money it cannot measure.
 */
export class PricingConfigurationError extends Error {
  constructor(
    public readonly modelId: string,
    public readonly at: Date,
    reason: string,
  ) {
    super(`No usable price for model "${modelId}" at ${at.toISOString()}: ${reason}`);
    this.name = 'PricingConfigurationError';
  }
}

/** Token counts as a provider reports them. Cached prompt tokens are a subset of prompt tokens. */
export interface TokenUsageForPricing {
  promptTokens?: number | null;
  completionTokens?: number | null;
  /** Prompt tokens the provider served from its cache, where it reports them separately. */
  cachedPromptTokens?: number | null;
}

/** The rate actually applied, plus the money. Returned whole so a caller can show its working. */
export interface ResolvedPrice {
  modelId: string;
  currency: 'USD';
  /** Rates after any long-context multiplier, in USD per million tokens. */
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cachedInputPerMillionUsd: number;
  longContextApplied: boolean;
  periodFrom: string | null;
  periodUntil: string | null;
  costUsd: number;
}

/** USD per call, for providers that bill per request rather than per token. */
const CALL_RATES: Record<string, number> = {
  tavily: 0.008,
  jina: 0.0,
};

function withinPeriod(period: ModelPricePeriod, at: Date): boolean {
  const from = period.effectiveFrom ? Date.parse(period.effectiveFrom) : Number.NEGATIVE_INFINITY;
  const until = period.effectiveUntil ? Date.parse(period.effectiveUntil) : Number.POSITIVE_INFINITY;
  const t = at.getTime();
  return t >= from && t < until;
}

/** The band in force at `at`, or null when the bands leave a gap. */
export function findPricePeriod(model: ModelMetadata, at: Date): ModelPricePeriod | null {
  return model.pricing.periods.find((period) => withinPeriod(period, at)) ?? null;
}

/**
 * Resolves the rate and the cost of one call.
 *
 * Throws `PricingConfigurationError` when the model is registered but its rates do not cover
 * `at`, or are not finite numbers. Throws a plain `Error` when the model is not in the
 * registry at all — routing already refuses unknown models, so reaching here with one means
 * a caller invented an id.
 */
export function resolveModelPrice(
  modelIdOrAlias: string,
  at: Date,
  usage: TokenUsageForPricing,
): ResolvedPrice {
  const model = findModelMetadata(modelIdOrAlias);
  if (!model) {
    throw new Error(`Unknown AI model "${modelIdOrAlias}". It is not a registry alias or model id.`);
  }

  const period = findPricePeriod(model, at);
  if (!period) {
    throw new PricingConfigurationError(
      model.modelId,
      at,
      'no price period covers this timestamp',
    );
  }
  if (!Number.isFinite(period.inputPerMillionUsd) || !Number.isFinite(period.outputPerMillionUsd)) {
    throw new PricingConfigurationError(model.modelId, at, 'price period has non-finite rates');
  }

  const promptTokens = Math.max(0, usage.promptTokens ?? 0);
  const completionTokens = Math.max(0, usage.completionTokens ?? 0);
  // Cached tokens are a subset of the prompt; a provider that over-reports them must not be
  // able to drive the uncached remainder negative.
  const cachedPromptTokens = Math.min(promptTokens, Math.max(0, usage.cachedPromptTokens ?? 0));
  const uncachedPromptTokens = promptTokens - cachedPromptTokens;

  const longContext = model.pricing.longContext;
  const longContextApplied = !!longContext && promptTokens > longContext.promptTokensAbove;
  const inputMultiplier = longContextApplied ? longContext!.inputMultiplier : 1;
  const outputMultiplier = longContextApplied ? longContext!.outputMultiplier : 1;

  const inputPerMillionUsd = period.inputPerMillionUsd * inputMultiplier;
  const outputPerMillionUsd = period.outputPerMillionUsd * outputMultiplier;
  // No published cached rate means cached tokens cost full price. Over-estimating is the safe
  // direction for a cap; under-estimating lets a tenant spend past it.
  const cachedInputPerMillionUsd =
    (period.cachedInputPerMillionUsd ?? period.inputPerMillionUsd) * inputMultiplier;

  const costUsd = round6(
    (uncachedPromptTokens / 1_000_000) * inputPerMillionUsd +
      (cachedPromptTokens / 1_000_000) * cachedInputPerMillionUsd +
      (completionTokens / 1_000_000) * outputPerMillionUsd,
  );

  return {
    modelId: model.modelId,
    currency: model.pricing.currency,
    inputPerMillionUsd,
    outputPerMillionUsd,
    cachedInputPerMillionUsd,
    longContextApplied,
    periodFrom: period.effectiveFrom,
    periodUntil: period.effectiveUntil,
    costUsd,
  };
}

/**
 * Cost of one LLM call, for the attribution ledger.
 *
 * Returns null only for a model that is not in the registry — a visible gap against a known
 * token count. A registered model with broken pricing throws instead, because that is a
 * deployment fault and answering `0` would hide it inside a spend report.
 */
export function estimateTokenCost(
  model: string,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
  options?: { at?: Date; cachedPromptTokens?: number | null },
): number | null {
  if (!findModelMetadata(model)) return null;
  return resolveModelPrice(model, options?.at ?? new Date(), {
    promptTokens,
    completionTokens,
    cachedPromptTokens: options?.cachedPromptTokens,
  }).costUsd;
}

/**
 * The most a call could cost, for budget reservation before the provider has answered.
 *
 * Deliberately pessimistic: it assumes the model emits its full output ceiling. A reservation
 * is released or reconciled the moment the real usage is known, so over-reserving costs a
 * tenant nothing but a brief hold, while under-reserving lets a single large call walk
 * straight through the monthly cap.
 */
export function estimateMaxRequestCostUsd(
  modelIdOrAlias: string,
  promptTokens: number,
  maxOutputTokens: number,
  at: Date = new Date(),
): number {
  return resolveModelPrice(modelIdOrAlias, at, {
    promptTokens,
    completionTokens: maxOutputTokens,
  }).costUsd;
}

/** Cost of one search or fetch call. Null when the provider is not in the table. */
export function estimateCallCost(provider: string, credits = 1): number | null {
  const rate = CALL_RATES[provider];
  if (rate === undefined) return null;
  return round6(rate * credits);
}

/** Six decimal places — matches the Decimal(12, 6) column. */
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Exposed for the pricing-coverage test: every model the app can select must have a rate. */
export function hasTokenRate(model: string): boolean {
  return !!findModelMetadata(model);
}

/**
 * Every registered model prices cleanly at `at`.
 *
 * Called at startup and by the health endpoint so a pricing gap surfaces as a configuration
 * fault before it surfaces as a month of calls reconciled at zero.
 */
export function assertRegistryPricingResolvable(at: Date = new Date()): void {
  for (const model of Object.values(MODEL_REGISTRY)) {
    // Throws PricingConfigurationError for exactly the condition we want to hear about.
    resolveModelPrice(model.modelId, at, { promptTokens: 1, completionTokens: 1 });
  }
}
