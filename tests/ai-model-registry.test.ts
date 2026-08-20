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

/**
 * The model contract, asserted as exact numbers.
 *
 * These replace assertions of the form `expect(cost).toBeGreaterThan(0)` and
 * `expect(estimateTokenCost(...)).toBeCloseTo(registry.costPer1kInput * 1000)`. Neither could
 * fail for any wrong value: the first passes for a price off by a factor of ten, and the
 * second compares the registry against itself, so it held while Gemini was priced at a tenth
 * of its real rate and every model claimed the same inherited 8192-token output ceiling.
 *
 * Verified against provider documentation on 2026-08-20. When a provider changes a number,
 * this test is supposed to fail — that is the signal to re-verify, not a reason to relax it.
 */
describe('model contract — exact limits', () => {
  it('carries GPT-5.6 Luna context and output limits', () => {
    const luna = MODEL_REGISTRY['gpt-5.6-luna'];
    expect(luna.contextLimit).toBe(1_050_000);
    expect(luna.maxOutputTokens).toBe(128_000);
    expect(luna.supportsTools).toBe(true);
    expect(luna.supportsStructuredOutput).toBe(true);
    expect(luna.supportsVision).toBe(true);
  });

  it('carries Gemini 3.6 Flash context and output limits', () => {
    const gemini = MODEL_REGISTRY['gemini-3.6-flash'];
    expect(gemini.contextLimit).toBe(1_048_576);
    expect(gemini.maxOutputTokens).toBe(65_536);
    expect(gemini.supportsTools).toBe(true);
    expect(gemini.supportsStructuredOutput).toBe(true);
  });

  it('carries Groq GPT-OSS 20B context and output limits', () => {
    const groq = MODEL_REGISTRY['openai/gpt-oss-20b'];
    expect(groq.contextLimit).toBe(131_072);
    expect(groq.maxOutputTokens).toBe(65_536);
    expect(groq.supportsTools).toBe(true);
    expect(groq.supportsStructuredOutput).toBe(true);
    // Open-weights text model — claiming vision would route image work to a model that
    // cannot see it.
    expect(groq.supportsVision).toBe(false);
  });

  it('never sends a parameter its provider has deprecated', () => {
    // Gemini's sampling parameters are ignored today and documented to error in a future
    // model generation. Declaring them unsupported is what keeps the adapter from sending
    // them, so both halves are asserted.
    const gemini = MODEL_REGISTRY['gemini-3.6-flash'];
    expect(gemini.parameters.supportsTemperature).toBe(false);
    expect(gemini.parameters.rejectedParameters).toContain('temperature');
    expect(gemini.parameters.rejectedParameters).toContain('top_p');
    expect(gemini.parameters.rejectedParameters).toContain('top_k');

    // Luna rejects both `max_tokens` and any non-default temperature.
    const luna = MODEL_REGISTRY['gpt-5.6-luna'];
    expect(luna.parameters.maxTokensParam).toBe('max_completion_tokens');
    expect(luna.parameters.supportsTemperature).toBe(false);
    expect(luna.parameters.rejectedParameters).toContain('max_tokens');
  });

  it('requests a default output ceiling that fits inside the context window', () => {
    // `maxOutputTokens` is the provider's hard limit; requesting it by default would push
    // `prompt + max_tokens` past the context window on a long conversation.
    for (const model of Object.values(MODEL_REGISTRY)) {
      const requested = model.parameters.defaultMaxOutputTokens;
      if (requested === null) continue;
      expect(requested).toBeLessThanOrEqual(model.maxOutputTokens);
      expect(requested).toBeLessThan(model.contextLimit / 2);
    }
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

  it('prices at the documented rate', () => {
    // Exact published rates, not a re-derivation from the registry. A test that multiplies the
    // registry by 1000 and compares it to the registry times 1000 cannot fail.
    const at = new Date('2026-08-20T00:00:00Z');
    // Luna: $0.20/M in + $1.20/M out. Deliberately below 272K prompt tokens — past that
    // threshold OpenAI re-prices the whole request, which `ai-pricing-contract.test.ts` covers.
    expect(estimateTokenCost('gpt-5.6-luna', 100_000, 100_000, { at })).toBeCloseTo(0.14, 6);
    // Gemini introductory: $0.75/M in + $3.75/M out.
    expect(estimateTokenCost('gemini-3.6-flash', 1_000_000, 1_000_000, { at })).toBeCloseTo(4.5, 6);
    // Groq: $0.075/M in + $0.30/M out.
    expect(estimateTokenCost('openai/gpt-oss-20b', 1_000_000, 1_000_000, { at })).toBeCloseTo(0.375, 6);
  });

  it('still returns null for a model nobody registered', () => {
    expect(estimateTokenCost('some-future-model', 1000, 1000)).toBeNull();
  });
});
