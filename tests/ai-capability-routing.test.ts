/**
 * Capability-constrained model routing (TEL-P2-017).
 *
 * `requiresTools`, `requiresVision` and `requiresStructuredOutput` were declared on the
 * routing criteria and then never consulted. Two consequences, both tested here:
 *
 *   1. A request needing a capability could be answered by a model without it. A `deep`
 *      vision request routed to `gpt-5.6-sol`, whose `supportsVision` is false.
 *   2. Fallbacks were filtered on availability alone, so even a correct primary could fail
 *      over to a model that could not do the job.
 *
 * An unknown `preferredModel` also silently became Terra. That is now either an explicit
 * error or an explicit, inspectable fallback notice.
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

  it('routes a DEEP vision request away from gpt-5.6-sol, which has no vision', () => {
    // The exact regression: deep/critical preferred Sol, and vision was never checked.
    const decision = routeModel({
      task: 'strategic analysis of this dashboard image',
      complexity: 'deep',
      businessImportance: 'critical',
      requiresVision: true,
    });

    expect(MODEL_REGISTRY['gpt-5.6-sol'].supportsVision).toBe(false);
    expect(decision.primaryModel.internalAlias).not.toBe('gpt-5.6-sol');
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

    expect(['gpt-4o-mini', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile']).toContain(
      decision.primaryModel.modelId,
    );
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

    // Sol is reachable without the requirement and unreachable with it.
    expect(chainWithout.some((model) => model.internalAlias === 'gpt-5.6-sol')).toBe(true);
    expect(chainWith.some((model) => model.internalAlias === 'gpt-5.6-sol')).toBe(false);
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
    const decision = routeModel({ task: 'chat', preferredModel: 'gpt-5.6-terra' });

    expect(decision.primaryModel.internalAlias).toBe('gpt-5.6-terra');
    expect(decision.fallbackNotice).toBeUndefined();
  });

  it('explains why a real model was declined for a capability it lacks', () => {
    const decision = routeModel({
      task: 'look at this image',
      preferredModel: 'gpt-5.6-sol',
      requiresVision: true,
    });

    expect(decision.fallbackNotice?.requestedModel).toBe('gpt-5.6-sol');
    expect(decision.fallbackNotice?.fallbackReason).toContain('vision');
    expect(decision.primaryModel.supportsVision).toBe(true);
  });

  it('explains why a real model was declined for an open circuit', () => {
    openCircuit('gpt-5.6-terra');

    const decision = routeModel({ task: 'chat', preferredModel: 'gpt-5.6-terra' });

    expect(decision.fallbackNotice?.fallbackReason).toContain('circuit is open');
    expect(decision.primaryModel.internalAlias).not.toBe('gpt-5.6-terra');
  });

  it('registry lookup returns null rather than a substitute', () => {
    expect(findModelMetadata('gpt-9-does-not-exist')).toBeNull();
    expect(findModelMetadata('gpt-5.6-terra')?.internalAlias).toBe('gpt-5.6-terra');
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
