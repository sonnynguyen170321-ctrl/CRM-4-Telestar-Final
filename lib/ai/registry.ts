/**
 * Central Model Registry for Telestar AI.
 *
 * The single authoritative source of truth for every model the product may call in
 * production. Three models, one per provider, and **the alias is the provider's own model
 * id** — see `ATTRIBUTION` below for why that is not merely tidy.
 *
 * ## ATTRIBUTION
 *
 * This registry used to carry invented aliases over a different `modelId`: `gpt-5.6-luna`
 * routed to `gpt-4o-mini`, `gpt-5.6-terra` to `gpt-4o`, `gpt-5.6-sol` to `o3-mini`. Every
 * `AiCall` row therefore named a model that was never called, and a cost review of the ledger
 * was reading fiction. `gpt-5.6-luna` is a real OpenAI model id that answers directly; there
 * was never anything to translate. `internalAlias === modelId` is now an invariant, asserted
 * in `tests/ai-model-registry.test.ts`, so the two cannot drift apart again.
 *
 * ## LIMITS AND PRICING ARE DATED FACTS, NOT CONSTANTS
 *
 * Every number below was re-read from the provider's own documentation on `verifiedAt`, and
 * the values it replaced were wrong in both directions — Gemini input was priced at $0.075/M
 * against a real $0.75/M (10x under), Luna output at $10/M against a real $1.20/M (8x over),
 * and every `maxOutputTokens` was the same inherited 8192 regardless of model. A budget
 * governed by those numbers is not governing anything.
 * `docs/telestar-ai-remediation/MODEL_VERIFICATION.json` carries the same facts in
 * machine-readable form, with the source URL for each.
 *
 * Pricing is **effective-dated** because one of the three providers has already published a
 * future change: Gemini's introductory rate ends 2026-12-31. A scalar price would become
 * silently wrong on 2027-01-01 and nothing in the product would notice.
 *
 * ## PARAMETER PROFILE
 *
 * The three providers do not accept the same request. These are observed facts, captured live
 * against the production credentials (see `scripts/ai-provider-smoke.ts`), not guesses:
 *
 *   - `gpt-5.6-luna` rejects `max_tokens` outright ("Use 'max_completion_tokens' instead"),
 *     rejects any `temperature` other than the default, and refuses function tools in
 *     /v1/chat/completions unless `reasoning_effort` is `'none'`.
 *   - `openai/gpt-oss-20b` takes the classic `max_tokens` + `temperature` pair.
 *   - `gemini-3.6-flash` takes neither, and `temperature`, `top_p` and `top_k` are
 *     **deprecated**: accepted and ignored today, an error in a future model generation per
 *     Google's migration notes. Sending a parameter the provider has announced it will reject
 *     is a scheduled outage, so they are not sent at all.
 *
 * The gateway reads `parameters` rather than branching on provider, because the difference is
 * per-model and the next model added may not match its provider's other models.
 */

export type ModelProvider = 'openai' | 'google' | 'groq';

export type ModelCostTier = 'ultra_low' | 'low' | 'standard' | 'premium';
export type ModelQualityTier = 'fast' | 'standard' | 'advanced' | 'deep_reasoning';
export type ModelLatencyTier = 'instant' | 'fast' | 'moderate' | 'reasoning';

/** Gemini 3 replaced the numeric `thinking_budget` with this enum. */
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

/** How a model's request must be shaped. Observed per model, never assumed per provider. */
export interface ModelParameterProfile {
  /** Which output-length parameter the API accepts. `null` when the SDK takes neither. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens' | null;
  /**
   * What to request when the caller names no ceiling — a policy, not a provider fact.
   *
   * Kept separate from `maxOutputTokens`, which is the provider's hard limit. Requesting the
   * hard limit by default is not free: the OpenAI-compatible providers require
   * `prompt + max_tokens` to fit the context window, so defaulting Groq to its full 65,536
   * would 400 any conversation over ~65K tokens. The ceiling is a fact to price against; this
   * is the number actually sent.
   */
  defaultMaxOutputTokens: number | null;
  /** False when the model accepts only its default temperature, or has deprecated it. */
  supportsTemperature: boolean;
  /** True when function tools require `reasoning_effort: 'none'` on chat completions. */
  requiresReasoningEffortNoneForTools: boolean;
  /**
   * Parameters the provider documents as deprecated or unsupported for this model. The
   * adapter must never send these. `tests/ai-model-registry.test.ts` asserts the list is
   * honoured by the request builder rather than merely declared here.
   */
  rejectedParameters: readonly string[];
  /** Thinking level to request, for models that take one. `null` when the concept is absent. */
  defaultThinkingLevel: ThinkingLevel | null;
}

