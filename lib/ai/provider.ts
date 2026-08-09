import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { AI_TOOLS, executeTool } from './tools';
import { recordAiCall, classifyFailure } from './usage';

// Re-exported so existing server-side imports of '@/lib/ai/provider' keep working. The
// definitions live in the import-free leaf module because this file reaches the database
// via usage.ts, and a Client Component that imported these from here would drag
// async_hooks/dns/net into the browser bundle.
export { MODEL_LABELS, MODEL_DESCRIPTIONS, DEFAULT_MODEL } from './models';
export type { ModelId } from './models';

import type { ModelId } from './models';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface StreamOptions {
  messages: ChatMessage[];
  systemPrompt: string;
  modelId: ModelId;
  userId: string;
  leadId?: string;
  today: string;
  /**
   * Attribution context (Revenue AI Phase 1). Optional so a caller that has not been
   * updated still works — an unattributed call is a reporting gap, not a broken feature.
   * `recordAiCall` skips the write when there is no tenant, since a row that cannot be
   * scoped to a tenant is one no tenant-scoped query would ever return.
   */
  tenantId?: string;
  /** What this call is for: 'chat', 'briefing', 'research', … Defaults to 'chat'. */
  operation?: string;
  /** Set once typed work orders exist (Phase 6). */
  workOrderId?: string;
}

/** Attribution fields pulled off StreamOptions for the usage recorder. */
function attributionOf(opts: StreamOptions) {
  return {
    tenantId: opts.tenantId,
    userId: opts.userId,
    leadId: opts.leadId ?? null,
    workOrderId: opts.workOrderId ?? null,
    operation: opts.operation ?? 'chat',
  };
}

// Unified streaming interface — returns an async generator of text chunks
export async function* streamChat(opts: StreamOptions): AsyncGenerator<string> {
  const { modelId } = opts;

  if (modelId === 'gemini-2.0-flash') {
    yield* streamGemini(opts);
    return;
  }

  // All Groq models share one daily token quota. If it's exhausted (or any other
  // rate limit hits), transparently fall back to Gemini, which has its own quota.
  // streamGroq only yields text after the upstream call resolves, so a thrown
  // rate-limit error happens before any chunk is emitted — no duplicated output.
  try {
    yield* streamGroq(opts);
  } catch (err) {
    if (isRateLimitError(err) && process.env.GEMINI_API_KEY) {
      yield* streamGemini({ ...opts, modelId: 'gemini-2.0-flash' });
      return;
    }
    throw err;
  }
}

function isRateLimitError(err: unknown): boolean {
  if ((err as { status?: number })?.status === 429) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /rate.?limit|\b429\b|tokens per day|\bTPD\b|quota/i.test(msg);
}

