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
 * Every AI mode — chat, structured background generation, the tool loop — routes through
 * `lib/ai/gateway.ts`. These tests stub the three SDK clients it constructs and assert the
 * *policy* through the real `generateStructured`, so a second router growing inside a caller
 * would fail here.
 *
 * Two behaviours changed deliberately when the second router was removed, and both are pinned
 * below:
 *
 *   - **The chain starts at OpenAI**, because the standard tier leads with GPT-5.6 Luna.
 *   - **Every failure kind fails over**, not only a rate limit. The three models sit behind
 *     three separate credentials and accept genuinely different parameters, so one model's 404
 *     or 400 says nothing about the next model's. The old rate-limit-only policy is exactly
 *     what turned a withdrawn Groq model into a total outage: the 404 was not a fallback
 *     condition, so nothing else was ever tried.
 */
const openaiCreate = vi.fn();
const groqCreate = vi.fn();
const geminiSendMessageStream = vi.fn();
let geminiModelOptions: Record<string, unknown> | null = null;

vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create: openaiCreate } };
  },
}));

vi.mock('groq-sdk', () => ({
  default: class {
    chat = { completions: { create: groqCreate } };
  },
}));

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: class {
    getGenerativeModel(options: Record<string, unknown>) {
      geminiModelOptions = options;
      return { startChat: () => ({ sendMessageStream: geminiSendMessageStream }) };
    }
  },
}));

import { prisma } from '@/lib/prisma';
import { createTestTenant } from './helpers/testTenant';
import { randomUUID } from 'crypto';
import { tenantStorage } from '@/lib/tenant-context';
import { generateStructured, isGenerationAvailable } from '@/lib/ai/generation';
import { circuitBreaker } from '@/lib/ai/circuitBreaker';
import { classifyGatewayFailure } from '@/lib/ai/gateway';

/** An OpenAI-compatible streamed completion carrying the whole payload in one delta. */
function openAiCompatibleStream(payload: unknown, usage: { prompt: number; completion: number }) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: JSON.stringify(payload) } }] };
      yield {
        choices: [{ delta: {} }],
        usage: {
          prompt_tokens: usage.prompt,
          completion_tokens: usage.completion,
          total_tokens: usage.prompt + usage.completion,
        },
      };
    },
  };
}

/** Groq reports usage under `x_groq` rather than a top-level `usage`. */
function groqStream(payload: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { choices: [{ delta: { content: JSON.stringify(payload) } }] };
      yield {
        choices: [{ delta: {} }],
        x_groq: { usage: { prompt_tokens: 60, completion_tokens: 10, total_tokens: 70 } },
      };
    },
  };
}

function geminiStream(payload: unknown) {
  return {
    stream: (async function* () {
      yield { text: () => JSON.stringify(payload) };
    })(),
    response: Promise.resolve({
      usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 10, totalTokenCount: 90 },
      functionCalls: () => undefined,
    }),
  };
}

function withStatus(message: string, status: number): Error {
  const err = new Error(message);
  (err as unknown as { status: number }).status = status;
  return err;
}

const rateLimited = () => withStatus('Rate limit reached for model', 429);
const modelNotFound = () =>
  withStatus('The model `some-withdrawn-model` does not exist or you do not have access to it.', 404);

