/**
 * Smart Model Router for Telestar Revenue Delivery OS (Directive Phase 1 §13, §14).
 *
 * Routing is a **filter pipeline, not a preference lookup**. Candidates are eliminated by
 * hard requirements first, and only what survives is ranked:
 *
 *   all models
 *     -> enabled?
 *     -> productionAllowed?
 *     -> provider configured?            (opt-in; see `requireConfiguredProvider`)
 *     -> circuit healthy?
 *     -> supports every required capability?
 *     -> rank by complexity / quality / cost preference
 *     -> PRIMARY + fallbacks drawn from the SAME surviving set
 *
 * Fallbacks come out of that set by construction, so a fallback can never satisfy weaker
 * requirements than the primary. That was TEL-P2-017: `requiresTools`, `requiresVision` and
 * `requiresStructuredOutput` were declared on the criteria and then never consulted, so a
 * vision request could be answered by a model with no vision, and the fallback list was
 * filtered on availability alone.
 *
 * An unknown `preferredModel` is never silently remapped. It either raises
 * `UnknownModelError` or produces a decision carrying an explicit `fallbackNotice`.
 */

import { circuitBreaker } from './circuitBreaker';
import { MODEL_REGISTRY, type ModelMetadata, findModelMetadata } from './registry';

export type TaskComplexity = 'low' | 'standard' | 'deep';
export type TaskRisk =
  | 'read'
  | 'draft'
  | 'low_risk_write'
  | 'business_write'
  | 'external_communication'
  | 'admin';

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

export interface RoutingOptions {
  /**
   * Restrict routing to providers that actually have credentials in this process.
   *
   * Off by default, deliberately. Routing is a policy decision and must stay decidable in
   * tests and in a CRM deployment that configures no AI provider at all - the gateway is
   * what discovers a provider is unusable. Release-time provider verification turns it on.
   */
  requireConfiguredProvider?: boolean;
  /** Raise `UnknownModelError` instead of returning a decision with a `fallbackNotice`. */
  strictPreferredModel?: boolean;
  /** Overrides configured-provider detection. Present so tests need not mutate process.env. */
  configuredProviders?: ReadonlySet<string>;
}

export interface FallbackNotice {
  requestedModel: string;
  fallbackModel: string;
  fallbackReason: string;
}

export interface RoutingDecision {
  primaryModel: ModelMetadata;
  fallbackModels: ModelMetadata[];
  rationale: string;
  estimatedCostTier: string;
  /** Set only when an explicitly requested model could not be honoured. */
  fallbackNotice?: FallbackNotice;
}

/** Raised when a requested model is not in the registry and strict mode is on. */
export class UnknownModelError extends Error {
  constructor(public readonly requestedModel: string) {
    super(`Unknown AI model "${requestedModel}". It is not a registry alias or model id.`);
    this.name = 'UnknownModelError';
  }
}

/** Raised when no model in the registry can satisfy the request's hard requirements. */
export class UnroutableRequestError extends Error {
  constructor(
    public readonly criteria: RoutingCriteria,
    public readonly reason: string,
  ) {
    super(`No AI model can satisfy this request: ${reason}`);
    this.name = 'UnroutableRequestError';
  }
}

const PROVIDER_ENV_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
};

/** Providers holding credentials in this process. Never returns or logs the values. */
export function configuredProviders(): ReadonlySet<string> {
  const configured = new Set<string>();
  for (const [provider, envKey] of Object.entries(PROVIDER_ENV_KEYS)) {
    if ((process.env[envKey] || '').trim().length > 0) configured.add(provider);
  }
  return configured;
}

/** The hard capability requirements a model must satisfy to be a candidate at all. */
function unmetCapabilities(model: ModelMetadata, criteria: RoutingCriteria): string[] {
  const unmet: string[] = [];
  if (criteria.requiresTools && !model.supportsTools) unmet.push('tools');
  if (criteria.requiresVision && !model.supportsVision) unmet.push('vision');
  if (criteria.requiresStructuredOutput && !model.supportsStructuredOutput) {
    unmet.push('structured output');
  }
  return unmet;
}