async function* streamGroq(opts: StreamOptions): AsyncGenerator<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    yield 'GROQ_API_KEY is not configured. Please add it to your .env.local file.';
    return;
  }

  const groq = new Groq({ apiKey });

  // Use Groq's own message param type so tool/assistant messages are accepted
  type GMsg = Parameters<typeof groq.chat.completions.create>[0]['messages'][number];
  const loopMessages: GMsg[] = [
    { role: 'system' as const, content: opts.systemPrompt } as GMsg,
    ...opts.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content } as GMsg)),
  ];

  // Tool calling loop — Groq may call a tool before giving the final answer
  let iterations = 0;
  const MAX_TOOL_ITERATIONS = 3;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations++;

    let response: Awaited<ReturnType<typeof groq.chat.completions.create>>;
    const startedAt = Date.now();
    try {
      response = await groq.chat.completions.create({
        model: opts.modelId,
        messages: loopMessages,
        tools: AI_TOOLS as Parameters<typeof groq.chat.completions.create>[0]['tools'],
        tool_choice: 'auto',
        max_tokens: 800,
        stream: false,
      });
      // One row per round trip, not one per exchange: a tool-calling conversation spends
      // its tokens across several calls and cost review needs to see which.
      await recordAiCall({
        ...attributionOf(opts),
        provider: 'groq',
        model: opts.modelId,
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
        latencyMs: Date.now() - startedAt,
        status: 'ok',
      });
    } catch (err: unknown) {
      await recordAiCall({
        ...attributionOf(opts),
        provider: 'groq',
        model: opts.modelId,
        latencyMs: Date.now() - startedAt,
        status: classifyFailure(err),
        errorCode: (err as { status?: number })?.status?.toString() ?? null,
      });
      // Groq rejects malformed tool calls (old XML format from some model versions).
      // Retry once without tools to get a plain-text response.
      const isToolError =
        err instanceof Error &&
        (err.message.includes('tool_use_failed') || err.message.includes('tool call validation'));
      if (isToolError) {
        const retryStartedAt = Date.now();
        const fallback = await groq.chat.completions.create({
          model: opts.modelId,
          messages: loopMessages,
          max_tokens: 800,
          stream: false,
        });
        // The tool-less retry is a second billable call. Recording it under the same
        // operation is what makes "why did this answer cost double" answerable.
        await recordAiCall({
          ...attributionOf(opts),
          provider: 'groq',
          model: opts.modelId,
          promptTokens: fallback.usage?.prompt_tokens ?? null,
          completionTokens: fallback.usage?.completion_tokens ?? null,
          totalTokens: fallback.usage?.total_tokens ?? null,
          latencyMs: Date.now() - retryStartedAt,
          status: 'ok',
        });
        const content = fallback.choices[0]?.message?.content || '';
        const words = content.split(' ');
        for (let i = 0; i < words.length; i += 3) {
          yield words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
        }
        return;
      }
      throw err;
    }

    const choice = response.choices[0];

    if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
      // Execute tool calls
      loopMessages.push({
        role: 'assistant',
        content: choice.message.content || '',
        tool_calls: choice.message.tool_calls,
      } as Parameters<typeof groq.chat.completions.create>[0]['messages'][number]);

      for (const toolCall of choice.message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        const result = await executeTool(toolCall.function.name, args, {
          userId: opts.userId,
          leadId: opts.leadId,
          today: opts.today,
          tenantId: opts.tenantId,
          operation: opts.operation ?? 'chat',
          workOrderId: opts.workOrderId,
        });

        loopMessages.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: result,
        } as Parameters<typeof groq.chat.completions.create>[0]['messages'][number]);
      }
      // Continue the loop to get the final response
      continue;
    }

    // Final answer — stream it
    const finalContent = choice.message.content || '';
    // Simulate streaming by yielding in chunks
    const words = finalContent.split(' ');
    for (let i = 0; i < words.length; i += 3) {
      yield words.slice(i, i + 3).join(' ') + (i + 3 < words.length ? ' ' : '');
    }
    return;
  }
}

async function* streamGemini(opts: StreamOptions): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    yield 'GEMINI_API_KEY is not configured. Please add it to your .env.local file.';
    return;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // systemInstruction belongs on the model, not on startChat(). Passing it to
  // startChat() sends an invalid Content and Gemini rejects it with a 400.
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: opts.systemPrompt,
  });

  // Build Gemini chat history (excluding the last user message). Gemini requires
  // history to begin with a user turn, so drop any leading assistant messages
  // (e.g. a morning briefing) that would otherwise trigger a 400.
  const history = opts.messages.slice(0, -1).map((m) => ({
    role: (m.role === 'assistant' ? 'model' : 'user') as 'model' | 'user',
    parts: [{ text: m.content }],
  }));
  while (history.length > 0 && history[0].role === 'model') history.shift();

  const lastMessage = opts.messages[opts.messages.length - 1];
  const chat = model.startChat({ history });

  const startedAt = Date.now();
  let result: Awaited<ReturnType<typeof chat.sendMessageStream>>;
  try {
    result = await chat.sendMessageStream(lastMessage.content);
  } catch (err) {
    await recordAiCall({
      ...attributionOf(opts),
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      latencyMs: Date.now() - startedAt,
      status: classifyFailure(err),
      errorCode: (err as { status?: number })?.status?.toString() ?? null,
    });
    throw err;
  }

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }

  // Gemini reports usage only once the stream is drained, so the row is written here
  // rather than at call time. Recording must not break a response that already streamed
  // successfully — the reader has the answer regardless of whether accounting lands.
  try {
    const aggregated = await result.response;
    const usage = aggregated.usageMetadata;
    await recordAiCall({
      ...attributionOf(opts),
      provider: 'gemini',
      model: 'gemini-2.0-flash',
      promptTokens: usage?.promptTokenCount ?? null,
      completionTokens: usage?.candidatesTokenCount ?? null,
      totalTokens: usage?.totalTokenCount ?? null,
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });
  } catch (err) {
    console.error('[ai/provider] gemini usage capture failed:', err);
  }
}