/**
 * One dated price band.
 *
 * `effectiveFrom: null` means "since the beginning of the ledger" and `effectiveUntil: null`
 * means "until further notice", so the bands tile with no gap and a historical `AiCall`
 * always resolves to exactly one rate. `effectiveUntil` is exclusive.
 */
export interface ModelPricePeriod {
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  /** Rate for prompt tokens served from the provider's cache. `null` when not published. */
  cachedInputPerMillionUsd: number | null;
  /** Surcharge to write the cache, where the provider bills one separately. */
  cachedInputWritePerMillionUsd?: number | null;
}

/**
 * A provider that re-prices the *entire* request once the prompt crosses a threshold.
 *
 * OpenAI does this for Luna above 272K input tokens, and it is not a rounding error: the same
 * request costs 2x input and 1.5x output. An estimator that ignores it under-reserves by 100%
 * on exactly the largest calls — the ones that could exhaust a tenant's month.
 */
export interface LongContextPricingRule {
  promptTokensAbove: number;
  inputMultiplier: number;
  outputMultiplier: number;
}

export interface ModelPricing {
  currency: 'USD';
  /** ISO date the rates below were last read from the provider's own documentation. */
  verifiedAt: string;
  /** Ordered oldest-first. Must tile without gap or overlap. */
  periods: readonly ModelPricePeriod[];
  longContext: LongContextPricingRule | null;
}

export interface ModelMetadata {
  provider: ModelProvider;
  modelId: string;
  /** Always equal to `modelId`. Kept as a distinct field so callers reading either are correct. */
  internalAlias: string;
  displayName: string;
  description: string;
  productionAllowed: boolean;
  enabled: boolean;
  purpose: 'classification' | 'extraction' | 'general_chat' | 'tool_execution' | 'deep_analysis' | 'drafting';
  costTier: ModelCostTier;
  qualityTier: ModelQualityTier;
  latencyTier: ModelLatencyTier;
  contextLimit: number;
  maxOutputTokens: number;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
  supportsVision: boolean;
  fallbackPriority: number; // 1 = highest
  /**
   * The only price for this model. There is deliberately no scalar `costPer1kInputUsd`
   * beside it: a second price field is a second source of truth about the same model, and
   * the pair drifts the moment one of them is updated.
   */
  pricing: ModelPricing;
  parameters: ModelParameterProfile;
}