interface Rejection {
  model: ModelMetadata;
  reason: string;
}

/**
 * Applies every hard filter, returning survivors and why each rejection happened. The
 * rejection reasons are what makes a routing failure debuggable instead of mysterious.
 */
function filterCandidates(
  criteria: RoutingCriteria,
  options: RoutingOptions,
): { eligible: ModelMetadata[]; rejected: Rejection[] } {
  const configured = options.configuredProviders ?? (options.requireConfiguredProvider ? configuredProviders() : null);
  const eligible: ModelMetadata[] = [];
  const rejected: Rejection[] = [];

  for (const model of Object.values(MODEL_REGISTRY)) {
    if (!model.enabled) {
      rejected.push({ model, reason: 'disabled in the registry' });
      continue;
    }
    if (!model.productionAllowed) {
      rejected.push({ model, reason: 'not permitted in production' });
      continue;
    }
    if (options.requireConfiguredProvider && configured && !configured.has(model.provider)) {
      rejected.push({ model, reason: `provider ${model.provider} has no configured credentials` });
      continue;
    }
    if (!circuitBreaker.isAvailable(model.provider, model.modelId)) {
      rejected.push({ model, reason: 'circuit is open' });
      continue;
    }
    const unmet = unmetCapabilities(model, criteria);
    if (unmet.length > 0) {
      rejected.push({ model, reason: `does not support ${unmet.join(', ')}` });
      continue;
    }
    eligible.push(model);
  }

  return { eligible, rejected };
}

/**
 * Preference order per tier. Ranking only ever reorders models that already qualified.
 *
 * Three models, so every tier lists all three — the tiers express *which one leads*, and the
 * remainder is the failover chain. Listing every approved model in every tier is what keeps a
 * single-provider outage from making a tier unroutable.
 *
 *   deep     — high context and long-document work leads with Gemini's million-token window.
 *   fast     — latency-sensitive and background work leads with Groq.
 *   standard — interactive CRM conversation and tool execution leads with Luna.
 */
const DEEP_TIER = ['gemini-3.6-flash', 'gpt-5.6-luna', 'openai/gpt-oss-20b'];
const FAST_TIER = ['openai/gpt-oss-20b', 'gpt-5.6-luna', 'gemini-3.6-flash'];
const STANDARD_TIER = ['gpt-5.6-luna', 'gemini-3.6-flash', 'openai/gpt-oss-20b'];

function preferenceOrder(criteria: RoutingCriteria): { aliases: string[]; rationale: string } {
  if (
    criteria.complexity === 'deep' ||
    criteria.requiresDeepReasoning ||
    criteria.businessImportance === 'critical'
  ) {
    return {
      aliases: DEEP_TIER,
      rationale: 'Routed to Deep Intelligence tier for multi-variable strategic analysis.',
    };
  }
  if (criteria.complexity === 'low' && !criteria.requiresTools && criteria.risk !== 'business_write') {
    return {
      aliases: FAST_TIER,
      rationale: 'Routed to Ultra-Fast/Low-Cost tier for lightweight classification or extraction.',
    };
  }
  return {
    aliases: STANDARD_TIER,
    rationale: 'Routed to Standard Flagship Intelligence tier for interactive CRM tool execution.',
  };
}

/** Highest-preference eligible model, falling back to registry fallbackPriority order. */
function rank(eligible: ModelMetadata[], aliases: string[]): ModelMetadata[] {
  const byAlias = new Map(eligible.map((model) => [model.internalAlias, model]));
  const ordered: ModelMetadata[] = [];

  for (const alias of aliases) {
    const model = byAlias.get(alias);
    if (model) ordered.push(model);
  }
  const remaining = eligible
    .filter((model) => !ordered.includes(model))
    .sort((a, b) => a.fallbackPriority - b.fallbackPriority);

  return [...ordered, ...remaining];
}

/**
 * Fallbacks are drawn from the eligible set, cross-provider first so a single provider
 * outage cannot take out the whole chain.
 */
