/**
 * Capability-constrained model routing (TEL-P2-017).
 *
 * `requiresTools`, `requiresVision` and `requiresStructuredOutput` were declared on the
 * routing criteria and then never consulted. Two consequences, both tested here:
 *
 *   1. A request needing a capability could be answered by a model without it — a `deep`
 *      vision request routed to a model whose `supportsVision` was false.
 *   2. Fallbacks were filtered on availability alone, so even a correct primary could fail
 *      over to a model that could not do the job.
 *
 * An unknown `preferredModel` also silently became the flagship. That is now either an
 * explicit error or an explicit, inspectable fallback notice.
 *
 * The model names here changed when the registry was cut to the three approved production
 * models; the properties did not. `openai/gpt-oss-20b` is the one model without vision, so it
 * plays the role the retired deep-reasoning model used to play in these cases.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { MODEL_REGISTRY, findModelMetadata, getModelMetadata } from '@/lib/ai/registry';
import {
  UnknownModelError,
  UnroutableRequestError,
  routeModel,
  type RoutingCriteria,
} from '@/lib/ai/router';

/** Opens the circuit for a model until it is no longer available to routing. */
function openCircuit(alias: string) {
  const model = MODEL_REGISTRY[alias];
  for (let attempt = 0; attempt < 20; attempt += 1) {
    circuitBreaker.recordFailure(model.provider, model.modelId, false);
  }
  return model;
}

function allModels() {
  return Object.values(MODEL_REGISTRY);
}

describe('capability filtering constrains the primary model', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('never selects a model without vision for a vision request', () => {
    const decision = routeModel({ task: 'read this screenshot', requiresVision: true });

    expect(decision.primaryModel.supportsVision).toBe(true);
  });

  it('routes a DEEP vision request away from the one model that has no vision', () => {
    // The exact regression: a deep/critical request took the top of the deep tier, and vision
    // was never checked on the way.
    const decision = routeModel({
      task: 'strategic analysis of this dashboard image',
      complexity: 'deep',
      businessImportance: 'critical',
      requiresVision: true,
    });

    expect(MODEL_REGISTRY['openai/gpt-oss-20b'].supportsVision).toBe(false);
    expect(decision.primaryModel.internalAlias).not.toBe('openai/gpt-oss-20b');
    expect(decision.primaryModel.supportsVision).toBe(true);
  });

  it('never selects a model without tool support for a tool request', () => {
    const decision = routeModel({ task: 'update the lead', requiresTools: true });

    expect(decision.primaryModel.supportsTools).toBe(true);
  });

  it('never selects a model without structured output for a structured request', () => {
    const decision = routeModel({ task: 'extract fields', requiresStructuredOutput: true });

    expect(decision.primaryModel.supportsStructuredOutput).toBe(true);
  });

  it('still honours the low-complexity fast tier when tools are not required', () => {
    const decision = routeModel({ task: 'classify sentiment', complexity: 'low', requiresTools: false });

    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['openai/gpt-oss-20b'].modelId);
    expect(decision.primaryModel.latencyTier).toBe('instant');
  });
});

describe('every fallback satisfies the same hard requirements as the primary', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  const cases: Array<[string, RoutingCriteria, (m: (typeof MODEL_REGISTRY)[string]) => boolean]> = [
    ['vision', { task: 'vision', requiresVision: true }, (m) => m.supportsVision],
    ['tools', { task: 'tools', requiresTools: true }, (m) => m.supportsTools],
    [
      'structured output',
      { task: 'structured', requiresStructuredOutput: true },
      (m) => m.supportsStructuredOutput,
    ],
  ];

  for (const [label, criteria, predicate] of cases) {
    it(`excludes models lacking ${label} from the fallback chain`, () => {
      const decision = routeModel(criteria);

      expect(decision.fallbackModels.length).toBeGreaterThan(0);
      for (const fallback of decision.fallbackModels) {
        expect(predicate(fallback)).toBe(true);
      }
    });
  }

  it('excludes a capability-incapable model that would otherwise be a valid fallback', () => {
    const withoutRequirement = routeModel({ task: 'anything' });
    const withRequirement = routeModel({ task: 'anything', requiresVision: true });

    const chainWithout = [withoutRequirement.primaryModel, ...withoutRequirement.fallbackModels];
    const chainWith = [withRequirement.primaryModel, ...withRequirement.fallbackModels];

    // Reachable without the requirement, unreachable with it. The pair is the assertion: one
    // half alone would pass against a router that simply never selects this model.
    expect(chainWithout.some((model) => model.internalAlias === 'openai/gpt-oss-20b')).toBe(true);
    expect(chainWith.some((model) => model.internalAlias === 'openai/gpt-oss-20b')).toBe(false);
  });

  it('offers a cross-provider fallback first so one provider outage is survivable', () => {
    const decision = routeModel({ task: 'interactive crm work' });

    expect(decision.fallbackModels[0].provider).not.toBe(decision.primaryModel.provider);
  });
});