export const MODEL_REGISTRY: Record<string, ModelMetadata> = {
  // ── OpenAI — primary Telestar intelligence ─────────────────────────────────
  'gpt-5.6-luna': {
    provider: 'openai',
    modelId: 'gpt-5.6-luna',
    internalAlias: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    description:
      'Primary Telestar reasoning model: CRM conversation, SDR coaching, lead analysis, summaries, classification, structured extraction, meeting prep and tool-aware assistance.',
    productionAllowed: true,
    enabled: true,
    purpose: 'tool_execution',
    costTier: 'standard',
    qualityTier: 'advanced',
    latencyTier: 'fast',
    contextLimit: 1_050_000,
    maxOutputTokens: 128_000,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 1,
    pricing: {
      currency: 'USD',
      verifiedAt: '2026-08-20',
      periods: [
        {
          effectiveFrom: null,
          effectiveUntil: null,
          inputPerMillionUsd: 0.2,
          outputPerMillionUsd: 1.2,
          cachedInputPerMillionUsd: 0.02,
          cachedInputWritePerMillionUsd: 0.25,
        },
      ],
      longContext: {
        promptTokensAbove: 272_000,
        inputMultiplier: 2,
        outputMultiplier: 1.5,
      },
    },
    parameters: {
      maxTokensParam: 'max_completion_tokens',
      defaultMaxOutputTokens: 8192,
      supportsTemperature: false,
      requiresReasoningEffortNoneForTools: true,
      rejectedParameters: ['max_tokens', 'temperature'],
      defaultThinkingLevel: null,
    },
  },

  // ── Google — high-context, multimodal, creative drafting, cross-provider fallback ──
  'gemini-3.6-flash': {
    provider: 'google',
    modelId: 'gemini-3.6-flash',
    internalAlias: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    description:
      'High-context multimodal model for large-document work, fast secondary generation, creative drafting, and cross-provider fallback.',
    productionAllowed: true,
    enabled: true,
    purpose: 'general_chat',
    costTier: 'low',
    qualityTier: 'standard',
    latencyTier: 'fast',
    contextLimit: 1_048_576,
    maxOutputTokens: 65_536,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 2,
    pricing: {
      currency: 'USD',
      verifiedAt: '2026-08-20',
      periods: [
        {
          // Introductory rate. Google has published its end date, so it is encoded as an end
          // date rather than as "the price".
          effectiveFrom: null,
          effectiveUntil: '2027-01-01',
          inputPerMillionUsd: 0.75,
          outputPerMillionUsd: 3.75,
          // Gemini supports context caching, but Google publishes no separate cached-input
          // rate for this model. Cached prompt tokens are therefore charged at the full input
          // rate, which over-estimates rather than under-estimates — the safe direction for a
          // spend cap.
          cachedInputPerMillionUsd: null,
        },
        {
          effectiveFrom: '2027-01-01',
          effectiveUntil: null,
          inputPerMillionUsd: 1.5,
          outputPerMillionUsd: 7.5,
          cachedInputPerMillionUsd: null,
        },
      ],
      longContext: null,
    },
    parameters: {
      maxTokensParam: null,
      defaultMaxOutputTokens: null,
      // Deprecated by Google for this model generation: accepted and ignored today, an error
      // in a future one. Not sent at all.
      supportsTemperature: false,
      requiresReasoningEffortNoneForTools: false,
      rejectedParameters: ['temperature', 'top_p', 'top_k', 'thinking_budget'],
      defaultThinkingLevel: 'medium',
    },
  },

  // ── Groq — very low latency, background and high-throughput work ────────────
  'openai/gpt-oss-20b': {
    provider: 'groq',
    modelId: 'openai/gpt-oss-20b',
    internalAlias: 'openai/gpt-oss-20b',
    displayName: 'Groq GPT-OSS 20B',
    description:
      'Very-low-latency open-weights model for background work, fast transformations, lightweight reasoning and high-throughput tasks.',
    productionAllowed: true,
    enabled: true,
    purpose: 'general_chat',
    costTier: 'ultra_low',
    qualityTier: 'fast',
    latencyTier: 'instant',
    contextLimit: 131_072,
    maxOutputTokens: 65_536,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: false,
    fallbackPriority: 3,
    pricing: {
      currency: 'USD',
      verifiedAt: '2026-08-20',
      periods: [
        {
          effectiveFrom: null,
          effectiveUntil: null,
          inputPerMillionUsd: 0.075,
          outputPerMillionUsd: 0.3,
          cachedInputPerMillionUsd: 0.037,
        },
      ],
      longContext: null,
    },
    parameters: {
      maxTokensParam: 'max_tokens',
      defaultMaxOutputTokens: 8192,
      supportsTemperature: true,
      requiresReasoningEffortNoneForTools: false,
      rejectedParameters: [],
      defaultThinkingLevel: null,
    },
  },
};

/** Every alias permitted in production, in registry order. */
export const APPROVED_MODEL_ALIASES = Object.keys(MODEL_REGISTRY);

/**
 * Looks a model up by registry alias or provider model id. Returns `null` when there is
 * no such model.
 *
 * This is the lookup routing uses. It deliberately has no default: an earlier behaviour
 * returned a flagship for any unrecognised string, so a typo, a decommissioned model id, or a
 * model from another vendor all silently became "route to the flagship" — a request answered
 * by a model nobody chose, with no signal that a substitution happened (TEL-P2-017).
 */
export function findModelMetadata(aliasOrId: string): ModelMetadata | null {
  return (
    MODEL_REGISTRY[aliasOrId] ??
    Object.values(MODEL_REGISTRY).find((model) => model.modelId === aliasOrId) ??
    null
  );
}

/** Strict lookup. Throws rather than substituting a model the caller did not ask for. */
export function getModelMetadata(aliasOrId: string): ModelMetadata {
  const model = findModelMetadata(aliasOrId);
  if (!model) {
    throw new Error(`Unknown AI model "${aliasOrId}". It is not a registry alias or model id.`);
  }
  return model;
}