describe('Phase 8a — provider routing and failover', () => {
  let tenantId: string;
  const originalOpenAi = process.env.OPENAI_API_KEY;
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
    openaiCreate.mockReset();
    groqCreate.mockReset();
    geminiSendMessageStream.mockReset();
    geminiModelOptions = null;
    circuitBreaker.reset();
    vi.spyOn(circuitBreaker, 'sync').mockResolvedValue(undefined);
    vi.spyOn(circuitBreaker, 'publish').mockResolvedValue(undefined);
    vi.spyOn(circuitBreaker, 'tryEnterHalfOpen').mockResolvedValue(true);
    vi.spyOn(circuitBreaker, 'exitHalfOpen').mockResolvedValue(undefined);
    process.env.OPENAI_API_KEY = 'openai-key';
    process.env.GROQ_API_KEY = 'groq-key';
    process.env.GEMINI_API_KEY = 'gemini-key';

    tenantId = `t8routing-${randomUUID()}`;
    await createTestTenant(tenantId, 'Routing');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [key, original] of [
      ['OPENAI_API_KEY', originalOpenAi],
      ['GROQ_API_KEY', originalGroq],
      ['GEMINI_API_KEY', originalGemini],
    ] as const) {
      if (original) process.env[key] = original;
      else delete process.env[key];
    }
  });

  it('leads with OpenAI when it is configured, and touches nothing else on success', async () => {
    openaiCreate.mockResolvedValue(openAiCompatibleStream({ ok: true }, { prompt: 100, completion: 20 }));

    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('openai');
    expect(outcome.model).toBe('gpt-5.6-luna');
    expect(openaiCreate).toHaveBeenCalledTimes(1);
    expect(geminiSendMessageStream).not.toHaveBeenCalled();
    expect(groqCreate).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('openai');
    expect(calls[0].status).toBe('ok');
    expect(calls[0].totalTokens).toBe(120);
    // The ledger names the model that answered, not an alias mapping to something else.
    expect(calls[0].model).toBe('gpt-5.6-luna');
  }, 60_000);

  it('sends the parameters each model actually accepts', async () => {
    // Not cosmetic. `max_tokens` is a 400 on Luna and correct on Groq; any temperature but the
    // default is a 400 on Luna. Getting this wrong looks, from the SDR's side, like an outage.
    openaiCreate.mockResolvedValue(openAiCompatibleStream({ ok: true }, { prompt: 10, completion: 5 }));
    await run();

    const openAiArgs = openaiCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(openAiArgs.model).toBe('gpt-5.6-luna');
    expect(openAiArgs.max_completion_tokens).toBe(1200);
    expect(openAiArgs.max_tokens).toBeUndefined();
    expect(openAiArgs.temperature).toBeUndefined();

    openaiCreate.mockRejectedValue(modelNotFound());
    geminiSendMessageStream.mockRejectedValue(new Error('gemini down'));
    groqCreate.mockResolvedValue(groqStream({ ok: true }));
    await run();

    const groqArgs = groqCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(groqArgs.model).toBe('openai/gpt-oss-20b');
    expect(groqArgs.max_tokens).toBe(1200);
    expect(groqArgs.temperature).toBe(0.4);
  }, 60_000);

  it('skips a provider with no configured credentials rather than burning a failover slot', async () => {
    delete process.env.OPENAI_API_KEY;
    geminiSendMessageStream.mockResolvedValue(geminiStream({ ok: true }));

    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('google');
    expect(openaiCreate).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].provider).toBe('google');
    expect(calls[0].totalTokens).toBe(90);
  }, 60_000);

  it('falls back on a rate limit, and records BOTH attempts', async () => {
    openaiCreate.mockRejectedValue(rateLimited());
    geminiSendMessageStream.mockResolvedValue(geminiStream({ ok: true }));

    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('google');

    // Two provider operations happened; two rows exist. The failed attempt is not hidden behind
    // the fallback's success.
    expect(outcome.attempts.map((a) => `${a.provider}:${a.status}`)).toEqual([
      'openai:rate_limited',
      'google:ok',
    ]);

    const calls = await callsFor();
    expect(calls).toHaveLength(2);
    expect(calls[0].status).toBe('rate_limited');
    expect(calls[1].status).toBe('ok');
  }, 60_000);

  it('falls back on a withdrawn model, which the old rate-limit-only policy would not', async () => {
    // The exact production defect, as a regression test: a 404 `model_not_found` from the
    // leading provider must reach the next one, not surface as a total failure.
    openaiCreate.mockRejectedValue(modelNotFound());
    geminiSendMessageStream.mockResolvedValue(geminiStream({ ok: true }));

    const outcome = await run();

    expect(outcome.available).toBe(true);
    expect(outcome.provider).toBe('google');
    expect(outcome.attempts.map((a) => a.provider)).toEqual(['openai', 'google']);
  }, 60_000);

  it('walks the whole chain before giving up, and degrades rather than throwing', async () => {
    openaiCreate.mockRejectedValue(modelNotFound());
    geminiSendMessageStream.mockRejectedValue(new Error('gemini unreachable'));
    groqCreate.mockRejectedValue(new Error('groq unreachable'));

    const outcome = await run();

    expect(outcome.available).toBe(false);
    expect(outcome.attempts.map((a) => a.provider)).toEqual(['openai', 'google', 'groq']);

    const calls = await callsFor();
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.status !== 'ok')).toBe(true);
  }, 60_000);

  it('reports unavailable with an attributable row when no provider is configured', async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;

    expect(isGenerationAvailable()).toBe(false);
    const outcome = await run();

    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain('no generation provider');
    expect(openaiCreate).not.toHaveBeenCalled();
    expect(groqCreate).not.toHaveBeenCalled();
    expect(geminiSendMessageStream).not.toHaveBeenCalled();

    const calls = await callsFor();
    expect(calls).toHaveLength(1);
    expect(calls[0].status).toBe('unavailable');
    expect(calls[0].errorCode).toBe('NO_API_KEY');
  }, 60_000);

  it('exposes no tools to a background generation, on any provider', async () => {
    openaiCreate.mockResolvedValue(openAiCompatibleStream({ ok: true }, { prompt: 10, completion: 5 }));
    await run();

    const openAiArgs = openaiCreate.mock.calls[0][0] as Record<string, unknown>;
    expect(openAiArgs.tools).toBeUndefined();
    expect(openAiArgs.tool_choice).toBeUndefined();
    expect(openAiArgs.response_format).toEqual({ type: 'json_object' });

    openaiCreate.mockRejectedValue(rateLimited());
    geminiSendMessageStream.mockResolvedValue(geminiStream({ ok: true }));
    await run();

    expect(geminiModelOptions).not.toBeNull();
    expect(geminiModelOptions?.tools).toBeUndefined();
  }, 60_000);

  it('classifies provider failures the same way for every caller', () => {
    expect(classifyGatewayFailure(rateLimited())).toBe('rate_limit');
    expect(classifyGatewayFailure(new Error('tokens per day exceeded'))).toBe('rate_limit');
    expect(classifyGatewayFailure(modelNotFound())).toBe('model_unavailable');
    expect(classifyGatewayFailure(new Error('has been decommissioned'))).toBe('model_unavailable');
    expect(classifyGatewayFailure(withStatus('invalid api key', 401))).toBe('authentication');
    expect(classifyGatewayFailure(withStatus("Unsupported parameter: 'max_tokens'", 400))).toBe('bad_request');
  });
});