describe('an unknown preferred model is never silently remapped', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('raises UnknownModelError in strict mode', () => {
    expect(() =>
      routeModel({ task: 'chat', preferredModel: 'gpt-9-does-not-exist' }, { strictPreferredModel: true }),
    ).toThrow(UnknownModelError);
  });

  it('returns an explicit fallback notice in non-strict mode', () => {
    const decision = routeModel({ task: 'chat', preferredModel: 'gpt-9-does-not-exist' });

    expect(decision.fallbackNotice).toBeDefined();
    expect(decision.fallbackNotice).toMatchObject({
      requestedModel: 'gpt-9-does-not-exist',
      fallbackModel: decision.primaryModel.internalAlias,
    });
    expect(decision.fallbackNotice?.fallbackReason).toContain('not present in the registry');
  });

  it('does not fabricate a notice when the preference is honoured', () => {
    // A non-default choice, so honouring it is visible: the router's own primary for this
    // criteria is gpt-5.6-luna.
    const decision = routeModel({ task: 'chat', preferredModel: 'gemini-3.6-flash' });

    expect(decision.primaryModel.internalAlias).toBe('gemini-3.6-flash');
    expect(decision.fallbackNotice).toBeUndefined();
  });

  it('explains why a real model was declined for a capability it lacks', () => {
    const decision = routeModel({
      task: 'look at this image',
      preferredModel: 'openai/gpt-oss-20b',
      requiresVision: true,
    });

    expect(decision.fallbackNotice?.requestedModel).toBe('openai/gpt-oss-20b');
    expect(decision.fallbackNotice?.fallbackReason).toContain('vision');
    expect(decision.primaryModel.supportsVision).toBe(true);
  });

  it('explains why a real model was declined for an open circuit', () => {
    openCircuit('gpt-5.6-luna');

    const decision = routeModel({ task: 'chat', preferredModel: 'gpt-5.6-luna' });

    expect(decision.fallbackNotice?.fallbackReason).toContain('circuit is open');
    expect(decision.primaryModel.internalAlias).not.toBe('gpt-5.6-luna');
  });

  it('registry lookup returns null rather than a substitute', () => {
    expect(findModelMetadata('gpt-9-does-not-exist')).toBeNull();
    // A retired id must be as unknown as one that never existed. This is the lookup the whole
    // outage went through: it used to answer with the flagship for any unrecognised string.
    expect(findModelMetadata('gpt-5.6-terra')).toBeNull();
    expect(findModelMetadata('llama-3.3-70b-versatile')).toBeNull();
    expect(findModelMetadata('gemini-3.6-flash')?.internalAlias).toBe('gemini-3.6-flash');
    expect(() => getModelMetadata('gpt-9-does-not-exist')).toThrow(/Unknown AI model/);
  });
});

describe('routing refuses rather than guessing when nothing qualifies', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('raises UnroutableRequestError when every circuit is open', () => {
    for (const model of allModels()) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        circuitBreaker.recordFailure(model.provider, model.modelId, false);
      }
    }

    expect(() => routeModel({ task: 'chat' })).toThrow(UnroutableRequestError);
  });

  it('names the unsatisfiable requirement in the error', () => {
    for (const model of allModels()) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        circuitBreaker.recordFailure(model.provider, model.modelId, false);
      }
    }

    try {
      routeModel({ task: 'chat', requiresVision: true });
      throw new Error('expected routing to refuse');
    } catch (error) {
      expect(error).toBeInstanceOf(UnroutableRequestError);
      expect((error as Error).message).toContain('vision');
    }
  });
});

describe('configured-provider filtering', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('is off by default so a CRM with no AI provider still routes', () => {
    const decision = routeModel({ task: 'chat' });

    expect(decision.primaryModel).toBeDefined();
  });

  it('restricts routing to providers holding credentials when required', () => {
    const decision = routeModel(
      { task: 'chat' },
      { requireConfiguredProvider: true, configuredProviders: new Set(['groq']) },
    );

    expect(decision.primaryModel.provider).toBe('groq');
    for (const fallback of decision.fallbackModels) {
      expect(fallback.provider).toBe('groq');
    }
  });

  it('refuses when no configured provider can satisfy the requirement', () => {
    // groq's only tool-capable models have no vision, so this is unsatisfiable.
    expect(() =>
      routeModel(
        { task: 'vision', requiresVision: true },
        { requireConfiguredProvider: true, configuredProviders: new Set(['groq']) },
      ),
    ).toThrow(UnroutableRequestError);
  });
});
