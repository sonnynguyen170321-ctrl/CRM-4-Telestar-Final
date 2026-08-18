import { shouldFallbackToGemini, createGroqClient, createGeminiClient, GEMINI_FALLBACK_MODEL } from './providerRouting';
import { AI_TOOLS } from './tools';
import { recordAiCall, classifyFailure } from './usage';
import type { SessionUser } from '@/lib/auth';
import { executeAgentAction } from '@/lib/agent/runtime';
import { capabilityForTool } from '@/lib/agent/toolCapabilities';
import { WRITE_CAPABILITIES } from '@/lib/agent/capabilities';
import { newExecutionId } from './executionId';

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
  leadId?: string;
  today: string;
  operation?: string;
  workOrderId?: string;
  sessionUser: SessionUser;
  /**
   * The caller's logical turn. Absent when the client sent nothing valid — the turn then
   * has no durable idempotency namespace, so no write-capable tool may run under it.
   */
  executionId?: string;
  playbookVersionId?: string;
}

/**
 * A tool call is refused outright when the turn has no durable execution id and the tool
 * writes. Read-only research still runs, under a namespace marked as what it is: valid for
 * this process only, never a claim that a retry would be recognised.
 */
function requiresDurableExecution(toolName: string): boolean {
  const capability = capabilityForTool(toolName);
  // An unregistered tool is refused by the runtime anyway; treating it as write-capable
  // here keeps the stricter answer in both places.
  return !capability || WRITE_CAPABILITIES.has(capability);
}

const NO_EXECUTION_ID_REFUSAL =
  'That action needs a durable execution id and this conversation turn has none, so nothing was written. ' +
  'Ask the SDR to send the message again — do not describe the action as done.';

/** Attribution fields pulled off StreamOptions for the usage recorder. */
function attributionOf(opts: StreamOptions) {
  return {
    tenantId: opts.sessionUser.tenantId,
    userId: opts.sessionUser.id,
    leadId: opts.leadId ?? null,
    workOrderId: opts.workOrderId ?? null,
    operation: opts.operation ?? 'chat',
  };
}

// Unified streaming interface — returns an async generator of text chunks
export async function* streamChat(opts: StreamOptions): AsyncGenerator<string> {
  const { modelId } = opts;

  if (modelId === 'gemini-flash-latest') {
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
    // One place decides failover, shared with `generateStructured`. A second expression of the
    // policy here is how the two modes drifted apart the first time.
    if (shouldFallbackToGemini('groq', err)) {
      yield* streamGemini({ ...opts, modelId: GEMINI_FALLBACK_MODEL });
      return;
    }
    throw err;
  }
}

async function* streamGroq(opts: StreamOptions): AsyncGenerator<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    yield 'GROQ_API_KEY is not configured. Please add it to your .env.local file.';
    return;
  }

  const groq = createGroqClient();

  // Use Groq's own message param type so tool/assistant messages are accepted
  type GMsg = Parameters<typeof groq.chat.completions.create>[0]['messages'][number];
  const loopMessages: GMsg[] = [
    { role: 'system' as const, content: opts.systemPrompt } as GMsg,
    ...opts.messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content } as GMsg)),
  ];

  // Tool calling loop — Groq may call a tool before giving the final answer.
  // `toolOrdinal` is declared here, outside the loop, so it counts every tool call in the
  // whole execution rather than restarting per iteration: two iterations each calling
  // `create_task` must produce two distinct action keys, not the same one twice.
  let iterations = 0;
  let toolOrdinal = 0;
  const MAX_TOOL_ITERATIONS = 3;

  // Only used when the turn has no durable execution id, and only for read-only tools.
  // Named so a row written under it can never be mistaken for a retry-safe one.
  const executionNamespace = opts.executionId ?? `ephemeral-${newExecutionId()}`;

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
      // Groq rejects malformed tool calls (old XML format from some model versions or prompt edge cases).
      // Retry once without tools to get a plain-text response.
      const isToolError =
        err instanceof Error &&
        (err.message.includes('tool_use_failed') ||
         err.message.includes('tool call validation') ||
         err.message.includes('Failed to call a function') ||
         err.message.includes('failed_generation') ||
         (err as { status?: number })?.status === 400);
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

      for (let i = 0; i < choice.message.tool_calls.length; i++) {
        const toolCall = choice.message.tool_calls[i];
        const args = JSON.parse(toolCall.function.arguments || '{}');
        // The provider's `toolCall.id` is correlation only — it changes on every retry, so
        // it cannot be the idempotency authority. The ordinal is.
        const actionKey = `agent:${executionNamespace}:tool:${toolOrdinal}:${toolCall.function.name}`;
        toolOrdinal++;

        const blockedForMissingExecutionId =
          !opts.executionId && requiresDurableExecution(toolCall.function.name);

        const result = blockedForMissingExecutionId
          ? { status: 'refused' as const, error: NO_EXECUTION_ID_REFUSAL }
          : await executeAgentAction({
              actionKey,
              toolName: toolCall.function.name,
              args,
              sessionUser: opts.sessionUser,
              leadId: opts.leadId,
              playbookVersionId: opts.playbookVersionId,
              workOrderId: opts.workOrderId,
            });

        loopMessages.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: result.status === 'completed' ? (result.result || 'Done') : (result.error || 'Failed'),
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

  const genAI = createGeminiClient();
  // systemInstruction belongs on the model, not on startChat(). Passing it to
  // startChat() sends an invalid Content and Gemini rejects it with a 400.
  const model = genAI.getGenerativeModel({
    model: 'gemini-1.5-flash',
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
      model: 'gemini-flash-latest',
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
      model: 'gemini-flash-latest',
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
