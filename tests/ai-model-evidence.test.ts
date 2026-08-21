import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { MODEL_REGISTRY } from '@/lib/ai/registry';

/**
 * The registry and its evidence file must agree.
 *
 * `lib/ai/registry.ts` is the runtime source of truth for every model limit and price.
 * `docs/telestar-ai-remediation/MODEL_VERIFICATION.json` is the record of where each of those
 * numbers came from, with a source URL and a verification date. The registry's own header says
 * the file "carries the same facts in machine-readable form".
 *
 * Nothing checked that. Two files claiming the same facts, with no test between them, is the
 * setup for exactly the failure the registry header describes: prices that were "$0.075/M
 * against a real $0.75/M (10x under)" and "$10/M against a real $1.20/M (8x over)", governing a
 * budget that was therefore governing nothing.
 *
 * A wrong price is not a cosmetic defect. It feeds `lib/ai/budget.ts`, so a 10x under-estimate
 * is a spend cap that does not cap, and a 8x over-estimate refuses work the tenant has paid
 * for. Both are silent.
 *
 * This is a drift guard, not a correctness check: it cannot tell whether either file matches
 * what the provider charges today. Re-verifying against provider documentation is a human act,
 * and `verifiedAt` is when someone last did it.
 */

interface EvidencePeriod {
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  perMillionTokens: { input: number; output: number };
}

interface EvidenceModel {
  modelId: string;
  provider: string;
  contextLimit: number;
  maxOutputTokens: number;
  sources?: unknown[];
  pricing: {
    periods?: EvidencePeriod[];
    perMillionTokens?: { input: number; output: number };
    effectiveFrom?: string | null;
    effectiveUntil?: string | null;
  };
}

const evidence = JSON.parse(
  readFileSync('docs/telestar-ai-remediation/MODEL_VERIFICATION.json', 'utf8'),
) as {
  verifiedAt: string;
  contract: { productionModelCount: number };
  models: EvidenceModel[];
};

/** Both files describe the same thing in two shapes. Reduce each to `{from, until, in, out}`. */
function evidencePeriods(model: EvidenceModel) {
  if (model.pricing.periods) {
    return model.pricing.periods.map((p) => ({
      from: p.effectiveFrom ?? null,
      until: p.effectiveUntil ?? null,
      input: p.perMillionTokens.input,
      output: p.perMillionTokens.output,
    }));
  }
  const flat = model.pricing.perMillionTokens;
  return [
    {
      from: model.pricing.effectiveFrom ?? null,
      until: model.pricing.effectiveUntil ?? null,
      input: flat!.input,
      output: flat!.output,
    },
  ];
}

const production = Object.values(MODEL_REGISTRY).filter((m) => m.productionAllowed);

describe('model registry against its evidence file', () => {
  it('describes exactly the same models', () => {
    expect(evidence.models.map((m) => m.modelId).sort()).toEqual(
      production.map((m) => m.modelId).sort(),
    );
  });

  it('agrees with the contract on how many production models there are', () => {
    expect(evidence.contract.productionModelCount).toBe(production.length);
  });

  it('agrees on the provider behind each model', () => {
    for (const model of production) {
      const record = evidence.models.find((m) => m.modelId === model.modelId);
      expect(record?.provider, model.modelId).toBe(model.provider);
    }
  });

  it('agrees on every context and output limit', () => {
    // A wrong `maxOutputTokens` is what produced "the same inherited 8192 regardless of model".
    for (const model of production) {
      const record = evidence.models.find((m) => m.modelId === model.modelId)!;
      expect(record.contextLimit, `${model.modelId} contextLimit`).toBe(model.contextLimit);
      expect(record.maxOutputTokens, `${model.modelId} maxOutputTokens`).toBe(model.maxOutputTokens);
    }
  });

  it('agrees on every price, in every effective period', () => {
    // Effective-dated on both sides, because one provider has already published a future
    // change. A scalar comparison would pass today and stop meaning anything on the date the
    // introductory rate ends.
    for (const model of production) {
      const record = evidence.models.find((m) => m.modelId === model.modelId)!;
      const fromEvidence = evidencePeriods(record);
      const fromRegistry = model.pricing.periods.map((p) => ({
        from: p.effectiveFrom ?? null,
        until: p.effectiveUntil ?? null,
        input: p.inputPerMillionUsd,
        output: p.outputPerMillionUsd,
      }));
      expect(fromEvidence, `${model.modelId} pricing`).toEqual(fromRegistry);
    }
  });

  it('cites a source for every model', () => {
    // The point of the file is provenance. A number with no source is the same unverified
    // number the registry replaced, wearing a different file extension.
    for (const record of evidence.models) {
      expect(record.sources?.length ?? 0, `${record.modelId} has no source`).toBeGreaterThan(0);
    }
  });

  it('records when a human last verified it', () => {
    expect(Number.isNaN(Date.parse(evidence.verifiedAt))).toBe(false);
  });
});
