import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

/**
 * Provider selection and failover, at the client boundary.
 *
 * Both AI modes route through `lib/ai/providerRouting`. These tests stub the two SDK clients it
 * constructs and assert the *policy* — which provider runs, when a failure falls back, and that
 * both attempts are recorded — through the real `generateStructured`, so a second router growing
 * inside a caller would fail here.
 */
const groqCreate = vi.fn();
const geminiGenerate = vi.fn();
let geminiModelOptions: Record<string, unknown> | null = null;

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: groqCreate } };
  },
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(options: Record<string, unknown>) {
      geminiModelOptions = options;
      return { generateContent: geminiGenerate };
    }
  },
}));

import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured, isGenerationAvailable } from '@/lib/ai/generation';
import { isRateLimitError, shouldFallbackToGemini, primaryProvider } from '@/lib/ai/providerRouting';

const groqOk = (payload: unknown) => ({
  choices: [{ message: { content: JSON.stringify(payload) } }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
});

const geminiOk = (payload: unknown) => ({
  response: {
    text: () => JSON.stringify(payload),
    usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 10, totalTokenCount: 90 },
  },
});

function rateLimited(): Error {
  const err = new Error('Rate limit reached for model');
  (err as unknown as { status: number }).status = 429;
  return err;
}

describe('Phase 8a — provider routing and failover', () => {
  let tenantId: string;
  const originalGroq = process.env.GROQ_API_KEY;
  const originalGemini = process.env.GEMINI_API_KEY;

  const run = () =>
    tenantStorage.run({ tenantId, bypassRls: true }, () =>
      generateStructured<{ ok: boolean }>(
        {
          tenantId,
          userId: null,
          operation: 'prioritization',
          systemPrompt: 'system',
          userPrompt: 'user',
        },
        (raw) => JSON.parse(raw) as { ok: boolean }
      )
    );

  const callsFor = () =>
    prisma.aiCall.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } });

  beforeEach(async () => {
    groqCreate.mockReset();
    geminiGenerate.mockReset();
    geminiModelOptions = null;
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    tenantId = `t8routing-${randomUUID()}`;
    await prisma.tenant.create({ data: { id: tenantId, name: 'Routing' } });
  });

  afterEach(() => {
    if (originalGroq) process.env.GROQ_API_KEY = originalGroq;
    else delete process.env.GROQ_API_KEY;
    if (originalGemini) process.env.GEMINI_API_KEY = originalGemini;
    else delete process.env.GEMINI_API_KEY;
  });

  it('uses Groq when it is configured, and does not touch Gemini on success', async () => {
    groqCreate.mockResolvedValue(groqOk({ ok: true }));

    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('groq');
    expect(groqCreate).toHaveBeenCalledTimes(1);
    expect(geminiGenerate).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('groq');
    expect(calls[0].status).toBe('ok');
    expect(calls[0].totalTokens).toBe(120);
  }, 60_000);

  it('uses Gemini when Groq is not configured', async () => {
    delete process.env.GROQ_API_KEY;
    geminiGenerate.mockResolvedValue(geminiOk({ ok: true }));

    expect(primaryProvider()).toBe('gemini');
    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('gemini');
    expect(groqCreate).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('gemini');
    expect(calls[0].totalTokens).toBe(90);
  }, 60_000);

  it('falls back to Gemini on a Groq rate limit, and records BOTH attempts', async () => {
    groqCreate.mockRejectedValue(rateLimited());
    geminiGenerate.mockResolvedValue(geminiOk({ ok: true }));

    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('gemini');
    expect(groqCreate).toHaveBeenCalledTimes(1);
    expect(geminiGenerate).toHaveBeenCalledTimes(1);

    // Two provider operations happened; two rows exist. The failed attempt is not hidden behind
    // the fallback's success.
    expect(outcome.attempts.map((a) => `${a.provider}:${a.status}`)).toEqual([
      'groq:rate_limited',
      'gemini:ok',
    ]);

    const calls = await callsFor();
    expect(calls).toHaveLength(2);
    expect(calls[0].provider).toBe('groq');
    expect(calls[0].status).toBe('rate_limited');
    expect(calls[1].provider).toBe('gemini');
    expect(calls[1].status).toBe('ok');
    expect(calls[1].totalTokens).toBe(90);
  }, 60_000);

  it('does not fall back on a non-rate-limit failure — the established policy', async () => {
    groqCreate.mockRejectedValue(new Error('400 invalid request'));

    const outcome = await run();

    expect(outcome.available).toBe(false);
    expect(geminiGenerate).not.toHaveBeenCalled();
    expect(shouldFallbackToGemini('groq', new Error('400 invalid request'))).toBe(false);

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('groq');
    expect(calls[0].status).toBe('error');
  }, 60_000);

  it('degrades when Groq is rate limited and Gemini is not configured', async () => {
    delete process.env.GEMINI_API_KEY;
    groqCreate.mockRejectedValue(rateLimited());

    const outcome = await run();

    expect(outcome.available).toBe(false);
    expect(geminiGenerate).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('rate_limited');
  }, 60_000);

  it('reports unavailable with an attributable row when neither provider is configured', async () => {
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;

    expect(isGenerationAvailable()).toBe(false);
    const outcome = await run();

    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain('no generation provider');
    expect(groqCreate).not.toHaveBeenCalled();
    expect(geminiGenerate).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('unavailable');
    expect(calls[0].errorCode).toBe('NO_API_KEY');
  }, 60_000);

  it('exposes no tools to a background generation, on either provider', async () => {
    groqCreate.mockResolvedValue(groqOk({ ok: true }));
    await run();

    const groqArgs = groqCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(groqArgs.tools).toBeUndefined();
    expect(groqArgs.tool_choice).toBeUndefined();
    expect(groqArgs.response_format).toEqual({ type: 'json_object' });

    groqCreate.mockRejectedValue(rateLimited());
    geminiGenerate.mockResolvedValue(geminiOk({ ok: true }));
    await run();

    expect(geminiModelOptions).not.toBeNull();
    expect(geminiModelOptions?.tools).toBeUndefined();
  }, 60_000);

  it('classifies rate limits the same way for every caller', () => {
    expect(isRateLimitError(rateLimited())).toBe(true);
    expect(isRateLimitError(new Error('tokens per day exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('invalid api key'))).toBe(false);
  });
});
