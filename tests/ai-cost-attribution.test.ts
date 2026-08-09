import { describe, it, expect, vi, beforeEach } from 'vitest';
import { estimateTokenCost, estimateCallCost, hasTokenRate } from '@/lib/ai/pricing';
import { MODEL_LABELS } from '@/lib/ai/provider';

/**
 * AI cost attribution (Revenue AI Phase 1).
 *
 * Outcome 1 of the phase: every AI/model/research operation is attributable to tenant,
 * user, work order, provider/model, tokens or search credits, latency and estimated cost.
 */

const mockAiCallCreate = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    aiCall: {
      create: (...args: unknown[]) => mockAiCallCreate(...args),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  canAccessLead: vi.fn().mockResolvedValue(true),
  canAccessUser: vi.fn().mockResolvedValue(true),
}));

const { recordAiCall, classifyFailure, withAiCallRecording } = await import('@/lib/ai/usage');

beforeEach(() => {
  mockAiCallCreate.mockReset();
  mockAiCallCreate.mockResolvedValue({});
});

describe('pricing', () => {
  it('every selectable model has a rate', () => {
    // A model the UI offers but pricing does not know produces a null cost on every call
    // it serves — a silent hole in exactly the number Phase 10 reports.
    for (const model of Object.keys(MODEL_LABELS)) {
      expect(hasTokenRate(model), `no rate for ${model}`).toBe(true);
    }
  });

  it('computes token cost from separate input and output rates', () => {
    // llama-3.3-70b: $0.59/M in, $0.79/M out.
    const cost = estimateTokenCost('llama-3.3-70b-versatile', 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(1.38, 6);
  });

  it('returns null for an unknown model rather than guessing', () => {
    // A fabricated number is worse than a visible gap: it looks like data.
    expect(estimateTokenCost('some-future-model', 1000, 1000)).toBeNull();
  });

  it('prices per-call providers by credits', () => {
    expect(estimateCallCost('tavily', 1)).toBeCloseTo(0.008, 6);
    expect(estimateCallCost('tavily', 3)).toBeCloseTo(0.024, 6);
    expect(estimateCallCost('unknown-provider')).toBeNull();
  });

  it('rounds to the six decimal places the column stores', () => {
    const cost = estimateTokenCost('llama-3.1-8b-instant', 1, 1);
    expect(cost).not.toBeNull();
    expect(String(cost).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(6);
  });
});

describe('recordAiCall', () => {
  const base = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    operation: 'chat',
    latencyMs: 120,
    status: 'ok' as const,
  };

  it('records every attribution field for an LLM call', async () => {
    await recordAiCall({
      ...base,
      leadId: 'lead-1',
      workOrderId: 'wo-1',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    });

    expect(mockAiCallCreate).toHaveBeenCalledTimes(1);
    const data = mockAiCallCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: 'tenant-1',
      userId: 'user-1',
      leadId: 'lead-1',
      workOrderId: 'wo-1',
      operation: 'chat',
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      latencyMs: 120,
      status: 'ok',
    });
    expect(data.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('records search credits instead of tokens for research providers', async () => {
    await recordAiCall({ ...base, provider: 'tavily', operation: 'research', searchCredits: 1 });

    const data = mockAiCallCreate.mock.calls[0][0].data;
    expect(data.searchCredits).toBe(1);
    expect(data.totalTokens).toBeNull();
    expect(data.model).toBeNull();
    expect(Number(data.estimatedCostUsd)).toBeCloseTo(0.008, 6);
  });

  it('records failures, because a failed call still cost latency', async () => {
    await recordAiCall({
      ...base,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      status: 'rate_limited',
      errorCode: '429',
    });

    const data = mockAiCallCreate.mock.calls[0][0].data;
    expect(data.status).toBe('rate_limited');
    expect(data.errorCode).toBe('429');
  });

  it('never throws when the write fails', async () => {
    mockAiCallCreate.mockRejectedValue(new Error('database unavailable'));

    // Accounting is not worth failing an SDR's question over. This runs inside the AI
    // request path, so a throw here would surface as a broken answer.
    await expect(
      recordAiCall({ ...base, provider: 'groq', model: 'llama-3.3-70b-versatile' })
    ).resolves.not.toThrow();
  });

  it('skips the write when there is no tenant rather than inventing one', async () => {
    // A row no tenant-scoped query can return is worse than a gap: it looks like data.
    const cost = await recordAiCall({
      ...base,
      tenantId: undefined,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      promptTokens: 100,
      completionTokens: 100,
    });

    expect(mockAiCallCreate).not.toHaveBeenCalled();
    expect(cost).toBeGreaterThan(0);
  });
});

describe('classifyFailure', () => {
  it('separates rate limiting from other errors — it is a budget signal, not a bug', () => {
    expect(classifyFailure({ status: 429 })).toBe('rate_limited');
    expect(classifyFailure(new Error('rate limit exceeded'))).toBe('rate_limited');
    expect(classifyFailure(new Error('tokens per day quota reached'))).toBe('rate_limited');
  });

  it('marks an unreachable or unconfigured provider as unavailable', () => {
    expect(classifyFailure(new Error('GROQ_API_KEY is not configured'))).toBe('unavailable');
    expect(classifyFailure(new Error('getaddrinfo ENOTFOUND api.groq.com'))).toBe('unavailable');
  });

  it('falls back to a plain error', () => {
    expect(classifyFailure(new Error('malformed response'))).toBe('error');
  });
});

describe('withAiCallRecording', () => {
  const base = {
    tenantId: 'tenant-1',
    userId: 'user-1',
    operation: 'briefing',
    provider: 'groq' as const,
    model: 'llama-3.3-70b-versatile',
  };

  it('records usage and latency on success', async () => {
    const result = await withAiCallRecording(
      base,
      async () => ({ usage: { prompt: 10, completion: 20 } }),
      (r) => ({ promptTokens: r.usage.prompt, completionTokens: r.usage.completion, totalTokens: 30 })
    );

    expect(result.usage.prompt).toBe(10);
    const data = mockAiCallCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'ok', promptTokens: 10, completionTokens: 20, totalTokens: 30 });
    expect(data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('records the failure and rethrows, so the caller still sees the error', async () => {
    await expect(
      withAiCallRecording(base, async () => { throw new Error('rate limit'); }, () => ({}))
    ).rejects.toThrow('rate limit');

    expect(mockAiCallCreate.mock.calls[0][0].data.status).toBe('rate_limited');
  });
});
