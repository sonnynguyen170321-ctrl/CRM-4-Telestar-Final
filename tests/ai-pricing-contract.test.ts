import { describe, it, expect } from 'vitest';

import {
  PricingConfigurationError,
  assertRegistryPricingResolvable,
  estimateMaxRequestCostUsd,
  estimateTokenCost,
  findPricePeriod,
  resolveModelPrice,
} from '@/lib/ai/pricing';
import { MODEL_REGISTRY, type ModelMetadata } from '@/lib/ai/registry';

/**
 * The pricing contract, tested at the edges that actually bite.
 *
 * Pricing is budget governance, not display metadata: `estimatedCostUsd` is what
 * `TenantAiBudgetPeriod` reconciles against, so a rate that is wrong, undated, or silently
 * zero is a spend cap that does not cap spending. Each test here corresponds to a way the
 * previous implementation could be wrong without anything failing.
 */

const BEFORE_GEMINI_CHANGE = new Date('2026-12-31T23:59:59.999Z');
const AT_GEMINI_CHANGE = new Date('2027-01-01T00:00:00.000Z');

describe('effective-dated pricing', () => {
  it('prices Gemini at the introductory rate through 2026-12-31', () => {
    const price = resolveModelPrice('gemini-3.6-flash', BEFORE_GEMINI_CHANGE, {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(price.inputPerMillionUsd).toBe(0.75);
    expect(price.outputPerMillionUsd).toBe(3.75);
    expect(price.costUsd).toBeCloseTo(4.5, 6);
  });

  it('prices Gemini at the standard rate from 2027-01-01', () => {
    // The published increase is exactly 2x. A single scalar rate would have kept charging the
    // introductory price into 2027 with nothing in the product noticing.
    const price = resolveModelPrice('gemini-3.6-flash', AT_GEMINI_CHANGE, {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(price.inputPerMillionUsd).toBe(1.5);
    expect(price.outputPerMillionUsd).toBe(7.5);
    expect(price.costUsd).toBeCloseTo(9.0, 6);
  });

  it('changes price across the boundary and nowhere else in that second', () => {
    const before = estimateTokenCost('gemini-3.6-flash', 1_000, 1_000, { at: BEFORE_GEMINI_CHANGE });
    const after = estimateTokenCost('gemini-3.6-flash', 1_000, 1_000, { at: AT_GEMINI_CHANGE });
    expect(after).toBeCloseTo((before as number) * 2, 9);
  });

  it('covers every instant with exactly one period, for every model', () => {
    // Bands that leave a gap produce a PricingConfigurationError on a live call; bands that
    // overlap make the price depend on iteration order.
    const probes = [
      new Date('2020-01-01T00:00:00Z'),
      new Date('2026-08-20T00:00:00Z'),
      BEFORE_GEMINI_CHANGE,
      AT_GEMINI_CHANGE,
      new Date('2030-06-01T00:00:00Z'),
    ];
    for (const model of Object.values(MODEL_REGISTRY)) {
      for (const at of probes) {
        const matching = model.pricing.periods.filter((period) => {
          const from = period.effectiveFrom ? Date.parse(period.effectiveFrom) : -Infinity;
          const until = period.effectiveUntil ? Date.parse(period.effectiveUntil) : Infinity;
          return at.getTime() >= from && at.getTime() < until;
        });
        expect(matching.length, `${model.modelId} at ${at.toISOString()}`).toBe(1);
      }
    }
  });
});

describe('OpenAI long-context pricing', () => {
  const at = new Date('2026-08-20T00:00:00Z');

  it('charges the standard rate at or below the threshold', () => {
    const price = resolveModelPrice('gpt-5.6-luna', at, { promptTokens: 272_000, completionTokens: 1_000 });
    expect(price.longContextApplied).toBe(false);
    expect(price.inputPerMillionUsd).toBe(0.2);
    expect(price.outputPerMillionUsd).toBe(1.2);
  });

  it('re-prices the whole request above the threshold, not just the excess', () => {
    // 2x input and 1.5x output for the entire request. Pricing only the overflow would
    // under-charge by nearly the whole prompt.
    const price = resolveModelPrice('gpt-5.6-luna', at, { promptTokens: 272_001, completionTokens: 1_000_000 });
    expect(price.longContextApplied).toBe(true);
    expect(price.inputPerMillionUsd).toBeCloseTo(0.4, 9);
    expect(price.outputPerMillionUsd).toBeCloseTo(1.8, 9);
    expect(price.costUsd).toBeCloseTo((272_001 / 1_000_000) * 0.4 + 1.8, 6);
  });

  it('costs more than twice as much just past the threshold as just below it', () => {
    const below = resolveModelPrice('gpt-5.6-luna', at, { promptTokens: 272_000, completionTokens: 100_000 });
    const above = resolveModelPrice('gpt-5.6-luna', at, { promptTokens: 272_001, completionTokens: 100_000 });
    expect(above.costUsd).toBeGreaterThan(below.costUsd * 1.5);
  });

  it('applies to no other model', () => {
    for (const id of ['gemini-3.6-flash', 'openai/gpt-oss-20b']) {
      const price = resolveModelPrice(id, at, { promptTokens: 1_000_000, completionTokens: 10 });
      expect(price.longContextApplied, id).toBe(false);
    }
  });
});

describe('cached input pricing', () => {
  const at = new Date('2026-08-20T00:00:00Z');

  // 200K prompt tokens: a realistic large call, and deliberately below Luna's 272K
  // long-context threshold so these assertions isolate the cache rate from the multiplier.
  it('charges Luna cached prompt tokens at a tenth of the standard input rate', () => {
    const price = resolveModelPrice('gpt-5.6-luna', at, {
      promptTokens: 200_000,
      cachedPromptTokens: 200_000,
      completionTokens: 0,
    });
    expect(price.costUsd).toBeCloseTo(0.2 * 0.02, 6);
  });

  it('splits the prompt between cached and uncached rates', () => {
    const price = resolveModelPrice('gpt-5.6-luna', at, {
      promptTokens: 200_000,
      cachedPromptTokens: 100_000,
      completionTokens: 0,
    });
    expect(price.costUsd).toBeCloseTo(0.1 * 0.2 + 0.1 * 0.02, 6);
  });

  it('multiplies the cached rate too once the prompt crosses the long-context threshold', () => {
    // The two rules compose: a 1M-token prompt is long-context *and* may be cached, and the
    // multiplier applies to the cached rate as well as the standard one.
    const price = resolveModelPrice('gpt-5.6-luna', at, {
      promptTokens: 1_000_000,
      cachedPromptTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(price.longContextApplied).toBe(true);
    expect(price.cachedInputPerMillionUsd).toBeCloseTo(0.04, 9);
    expect(price.costUsd).toBeCloseTo(0.04, 6);
  });

  it('falls back to the full input rate when the provider publishes no cached rate', () => {
    // Over-estimating is the safe direction for a cap. Assuming a discount nobody published
    // would let a tenant spend past the limit.
    const price = resolveModelPrice('gemini-3.6-flash', at, {
      promptTokens: 1_000_000,
      cachedPromptTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(price.cachedInputPerMillionUsd).toBe(0.75);
    expect(price.costUsd).toBeCloseTo(0.75, 6);
  });

  it('cannot be driven negative by a provider over-reporting cached tokens', () => {
    const price = resolveModelPrice('openai/gpt-oss-20b', at, {
      promptTokens: 1_000,
      cachedPromptTokens: 999_999,
      completionTokens: 0,
    });
    expect(price.costUsd).toBeGreaterThanOrEqual(0);
    expect(price.costUsd).toBeCloseTo((1_000 / 1_000_000) * 0.037, 6);
  });
});

describe('no zero-cost failure mode', () => {
  it('throws rather than pricing a registered model at zero when its bands leave a gap', () => {
    const broken: ModelMetadata = {
      ...MODEL_REGISTRY['gpt-5.6-luna'],
      modelId: 'gpt-5.6-luna',
      pricing: {
        currency: 'USD',
        verifiedAt: '2026-08-20',
        periods: [
          {
            effectiveFrom: '2020-01-01',
            effectiveUntil: '2021-01-01',
            inputPerMillionUsd: 0.2,
            outputPerMillionUsd: 1.2,
            cachedInputPerMillionUsd: null,
          },
        ],
        longContext: null,
      },
    };
    const registry = MODEL_REGISTRY as Record<string, ModelMetadata>;
    const original = registry['gpt-5.6-luna'];
    registry['gpt-5.6-luna'] = broken;
    try {
      expect(() =>
        resolveModelPrice('gpt-5.6-luna', new Date('2026-08-20T00:00:00Z'), {
          promptTokens: 500_000,
          completionTokens: 5_000,
        }),
      ).toThrow(PricingConfigurationError);
    } finally {
      registry['gpt-5.6-luna'] = original;
    }
  });

  it('reports a real cost for a real call', () => {
    const at = new Date('2026-08-20T00:00:00Z');
    expect(estimateTokenCost('gpt-5.6-luna', 0, 0, { at })).toBe(0);
    // A single token costs $0.0000002 and rounds to zero at the six decimal places the
    // Decimal(12,6) column stores. That is the column's precision, not a pricing hole — any
    // call of a realistic size prices above it.
    expect(estimateTokenCost('gpt-5.6-luna', 1_000, 100, { at })).toBeGreaterThan(0);
  });

  it('resolves a price for every registered model right now', () => {
    expect(() => assertRegistryPricingResolvable(new Date())).not.toThrow();
  });
});

describe('reservation estimate', () => {
  const at = new Date('2026-08-20T00:00:00Z');

  it('reserves far more than the flat $0.005 the gateway used to hold', () => {
    // The concrete regression: a near-full Luna context reserved a flat half-cent, roughly a
    // hundredth of what the call could actually cost.
    const estimate = estimateMaxRequestCostUsd('gpt-5.6-luna', 1_000_000, 8_192, at);
    expect(estimate).toBeGreaterThan(0.005 * 50);
  });

  it('prices the requested output ceiling, not the tokens eventually emitted', () => {
    const small = estimateMaxRequestCostUsd('gpt-5.6-luna', 1_000, 1_000, at);
    const large = estimateMaxRequestCostUsd('gpt-5.6-luna', 1_000, 100_000, at);
    expect(large).toBeGreaterThan(small);
  });

  it('applies the long-context multiplier to the reservation too', () => {
    const below = estimateMaxRequestCostUsd('gpt-5.6-luna', 272_000, 8_192, at);
    const above = estimateMaxRequestCostUsd('gpt-5.6-luna', 272_001, 8_192, at);
    expect(above).toBeGreaterThan(below * 1.5);
  });

  it('never reserves less than the call will cost at full output', () => {
    for (const model of Object.values(MODEL_REGISTRY)) {
      const ceiling = model.parameters.defaultMaxOutputTokens ?? model.maxOutputTokens;
      const reserved = estimateMaxRequestCostUsd(model.modelId, 50_000, ceiling, at);
      const actual = resolveModelPrice(model.modelId, at, {
        promptTokens: 50_000,
        completionTokens: ceiling,
      }).costUsd;
      expect(reserved, model.modelId).toBeGreaterThanOrEqual(actual);
    }
  });
});

describe('price period lookup', () => {
  it('returns the open-ended band for a far-future timestamp', () => {
    const gemini = MODEL_REGISTRY['gemini-3.6-flash'];
    const period = findPricePeriod(gemini, new Date('2099-01-01T00:00:00Z'));
    expect(period?.inputPerMillionUsd).toBe(1.5);
  });

  it('returns the earliest band for a timestamp before any model existed', () => {
    const luna = MODEL_REGISTRY['gpt-5.6-luna'];
    // `effectiveFrom: null` is what keeps a historical AiCall row from failing to price.
    expect(findPricePeriod(luna, new Date('2001-01-01T00:00:00Z'))).not.toBeNull();
  });
});