function buildFallbacks(primary: ModelMetadata, ranked: ModelMetadata[]): ModelMetadata[] {
  const rest = ranked.filter((model) => model.modelId !== primary.modelId);
  const crossProvider: ModelMetadata[] = [];
  const sameProvider: ModelMetadata[] = [];
  const seenProviders = new Set<string>([primary.provider]);

  for (const model of rest) {
    if (!seenProviders.has(model.provider)) {
      crossProvider.push(model);
      seenProviders.add(model.provider);
    } else {
      sameProvider.push(model);
    }
  }
  return [...crossProvider, ...sameProvider];
}

function decide(
  criteria: RoutingCriteria,
  options: RoutingOptions,
  fallbackNotice?: FallbackNotice,
): RoutingDecision {
  const { eligible, rejected } = filterCandidates(criteria, options);

  if (eligible.length === 0) {
    const required = [
      criteria.requiresTools ? 'tools' : null,
      criteria.requiresVision ? 'vision' : null,
      criteria.requiresStructuredOutput ? 'structured output' : null,
    ].filter(Boolean);
    const detail = required.length > 0 ? `requires ${required.join(', ')}` : 'no capability requirements';
    throw new UnroutableRequestError(
      criteria,
      `${detail}; all ${rejected.length} registry models were rejected (${summariseRejections(rejected)})`,
    );
  }

  const { aliases, rationale } = preferenceOrder(criteria);
  const ranked = rank(eligible, aliases);
  const primaryModel = ranked[0];

  return {
    primaryModel,
    fallbackModels: buildFallbacks(primaryModel, ranked),
    rationale,
    estimatedCostTier: primaryModel.costTier,
    ...(fallbackNotice ? { fallbackNotice } : {}),
  };
}

function summariseRejections(rejected: Rejection[]): string {
  const counts = new Map<string, number>();
  for (const entry of rejected) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts.entries()].map(([reason, count]) => `${count} ${reason}`).join('; ');
}

export function routeModel(criteria: RoutingCriteria, options: RoutingOptions = {}): RoutingDecision {
  // 'auto' is the product's way of saying "no preference" — the default every SDR sees. It is
  // not a model, so it must not reach `findModelMetadata` and be reported as unknown.
  if (!criteria.preferredModel || criteria.preferredModel === 'auto') return decide(criteria, options);

  const requested = findModelMetadata(criteria.preferredModel);

  if (!requested) {
    if (options.strictPreferredModel) throw new UnknownModelError(criteria.preferredModel);
    const decision = decide(criteria, options);
    return {
      ...decision,
      fallbackNotice: {
        requestedModel: criteria.preferredModel,
        fallbackModel: decision.primaryModel.internalAlias,
        fallbackReason: 'requested model is not present in the registry',
      },
    };
  }

  const { eligible } = filterCandidates(criteria, options);
  const honoured = eligible.find((model) => model.modelId === requested.modelId);

  if (honoured) {
    const ranked = rank(eligible, [honoured.internalAlias]);
    return {
      primaryModel: honoured,
      fallbackModels: buildFallbacks(honoured, ranked),
      rationale: `Honored explicit model preference: ${honoured.displayName}`,
      estimatedCostTier: honoured.costTier,
    };
  }

  // The model exists but cannot serve this request. Say exactly why rather than
  // substituting one silently.
  const unmet = unmetCapabilities(requested, criteria);
  const reason = !requested.enabled
    ? 'requested model is disabled in the registry'
    : !requested.productionAllowed
      ? 'requested model is not permitted in production'
      : unmet.length > 0
        ? `requested model does not support ${unmet.join(', ')}`
        : 'requested model is unavailable: its circuit is open';

  if (options.strictPreferredModel) throw new UnroutableRequestError(criteria, reason);

  const decision = decide(criteria, options);
  return {
    ...decision,
    fallbackNotice: {
      requestedModel: requested.internalAlias,
      fallbackModel: decision.primaryModel.internalAlias,
      fallbackReason: reason,
    },
  };
}
