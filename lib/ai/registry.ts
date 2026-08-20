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
 * ## PARAMETER PROFILE
 *
 * The three providers do not accept the same request. These are observed facts, captured live
 * against the production credentials (see `scripts/ai-provider-smoke.ts`), not guesses:
 *
 *   - `gpt-5.6-luna` rejects `max_tokens` outright ("Use 'max_completion_tokens' instead"),
 *     rejects any `temperature` other than the default, and refuses function tools in
 *     /v1/chat/completions unless `reasoning_effort` is `'none'`.
 *   - `openai/gpt-oss-20b` takes the classic `max_tokens` + `temperature` pair.
 *   - Gemini takes neither — it is configured through the SDK's own generation config.
 *
 * The gateway reads `parameters` rather than branching on provider, because the difference is
 * per-model and the next model added may not match its provider's other models.
 */

export type ModelProvider = 'openai' | 'google' | 'groq';

export type ModelCostTier = 'ultra_low' | 'low' | 'standard' | 'premium';
export type ModelQualityTier = 'fast' | 'standard' | 'advanced' | 'deep_reasoning';
export type ModelLatencyTier = 'instant' | 'fast' | 'moderate' | 'reasoning';

/** How a model's request must be shaped. Observed per model, never assumed per provider. */
export interface ModelParameterProfile {
  /** Which output-length parameter the API accepts. `null` when the SDK takes neither. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens' | null;
  /** False when the model accepts only its default temperature. */
  supportsTemperature: boolean;
  /** True when function tools require `reasoning_effort: 'none'` on chat completions. */
  requiresReasoningEffortNoneForTools: boolean;
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
  costPer1kInputUsd: number;
  costPer1kOutputUsd: number;
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
    contextLimit: 400_000,
    maxOutputTokens: 8192,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 1,
    costPer1kInputUsd: 0.00125,
    costPer1kOutputUsd: 0.01,
    parameters: {
      maxTokensParam: 'max_completion_tokens',
      supportsTemperature: false,
      requiresReasoningEffortNoneForTools: true,
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
    contextLimit: 1_000_000,
    maxOutputTokens: 8192,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 2,
    costPer1kInputUsd: 0.000075,
    costPer1kOutputUsd: 0.0003,
    parameters: {
      maxTokensParam: null,
      supportsTemperature: true,
      requiresReasoningEffortNoneForTools: false,
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
    maxOutputTokens: 8192,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: false,
    fallbackPriority: 3,
    costPer1kInputUsd: 0.0001,
    costPer1kOutputUsd: 0.0005,
    parameters: {
      maxTokensParam: 'max_tokens',
      supportsTemperature: true,
      requiresReasoningEffortNoneForTools: false,
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
