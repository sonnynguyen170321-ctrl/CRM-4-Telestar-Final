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

/** USD per 1M tokens, per model. */
type TokenRate = { inputPerMillion: number; outputPerMillion: number };

const TOKEN_RATES: Record<string, TokenRate> = {
  // Groq — published rates as of 2026-08.
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
  'llama-3.1-8b-instant': { inputPerMillion: 0.05, outputPerMillion: 0.08 },
  'gemma2-9b-it': { inputPerMillion: 0.2, outputPerMillion: 0.2 },
  // Google.
  'gemini-flash-latest': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  'gemini-2.0-flash': { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

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
  const rate = TOKEN_RATES[model];
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
  return model in TOKEN_RATES;
}
