import { describe, it, expect, beforeEach } from 'vitest';
import { MODEL_REGISTRY, getModelMetadata } from '@/lib/ai/registry';
import { routeModel } from '@/lib/ai/router';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { generateToolIdempotencyKey } from '@/lib/ai/actions';
import { aiGateway } from '@/lib/ai/gateway';

describe('Phase 1: Central Model Registry & Smart Routing', () => {
  beforeEach(() => {
    circuitBreaker.reset();
  });

  it('resolves model metadata accurately from aliases and modelIds', () => {
    const terra = getModelMetadata('gpt-5.6-terra');
    expect(terra.provider).toBe('openai');
    expect(terra.supportsTools).toBe(true);
    expect(terra.qualityTier).toBe('advanced');

    const luna = getModelMetadata('gpt-5.6-luna');
    expect(luna.costTier).toBe('ultra_low');
    expect(luna.latencyTier).toBe('instant');

    const sol = getModelMetadata('gpt-5.6-sol');
    expect(sol.purpose).toBe('deep_analysis');
    expect(sol.qualityTier).toBe('deep_reasoning');
  });

  it('routes deep complexity and strategic tasks to Sol/reasoning tier', () => {
    const decision = routeModel({
      task: 'Analyze cross-campaign client churn and suggest multi-variable recovery',
      complexity: 'deep',
      businessImportance: 'critical',
    });

    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['gpt-5.6-sol'].modelId);
    expect(decision.fallbackModels.length).toBeGreaterThan(0);
    expect(decision.fallbackModels.some((m) => m.provider === 'google')).toBe(true);
  });

  it('routes low complexity extraction/classification to Luna/fast tier', () => {
    const decision = routeModel({
      task: 'Classify email sentiment',
      complexity: 'low',
      requiresTools: false,
    });

    expect(['gpt-4o-mini', 'llama-3.1-8b-instant', 'llama-3.3-70b-versatile']).toContain(
      decision.primaryModel.modelId
    );
  });

  it('routes interactive SDR/CRM tool execution to Terra/flagship tier', () => {
    const decision = routeModel({
      task: 'Prepare meeting briefing and execute lead status updates',
      requiresTools: true,
    });

    expect(decision.primaryModel.modelId).toBe(MODEL_REGISTRY['gpt-5.6-terra'].modelId);
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
    circuitBreaker.recordFailure('groq', 'llama-3.3-70b-versatile', true);
    expect(circuitBreaker.isAvailable('groq', 'llama-3.3-70b-versatile')).toBe(false);
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

describe('Phase 1: Durable Tool Idempotency Keys', () => {
  it('generates deterministic and unique idempotency keys per execution turn and tool', () => {
    const key1 = generateToolIdempotencyKey({
      tenantId: 'tenant-123',
      userId: 'user-456',
      executionId: 'exec-789',
      turnId: 'turn-1',
      toolOrdinal: 0,
      toolName: 'assign_leads',
    });

    const key2 = generateToolIdempotencyKey({
      tenantId: 'tenant-123',
      userId: 'user-456',
      executionId: 'exec-789',
      turnId: 'turn-1',
      toolOrdinal: 0,
      toolName: 'assign_leads',
    });

    const keyDifferentTool = generateToolIdempotencyKey({
      tenantId: 'tenant-123',
      userId: 'user-456',
      executionId: 'exec-789',
      turnId: 'turn-1',
      toolOrdinal: 1,
      toolName: 'log_activity',
    });

    expect(key1).toBe(key2);
    expect(key1).not.toBe(keyDifferentTool);
    expect(key1).toContain('tenant-123');
    expect(key1).toContain('assign_leads');
  });
});

describe('Phase 1: AI Gateway Health Reporting', () => {
  it('reports operational health status across providers and circuits', () => {
    const health = aiGateway.getHealth();
    expect(health).toHaveProperty('providers');
    expect(health).toHaveProperty('circuits');
  });
});
