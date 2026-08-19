/**
 * Smart Model Router for Telestar Revenue Delivery OS (Directive Phase 1 §13, §14).
 * Classifies inbound tasks and selects the optimal cost/quality/latency provider and model.
 */

import { MODEL_REGISTRY, type ModelMetadata, getModelMetadata } from './registry';
import { circuitBreaker } from './circuitBreaker';

export type TaskComplexity = 'low' | 'standard' | 'deep';
export type TaskRisk = 'read' | 'draft' | 'low_risk_write' | 'business_write' | 'external_communication' | 'admin';

export interface RoutingCriteria {
  task: string;
  complexity?: TaskComplexity;
  risk?: TaskRisk;
  latencySensitive?: boolean;
  requiresTools?: boolean;
  requiresStructuredOutput?: boolean;
  requiresDeepReasoning?: boolean;
  requiresVision?: boolean;
  businessImportance?: 'low' | 'normal' | 'high' | 'critical';
  preferredModel?: string;
}

export interface RoutingDecision {
  primaryModel: ModelMetadata;
  fallbackModels: ModelMetadata[];
  rationale: string;
  estimatedCostTier: string;
}

export function routeModel(criteria: RoutingCriteria): RoutingDecision {
  // 1. Explicit model preference if available and healthy
  if (criteria.preferredModel) {
    const preferred = getModelMetadata(criteria.preferredModel);
    if (circuitBreaker.isAvailable(preferred.provider, preferred.modelId)) {
      return {
        primaryModel: preferred,
        fallbackModels: getFallbacks(preferred),
        rationale: `Honored explicit model preference: ${preferred.displayName}`,
        estimatedCostTier: preferred.costTier,
      };
    }
  }

  // 2. High-complexity / deep strategic analysis
  if (
    criteria.complexity === 'deep' ||
    criteria.requiresDeepReasoning ||
    criteria.businessImportance === 'critical'
  ) {
    const primary = selectHealthyModel(['gpt-5.6-sol', 'gemini-pro-latest', 'gpt-5.6-terra']);
    return {
      primaryModel: primary,
      fallbackModels: getFallbacks(primary),
      rationale: 'Routed to Deep Intelligence tier for multi-variable strategic analysis.',
      estimatedCostTier: primary.costTier,
    };
  }

  // 3. Low-complexity classification / extraction / fast summaries
  if (
    criteria.complexity === 'low' &&
    !criteria.requiresTools &&
    criteria.risk !== 'business_write'
  ) {
    const primary = selectHealthyModel([
      'gpt-5.6-luna',
      'llama-3.1-8b-instant',
      'llama-3.3-70b-versatile',
      'gemini-flash-latest',
    ]);
    return {
      primaryModel: primary,
      fallbackModels: getFallbacks(primary),
      rationale: 'Routed to Ultra-Fast/Low-Cost tier for lightweight classification or extraction.',
      estimatedCostTier: primary.costTier,
    };
  }

  // 4. Standard interactive SDR / CRM Copilot / Tool Execution
  const primary = selectHealthyModel([
    'gpt-5.6-terra',
    'gemini-flash-latest',
    'llama-3.3-70b-versatile',
  ]);
  return {
    primaryModel: primary,
    fallbackModels: getFallbacks(primary),
    rationale: 'Routed to Standard Flagship Intelligence tier for interactive CRM tool execution.',
    estimatedCostTier: primary.costTier,
  };
}

function selectHealthyModel(candidates: string[]): ModelMetadata {
  for (const alias of candidates) {
    const meta = MODEL_REGISTRY[alias];
    if (meta && circuitBreaker.isAvailable(meta.provider, meta.modelId)) {
      return meta;
    }
  }
  // Fallback to absolute default
  return MODEL_REGISTRY['gemini-flash-latest'] ?? MODEL_REGISTRY['llama-3.3-70b-versatile'];
}

function getFallbacks(primary: ModelMetadata): ModelMetadata[] {
  const fallbacks: ModelMetadata[] = [];
  const all = Object.values(MODEL_REGISTRY).filter(
    (m) => m.modelId !== primary.modelId && m.enabled && m.productionAllowed
  );

  // Sort by fallbackPriority then quality
  all.sort((a, b) => a.fallbackPriority - b.fallbackPriority);

  // Group by distinct providers to guarantee cross-provider resilience
  const seenProviders = new Set<string>([primary.provider]);
  for (const m of all) {
    if (!seenProviders.has(m.provider) && circuitBreaker.isAvailable(m.provider, m.modelId)) {
      fallbacks.push(m);
      seenProviders.add(m.provider);
    }
  }

  // Add same-provider backup if available
  for (const m of all) {
    if (!fallbacks.some((f) => f.modelId === m.modelId)) {
      fallbacks.push(m);
    }
  }

  return fallbacks;
}
