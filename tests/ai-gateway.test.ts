import { describe, it, expect, beforeEach } from 'vitest';
import { MODEL_REGISTRY, getModelMetadata } from '@/lib/ai/registry';
import { routeModel } from '@/lib/ai/router';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { aiGateway } from '@/lib/ai/gateway';

describe('Phase 1: Central Model Registry & Smart Routing', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('resolves model metadata for each approved production model', () => {
    const luna = getModelMetadata('gpt-5.6-luna');
    expect(luna.provider).toBe('openai');
    expect(luna.supportsTools).toBe(true);
    expect(luna.qualityTier).toBe('advanced');

    const gemini = getModelMetadata('gemini-3.6-flash');
    expect(gemini.provider).toBe('google');
    expect(gemini.contextLimit).toBeGreaterThanOrEqual(1_000_000);

    const groq = getModelMetadata('openai/gpt-oss-20b');
    expect(groq.provider).toBe('groq');
    expect(groq.latencyTier).toBe('instant');
  });

  it('routes deep, high-context work to the million-token model', () => {
    const decision = routeModel({
      task: 'Analyze cross-campaign client churn and suggest multi-variable recovery',
      complexity: 'deep',
      businessImportance: 'critical',
    });

    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['gemini-3.6-flash'].modelId);
    expect(decision.fallbackModels.length).toBeGreaterThan(0);
    expect(decision.fallbackModels.some((m) => m.provider === 'openai')).toBe(true);
  });

  it('routes latency-sensitive classification to the fast tier', () => {
    const decision = routeModel({
      task: 'Classify email sentiment',
      complexity: 'low',
      requiresTools: false,
    });

    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['openai/gpt-oss-20b'].modelId);
  });

  it('routes interactive SDR/CRM tool execution to the primary reasoning model', () => {
    const decision = routeModel({
      task: 'Prepare meeting briefing and execute lead status updates',
      requiresTools: true,
    });

    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['gpt-5.6-luna'].modelId);
  });

  it('every tier lists all three approved models, so one outage cannot empty a tier', () => {
    // Not decoration: a two-model tier plus one dead provider is a tier that can only fail,
    // which is what a chat path that could reach exactly one withdrawn model amounted to.
    for (const criteria of [
      { task: 'deep', complexity: 'deep' as const },
      { task: 'fast', complexity: 'low' as const },
      { task: 'standard' },
    ]) {
      const decision = routeModel(criteria);
      const chain = [decision.primaryModel, ...decision.fallbackModels];
      expect(chain).toHaveLength(Object.keys(MODEL_REGISTRY).length);
      expect(new Set(chain.map((m) => m.provider)).size).toBe(3);
    }
  });

  it("treats 'auto' as no preference rather than an unknown model", () => {
    // 'auto' is the product default every SDR sees. Reporting it as unroutable — or attaching
    // a `fallbackNotice` claiming a substitution happened — would be wrong on both counts.
    const decision = routeModel({ task: 'chat', preferredModel: 'auto' });
    expect(decision.fallbackNotice).toBeUndefined();
    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['gpt-5.6-luna'].modelId);
  });
});

describe('Phase 1: Circuit Breakers & Failover Isolation', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('transitions provider circuit state to OPEN after repeated failures', () => {
    expect(circuitBreaker.isAvailable('openai')).toBe(true);

    // Record consecutive failures
    circuitBreaker.recordFailure('openai');
    circuitBreaker.recordFailure('openai');
    expect(circuitBreaker.isAvailable('openai')).toBe(true);

    // 3rd failure opens circuit
    circuitBreaker.recordFailure('openai');
    expect(circuitBreaker.isAvailable('openai')).toBe(false);
  });

  it('immediately opens circuit on rate limit signal', () => {
    expect(circuitBreaker.isAvailable('groq')).toBe(true);
    circuitBreaker.recordFailure('groq', 'openai/gpt-oss-20b', true);
    expect(circuitBreaker.isAvailable('groq', 'openai/gpt-oss-20b')).toBe(false);
  });

  it('routes around broken providers automatically when circuit is OPEN', () => {
    // Break OpenAI circuit
    circuitBreaker.recordFailure('openai', undefined, true);

    const decision = routeModel({
      task: 'Standard SDR conversation',
    });

    // Should automatically pick healthy alternative (Gemini or Groq)
    expect(decision.primaryModel.provider).not.toBe('openai');
    expect(['google', 'groq']).toContain(decision.primaryModel.provider);
  });

  it('closes circuit upon successful probe', () => {
    circuitBreaker.recordFailure('openai', undefined, true);
    expect(circuitBreaker.isAvailable('openai')).toBe(false);

    circuitBreaker.recordSuccess('openai');
    expect(circuitBreaker.isAvailable('openai')).toBe(true);
  });
});

// The durable tool idempotency key is built in `lib/ai/chatRuntime.ts` from a per-turn
// ordinal, and is asserted against its real format in
// `tests/agent-runtime-integration.test.ts`. A second describe block here tested
// `lib/ai/actions.ts:generateToolIdempotencyKey`, a parallel implementation that no
// production path ever called — coverage of a function that could not affect a user.

describe('Phase 1: AI Gateway Health Reporting', () => {
  it('reports operational health status across providers and circuits', () => {
    const health = aiGateway.getHealth();
    expect(health).toHaveProperty('providers');
    expect(health).toHaveProperty('circuits');
  });
});
