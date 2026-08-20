/**
 * Central Model Registry for Telestar Revenue Delivery OS (Directive Phase 1 §12).
 * Single authoritative source of truth for all AI models, tiers, and capabilities.
 */

export type ModelProvider = 'openai' | 'google' | 'groq';

export type ModelCostTier = 'ultra_low' | 'low' | 'standard' | 'premium';
export type ModelQualityTier = 'fast' | 'standard' | 'advanced' | 'deep_reasoning';
export type ModelLatencyTier = 'instant' | 'fast' | 'moderate' | 'reasoning';

export interface ModelMetadata {
  provider: ModelProvider;
  modelId: string;
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
}

export const MODEL_REGISTRY: Record<string, ModelMetadata> = {
  // ── OpenAI Production Models (Primary Intelligence) ──────────────────────────
  'gpt-5.6-luna': {
    provider: 'openai',
    modelId: 'gpt-4o-mini', // Maps to high-throughput tier in API
    internalAlias: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    description: 'High-volume low-complexity intelligence for classification, extraction, and triage.',
    productionAllowed: true,
    enabled: true,
    purpose: 'classification',
    costTier: 'ultra_low',
    qualityTier: 'fast',
    latencyTier: 'instant',
    contextLimit: 128_000,
    maxOutputTokens: 4096,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 1,
    costPer1kInputUsd: 0.00015,
    costPer1kOutputUsd: 0.0006,
  },
  'gpt-5.6-terra': {
    provider: 'openai',
    modelId: 'gpt-4o', // Primary interactive flagship in API
    internalAlias: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    description: 'Core interactive Telestar AI for CRM tool execution, meeting prep, and SDR coaching.',
    productionAllowed: true,
    enabled: true,
    purpose: 'tool_execution',
    costTier: 'standard',
    qualityTier: 'advanced',
    latencyTier: 'fast',
    contextLimit: 128_000,
    maxOutputTokens: 4096,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 1,
    costPer1kInputUsd: 0.0025,
    costPer1kOutputUsd: 0.01,
  },
  'gpt-5.6-sol': {
    provider: 'openai',
    modelId: 'o3-mini', // Deep reasoning tier in API
    internalAlias: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    description: 'Deep reasoning intelligence for campaign diagnosis, recovery planning, and executive strategy.',
    productionAllowed: true,
    enabled: true,
    purpose: 'deep_analysis',
    costTier: 'premium',
    qualityTier: 'deep_reasoning',
    latencyTier: 'reasoning',
    contextLimit: 200_000,
    maxOutputTokens: 16384,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: false,
    fallbackPriority: 1,
    costPer1kInputUsd: 0.005,
    costPer1kOutputUsd: 0.02,
  },

  // ── Google / Vertex AI Models (Enterprise Fallback & Multimodal) ───────────
  'gemini-flash-latest': {
    provider: 'google',
    modelId: 'gemini-2.5-flash',
    internalAlias: 'gemini-flash-latest',
    displayName: 'Gemini 2.5 Flash',
    description: 'Ultra-fast multimodal model for creative drafting, subject lines, and primary tool fallback.',
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
  },
  'gemini-pro-latest': {
    provider: 'google',
    modelId: 'gemini-2.5-pro',
    internalAlias: 'gemini-pro-latest',
    displayName: 'Gemini 2.5 Pro',
    description: 'High-context reasoning model for complex campaign retrospectives and large document analysis.',
    productionAllowed: true,
    enabled: true,
    purpose: 'deep_analysis',
    costTier: 'standard',
    qualityTier: 'advanced',
    latencyTier: 'moderate',
    contextLimit: 2_000_000,
    maxOutputTokens: 8192,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: true,
    fallbackPriority: 2,
    costPer1kInputUsd: 0.00125,
    costPer1kOutputUsd: 0.005,
  },

  // ── Groq Models (Ultra-Low Latency & High-Throughput Background Tier) ───────
  'llama-3.3-70b-versatile': {
    provider: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    internalAlias: 'llama-3.3-70b-versatile',
    displayName: 'Llama 3.3 70B',
    description: 'Fast open-weights model for high-throughput memory summarization and draft assist.',
    productionAllowed: true,
    enabled: true,
    purpose: 'general_chat',
    costTier: 'low',
    qualityTier: 'standard',
    latencyTier: 'instant',
    contextLimit: 128_000,
    maxOutputTokens: 4096,
    supportsStructuredOutput: true,
    supportsTools: true,
    supportsVision: false,
    fallbackPriority: 3,
    costPer1kInputUsd: 0.00059,
    costPer1kOutputUsd: 0.00079,
  },
  'llama-3.1-8b-instant': {
    provider: 'groq',
    modelId: 'llama-3.1-8b-instant',
    internalAlias: 'llama-3.1-8b-instant',
    displayName: 'Llama 3.1 8B Instant',
    description: 'Sub-second classification and entity extraction for high-velocity signal ingestion.',
    productionAllowed: true,
    enabled: true,
    purpose: 'extraction',
    costTier: 'ultra_low',
    qualityTier: 'fast',
    latencyTier: 'instant',
    contextLimit: 128_000,
    maxOutputTokens: 2048,
    supportsStructuredOutput: true,
    supportsTools: false,
    supportsVision: false,
    fallbackPriority: 3,
    costPer1kInputUsd: 0.00005,
    costPer1kOutputUsd: 0.00008,
  },
};

/**
 * Looks a model up by registry alias or provider model id. Returns `null` when there is
 * no such model.
 *
 * This is the lookup routing uses. It deliberately has no default: the previous behaviour
 * returned Terra for any unrecognised string, so a typo, a decommissioned model id, or a
 * model from another vendor all silently became "route to Terra" — a request answered by a
 * model nobody chose, with no signal that a substitution happened (TEL-P2-017).
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
