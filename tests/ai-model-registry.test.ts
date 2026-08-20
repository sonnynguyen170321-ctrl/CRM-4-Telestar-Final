import { describe, it, expect } from 'vitest';
import { MODEL_REGISTRY, APPROVED_MODEL_ALIASES, findModelMetadata } from '@/lib/ai/registry';
import { MODEL_LABELS, MODEL_DESCRIPTIONS, SELECTABLE_MODEL_IDS, DEFAULT_MODEL, isKnownModelId } from '@/lib/ai/models';
import { hasTokenRate, estimateTokenCost } from '@/lib/ai/pricing';

/**
 * The registry invariants, as regression tests.
 *
 * Each one pins a failure that actually shipped:
 *
 *   - the alias/modelId split let `gpt-5.6-luna` mean `gpt-4o-mini`, so every ledger row named
 *     a model that was never called;
 *   - the client-side model list drifted from the registry and went on offering three Groq
 *     models that had been withdrawn, which is what produced the production chat outage;
 *   - the price table named models the product no longer calls and none of the ones it does,
 *     so real spend reconciled to zero.
 */

const APPROVED = ['gpt-5.6-luna', 'gemini-3.6-flash', 'openai/gpt-oss-20b'];

/** Anything that must never appear as a production-routable model again. */
const RETIRED_MODEL_IDS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o3-mini',
  'gpt-5.6-terra',
  'gpt-5.6-sol',
  'gemini-1.5-flash',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-flash-latest',
  'gemini-pro-latest',
  'gemini-3.1-pro-preview',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
  'llama3-70b-8192',
  'gemma2-9b-it',
];

describe('model registry', () => {
  it('contains exactly the three approved production models', () => {
    expect(APPROVED_MODEL_ALIASES.sort()).toEqual([...APPROVED].sort());
  });

  it('never names a model it does not call', () => {
    // The invariant that makes `AiCall.model` trustworthy. Reintroducing an alias layer over a
    // different id reintroduces false attribution, silently.
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.internalAlias, `alias drift on ${model.displayName}`).toBe(model.modelId);
    }
  });

  it('routes one model per provider, all production-allowed and enabled', () => {
    const providers = Object.values(MODEL_REGISTRY).map((m) => m.provider);
    expect(new Set(providers)).toEqual(new Set(['openai', 'google', 'groq']));
    for (const model of Object.values(MODEL_REGISTRY)) {
      expect(model.productionAllowed).toBe(true);
      expect(model.enabled).toBe(true);
      expect(model.supportsTools).toBe(true);
    }
  });

  it('resolves no retired model id', () => {
    for (const retired of RETIRED_MODEL_IDS) {
      expect(findModelMetadata(retired), `${retired} is still routable`).toBeNull();
    }
  });

  it('declares a parameter profile for every model', () => {
    // These are observed API contracts, not preferences: sending `max_tokens` to Luna is a
    // 400, and so is any temperature but the default.
    const luna = MODEL_REGISTRY['gpt-5.6-luna'];
    expect(luna.parameters.maxTokensParam).toBe('max_completion_tokens');
    expect(luna.parameters.supportsTemperature).toBe(false);
    expect(luna.parameters.requiresReasoningEffortNoneForTools).toBe(true);

    expect(MODEL_REGISTRY['openai/gpt-oss-20b'].parameters.maxTokensParam).toBe('max_tokens');
    expect(MODEL_REGISTRY['gemini-3.6-flash'].parameters.maxTokensParam).toBeNull();
  });
});

describe('client-safe model list', () => {
  it('matches the registry exactly', () => {
    expect([...SELECTABLE_MODEL_IDS].sort()).toEqual([...APPROVED_MODEL_ALIASES].sort());
  });

  it("defaults to 'auto' so no saved preference can pin a retired model", () => {
    expect(DEFAULT_MODEL).toBe('auto');
  });

  it('labels and describes every selectable id plus auto', () => {
    for (const id of ['auto', ...SELECTABLE_MODEL_IDS] as const) {
      expect(MODEL_LABELS[id]).toBeTruthy();
      expect(MODEL_DESCRIPTIONS[id]).toBeTruthy();
    }
  });

  it('rejects a retired id, so a stale stored preference is ignored rather than sent', () => {
    for (const retired of RETIRED_MODEL_IDS) {
      expect(isKnownModelId(retired), `${retired} still accepted from a client`).toBe(false);
    }
    expect(isKnownModelId('auto')).toBe(true);
  });
});

describe('pricing coverage', () => {
  it('prices every approved model', () => {
    // A model the product calls but pricing does not know produces a null cost on every call
    // it serves, a zero-cost budget reconciliation, and a spend report that reads as free.
    for (const id of SELECTABLE_MODEL_IDS) {
      expect(hasTokenRate(id), `no rate for ${id}`).toBe(true);
      expect(estimateTokenCost(id, 1_000_000, 1_000_000)).toBeGreaterThan(0);
    }
  });

  it('derives its rates from the registry rather than a second table', () => {
    const luna = MODEL_REGISTRY['gpt-5.6-luna'];
    const expected = luna.costPer1kInputUsd * 1000 + luna.costPer1kOutputUsd * 1000;
    expect(estimateTokenCost('gpt-5.6-luna', 1_000_000, 1_000_000)).toBeCloseTo(expected, 6);
  });

  it('still returns null for a model nobody registered', () => {
    expect(estimateTokenCost('some-future-model', 1000, 1000)).toBeNull();
  });
});
