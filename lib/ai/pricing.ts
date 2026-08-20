/**
 * Provider price list for AI cost attribution (Revenue AI Phase 1).
 *
 * These are **estimates**, not invoices. Providers bill on their own counters and
 * their own rounding; this table exists so a work order can be given a budget and a
 * campaign can be given a cost per meeting without waiting for a billing export.
 * `AiCall.estimatedCostUsd` is named for that reason.
 *
 * Rates are USD per million tokens for LLMs, USD per call for search/fetch. Update
 * them here and nowhere else — a rate hardcoded at a call site is a rate nobody
 * finds again when it changes.
 */

import { MODEL_REGISTRY, findModelMetadata } from './registry';

/** USD per 1M tokens, per model. */
type TokenRate = { inputPerMillion: number; outputPerMillion: number };

/**
 * Rates come from the model registry, not a second table beside it.
 *
 * A separate price list is a second source of truth about the same three models, and it drifts
 * the moment one of them changes: this table used to name `llama-3.3-70b-versatile`,
 * `gemma2-9b-it` and `gemini-flash-latest` — none of which the product calls any more — while
 * knowing nothing about the models it actually does call. Every such call priced at `null`,
 * which meant a zero-cost budget reconciliation and a spend report that read as free.
 */
const TOKEN_RATES: Record<string, TokenRate> = Object.fromEntries(
  Object.values(MODEL_REGISTRY).map((model) => [
    model.modelId,
    {
      inputPerMillion: model.costPer1kInputUsd * 1000,
      outputPerMillion: model.costPer1kOutputUsd * 1000,
    },
  ]),
);

/** USD per call, for providers that bill per request rather than per token. */
const CALL_RATES: Record<string, number> = {
  tavily: 0.008,
  jina: 0.0,
};

/**
 * Cost of one LLM call. Returns null for an unknown model rather than guessing —
 * a null cost against a known token count is a visible gap; a fabricated number is not.
 */
export function estimateTokenCost(
  model: string,
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined
): number | null {
  // Accept a registry alias as well as the raw model id, so a caller that recorded one and a
  // report that queries the other agree. They are the same string today, and the lookup keeps
  // that from being load-bearing.
  const rate = TOKEN_RATES[model] ?? TOKEN_RATES[findModelMetadata(model)?.modelId ?? ''];
  if (!rate) return null;
  const input = ((promptTokens ?? 0) / 1_000_000) * rate.inputPerMillion;
  const output = ((completionTokens ?? 0) / 1_000_000) * rate.outputPerMillion;
  return round6(input + output);
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
  return model in TOKEN_RATES || !!findModelMetadata(model);
}
