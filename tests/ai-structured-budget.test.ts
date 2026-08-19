import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { AiGateway } from '@/lib/ai/gateway';
import {
  checkAndReserveAiBudget,
  AiBudgetExceededError,
  setTenantCurrentSpend,
  clearBudgetReservations,
} from '@/lib/ai/budget';

describe('TEL-P1-010: AI Structured Output Runtime Zod Schema Validation', () => {
  const gateway = new AiGateway();

  it('validates structured output against provided Zod schema successfully', async () => {
    const mockOutput = JSON.stringify({
      score: 85,
      summary: 'High fit prospect',
      tags: ['enterprise', 'fintech'],
    });

    vi.spyOn(gateway, 'generate').mockResolvedValueOnce({
      content: mockOutput,
      provider: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      durationMs: 120,
    });

    const schema = z.object({
      score: z.number().min(0).max(100),
      summary: z.string().min(1),
      tags: z.array(z.string()),
    });

    const result = await gateway.generateStructured({
      messages: [{ role: 'user', content: 'Score this lead' }],
      schemaDescription: 'Score, summary, and tags array',
      schema,
    });

    expect(result.score).toBe(85);
    expect(result.summary).toBe('High fit prospect');
    expect(result.tags).toEqual(['enterprise', 'fintech']);
  });

  it('rejects structured output when model returns missing required schema fields', async () => {
    const invalidOutput = JSON.stringify({
      score: 85,
      // summary is missing
    });

    vi.spyOn(gateway, 'generate').mockResolvedValueOnce({
      content: invalidOutput,
      provider: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      durationMs: 120,
    });

    const schema = z.object({
      score: z.number(),
      summary: z.string(),
    });

    await expect(
      gateway.generateStructured({
        messages: [{ role: 'user', content: 'Evaluate lead' }],
        schemaDescription: 'Score and summary required',
        schema,
      })
    ).rejects.toThrow(/AI structured output schema validation failed/);
  });

  it('rejects structured output when model returns invalid property types', async () => {
    const wrongTypeOutput = JSON.stringify({
      score: 'eighty-five', // should be number
      summary: 'High fit prospect',
    });

    vi.spyOn(gateway, 'generate').mockResolvedValueOnce({
      content: wrongTypeOutput,
      provider: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      durationMs: 120,
    });

    const schema = z.object({
      score: z.number(),
      summary: z.string(),
    });

    await expect(
      gateway.generateStructured({
        messages: [{ role: 'user', content: 'Evaluate lead' }],
        schemaDescription: 'Score must be a number',
        schema,
      })
    ).rejects.toThrow(/AI structured output schema validation failed/);
  });

  it('rejects non-JSON malformed output with clear error', async () => {
    vi.spyOn(gateway, 'generate').mockResolvedValueOnce({
      content: 'Here is your score: 85 and summary is great',
      provider: 'groq',
      modelId: 'llama-3.3-70b-versatile',
      durationMs: 120,
    });

    const schema = z.object({ score: z.number() });

    await expect(
      gateway.generateStructured({
        messages: [{ role: 'user', content: 'Score lead' }],
        schemaDescription: 'JSON object',
        schema,
      })
    ).rejects.toThrow(/AI generated invalid JSON/);
  });
});

describe('TEL-P1-011: Pre-Provider AI Budget Reservation & Concurrency Governance', () => {
  const TENANT = 'tenant-budget-test';

  beforeEach(() => {
    clearBudgetReservations();
  });

  it('allows reservation when tenant spend is under monthly limit', async () => {
    setTenantCurrentSpend(TENANT, 10.0); // limit is 50.0

    const res = await checkAndReserveAiBudget({
      tenantId: TENANT,
      estimatedCostUsd: 0.05,
      operation: 'chat',
    });

    expect(res).not.toBeNull();
    expect(res?.tenantId).toBe(TENANT);

    res?.reconcile(0.04);
  });

  it('throws AiBudgetExceededError before calling provider when spend exceeds limit', async () => {
    setTenantCurrentSpend(TENANT, 50.0); // limit is 50.0

    await expect(
      checkAndReserveAiBudget({
        tenantId: TENANT,
        estimatedCostUsd: 0.01,
        operation: 'optional_enrichment',
        isEssential: false,
      })
    ).rejects.toThrow(AiBudgetExceededError);
  });

  it('allows essential operations to proceed even at budget cap', async () => {
    setTenantCurrentSpend(TENANT, 50.0);

    const res = await checkAndReserveAiBudget({
      tenantId: TENANT,
      estimatedCostUsd: 0.01,
      operation: 'essential_security_check',
      isEssential: true,
    });

    expect(res).not.toBeNull();
    res?.release();
  });

  it('blocks concurrent burst from exceeding budget when total reservations surpass limit', async () => {
    setTenantCurrentSpend(TENANT, 49.90); // 10 cents left

    // Make 2 concurrent requests estimating 0.08 each
    const req1 = await checkAndReserveAiBudget({
      tenantId: TENANT,
      estimatedCostUsd: 0.08,
      operation: 'call_1',
    });
    expect(req1).not.toBeNull();

    // Second concurrent request must be rejected because spend (49.90) + req1 (0.08) + req2 (0.08) = 50.06 > 50.00
    await expect(
      checkAndReserveAiBudget({
        tenantId: TENANT,
        estimatedCostUsd: 0.08,
        operation: 'call_2',
      })
    ).rejects.toThrow(AiBudgetExceededError);

    req1?.release();
  });
});
