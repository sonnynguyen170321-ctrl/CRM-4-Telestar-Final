/**
 * Provider SDK adapters.
 *
 * Three SDKs, one stream shape. Everything vendor-specific lives here so the gateway can be
 * read as governance — routing, circuit breaker, budget, attribution — without provider
 * trivia interleaved.
 *
 * ## The parameter differences are real, and they are per model
 *
 * These are not stylistic. Captured live against production credentials
 * (`scripts/ai-provider-smoke.ts`):
 *
 *   gpt-5.6-luna   `max_tokens` -> 400 "Use 'max_completion_tokens' instead"
 *                  `temperature: 0.7` -> 400 "Only the default (1) value is supported"
 *                  tools without `reasoning_effort: 'none'` -> 400 "Function tools with
 *                  reasoning_effort are not supported ... in /v1/chat/completions"
 *   gpt-oss-20b    classic `max_tokens` + `temperature`
 *   gemini         neither; the SDK takes a generationConfig
 *
 * Which is why the shape comes from `ModelMetadata.parameters` rather than a `switch` on
 * provider: the next model added to a provider need not match its siblings.
 */

import OpenAI from 'openai';
import Groq from 'groq-sdk';
import type { GoogleGenerativeAI, Content, FunctionDeclaration, Part } from '@google/generative-ai';
import type { ModelMetadata } from './registry';
import { resolveModelPrice } from './pricing';
import type { GatewayToolDefinition, LoopMessage, PendingToolCall } from './conversation';

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface StreamChunk {
  text: string;
  usage: StreamUsage | null;
  /** Set on the final chunk when the model asked for tools instead of answering. */
  toolCalls?: PendingToolCall[] | null;
}

/** Token counts as the OpenAI-compatible providers report them. */
export interface RawUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  /** Prompt tokens served from the provider's cache, where it breaks them out. */
  cached_prompt_tokens?: number | null;
}

/**
 * Cost comes from the price resolver, not from arithmetic repeated here.
 *
 * This function used to multiply out its own per-1k rates, which made it a third place that
 * knew what a model costs — and the only one of the three that knew nothing about effective
 * dates or OpenAI's long-context multiplier. A streamed turn was therefore priced differently
 * from the same turn reconciled through the ledger.
 */
export function toStreamUsage(
  raw: RawUsage,
  model: ModelMetadata,
  at: Date = new Date(),
): StreamUsage {
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: raw.total_tokens ?? promptTokens + completionTokens,
    estimatedCostUsd: resolveModelPrice(model.modelId, at, {
      promptTokens,
      completionTokens,
      cachedPromptTokens: raw.cached_prompt_tokens,
    }).costUsd,
  };
}

export interface AdapterOptions {
  temperature?: number;
  maxTokens?: number;
  responseFormatJson?: boolean;
  tools?: GatewayToolDefinition[];
}

// ── OpenAI-compatible request shaping (OpenAI + Groq) ────────────────────────

/**
 * The parameters this model actually accepts. Anything it rejects is omitted rather than sent
 * and apologised for — a 400 on a parameter is indistinguishable, from the SDR's side, from
 * the AI being down.
 */
function openAiCompatibleParams(
  model: ModelMetadata,
  opts: AdapterOptions,
): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const {
    maxTokensParam,
    defaultMaxOutputTokens,
    supportsTemperature,
    requiresReasoningEffortNoneForTools,
  } = model.parameters;

  // `defaultMaxOutputTokens`, not `maxOutputTokens`: the latter is the provider's hard
  // ceiling, and requesting it by default would push `prompt + max_tokens` past the context
  // window on any long conversation.
  if (maxTokensParam) {
    params[maxTokensParam] = opts.maxTokens ?? defaultMaxOutputTokens ?? model.maxOutputTokens;
  }
  if (supportsTemperature && opts.temperature !== undefined) params.temperature = opts.temperature;
  if (opts.responseFormatJson) params.response_format = { type: 'json_object' };

  if (opts.tools?.length) {
    params.tools = opts.tools;
    params.tool_choice = 'auto';
    // Not a tuning knob. Without it the model refuses function tools on this endpoint outright.
    if (requiresReasoningEffortNoneForTools) params.reasoning_effort = 'none';
  }

  return assertNoRejectedParameters(model, params);
}

/**
 * Last line of defence before a request leaves the process.
 *
 * The individual `if` guards above are the intent; this is the check that the intent held.
 * A parameter the provider has deprecated is not harmless because it is ignored today —
 * Google's migration note says the next model generation returns an error for the Gemini
 * sampling parameters, which would turn a silent no-op into an outage on a date nobody in
 * this codebase controls.
 */
export function assertNoRejectedParameters(
  model: ModelMetadata,
  params: Record<string, unknown>,
): Record<string, unknown> {
  for (const rejected of model.parameters.rejectedParameters) {
    if (rejected in params) {
      throw new Error(
        `Model ${model.modelId} does not accept "${rejected}" — it is listed in rejectedParameters.`,
      );
    }
  }
  return params;
}

function toOpenAiMessages(messages: LoopMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
    if (message.role === 'assistant' && message.toolCalls?.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    }
    return { role: message.role, content: message.content };
  }) as OpenAI.Chat.ChatCompletionMessageParam[];
}

/**
 * Accumulates streamed `delta.tool_calls` fragments.
 *
 * Both OpenAI-compatible providers split a tool call across chunks — the name arrives once,
 * the arguments arrive a few characters at a time, and the `index` is the only thing tying the
 * pieces together. Concatenating by array position instead would interleave two concurrent
 * calls into one malformed call.
 */
class ToolCallAccumulator {
  private byIndex = new Map<number, PendingToolCall>();

  add(deltas: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>) {
    for (const delta of deltas) {
      const existing = this.byIndex.get(delta.index) ?? { id: '', name: '', arguments: '' };
      this.byIndex.set(delta.index, {
        id: delta.id ?? existing.id,
        name: delta.function?.name ?? existing.name,
        arguments: existing.arguments + (delta.function?.arguments ?? ''),
      });
    }
  }

  drain(): PendingToolCall[] | null {
    if (this.byIndex.size === 0) return null;
    return [...this.byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => call);
  }
}

export async function* streamOpenAi(
  client: OpenAI,
  model: ModelMetadata,
  messages: LoopMessage[],
  opts: AdapterOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const stream = await client.chat.completions.create(
    {
      model: model.modelId,
      messages: toOpenAiMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...openAiCompatibleParams(model, opts),
    } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
    { signal },
  );

  const accumulator = new ToolCallAccumulator();
  let usage: StreamUsage | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    if (delta?.tool_calls?.length) accumulator.add(delta.tool_calls);
    if (chunk.usage) {
      // Cached prompt tokens bill at a tenth of the standard input rate on Luna, so the
      // breakout is worth carrying rather than pricing every prompt token as uncached.
      usage = toStreamUsage(
        {
          ...chunk.usage,
          cached_prompt_tokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? null,
        },
        model,
      );
    }
    if (delta?.content) yield { text: delta.content, usage: null };
  }

  yield { text: '', usage, toolCalls: accumulator.drain() };
}

export async function* streamGroq(
  client: Groq,
  model: ModelMetadata,
  messages: LoopMessage[],
  opts: AdapterOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  // Groq's SDK does not export a streaming-params type, and its `create` overload resolves to
  // the non-streaming return when the params are widened. The cast is on the call, not on the
  // data: the chunk shape below is checked normally.
  const stream = (await client.chat.completions.create({
    model: model.modelId,
    messages: toOpenAiMessages(messages) as unknown as Groq.Chat.ChatCompletionMessageParam[],
    stream: true,
    ...openAiCompatibleParams(model, opts),
  } as Parameters<typeof client.chat.completions.create>[0], { signal })) as unknown as AsyncIterable<Groq.Chat.ChatCompletionChunk>;

  const accumulator = new ToolCallAccumulator();
  let usage: StreamUsage | null = null;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    const toolDeltas = delta?.tool_calls as
      | Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
      | undefined;
    if (toolDeltas?.length) accumulator.add(toolDeltas);
    const raw = (chunk as { x_groq?: { usage?: RawUsage } }).x_groq?.usage;
    if (raw) usage = toStreamUsage(raw, model);
    if (delta?.content) yield { text: delta.content, usage: null };
  }

  yield { text: '', usage, toolCalls: accumulator.drain() };
}

// ── Gemini ───────────────────────────────────────────────────────────────────

/**
 * Gemini takes the system prompt on the model, not in the history, and requires the history to
 * open with a user turn. Passing a system instruction as a `Content` produces a 400, and a
 * leading model turn — a morning briefing, say — produces another.
 */
function toGeminiHistory(messages: LoopMessage[]): { history: Content[]; latest: Part[] } {
  const history: Content[] = [];

  for (const message of messages) {
    if (message.role === 'system') continue;

    if (message.role === 'tool') {
      // A tool result goes back as plain user text, not a `functionResponse` part.
      //
      // Both native forms are rejected by gemini-3.6-flash through this SDK, and the errors
      // are worth recording because the obvious fixes do not work:
      //
      //   role 'function'          -> 400 "Role 'function' is not supported. Please use a valid
      //                               role: SYSTEM, ... MODEL, USER." (the SDK hard-codes this
      //                               role for function responses, so `startChat` cannot be used
      //                               for a tool round trip at all)
      //   role 'user' + functionResponse
      //                            -> 400 "Function call is missing a thought_signature in
      //                               functionCall parts", a field this SDK neither surfaces
      //                               nor round-trips
      //
      // Text does work, and the model answers from it correctly. The `functionCall` part on the
      // model turn above is kept, so the model still sees that it asked for the tool.
      history.push({
        role: 'user',
        parts: [{ text: `Tool ${message.name} returned: ${message.content}` }],
      });
      continue;
    }

    if (message.role === 'assistant' && message.toolCalls?.length) {
      history.push({
        role: 'model',
        parts: message.toolCalls.map((call) => ({
          functionCall: { name: call.name, args: safeJson(call.arguments) },
        })),
      });
      continue;
    }

    history.push({ role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }] });
  }

  while (history.length > 0 && history[0].role === 'model') history.shift();

  const last = history.pop();
  return { history, latest: last?.parts ?? [{ text: '' }] };
}

function safeJson(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toGeminiTools(tools: GatewayToolDefinition[]): FunctionDeclaration[] {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters,
  })) as FunctionDeclaration[];
}

export async function* streamGemini(
  client: GoogleGenerativeAI,
  model: ModelMetadata,
  messages: LoopMessage[],
  opts: AdapterOptions,
  signal: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const systemPrompt = messages.find((m) => m.role === 'system')?.content;

  const generativeModel = client.getGenerativeModel({
    model: model.modelId,
    ...(systemPrompt ? { systemInstruction: systemPrompt } : {}),
    ...(opts.tools?.length ? { tools: [{ functionDeclarations: toGeminiTools(opts.tools) }] } : {}),
    generationConfig: {
      // `maxOutputTokens` is deliberately not forwarded — the registry declares this model's
      // `maxTokensParam` as null. Gemini 3.6 spends output budget on reasoning before it emits
      // a single visible character, so a caller's 64-token ceiling (a perfectly sane number for
      // the OpenAI-compatible providers) is consumed entirely by thinking and the reader gets
      // an empty response. Caps for this provider belong in the prompt, not the token budget.
      ...(opts.temperature !== undefined && model.parameters.supportsTemperature
        ? { temperature: opts.temperature }
        : {}),
      ...(opts.responseFormatJson ? { responseMimeType: 'application/json' } : {}),
    },
  });

  const { history, latest } = toGeminiHistory(messages);
  const chat = generativeModel.startChat({ history });
  const result = await chat.sendMessageStream(latest);

  for await (const chunk of result.stream) {
    // The Gemini SDK takes no AbortSignal, so the deadline is enforced between chunks.
    if (signal.aborted) throw new Error('AI provider google timed out');
    const text = chunk.text();
    if (text) yield { text, usage: null };
  }

  const aggregated = await result.response;
  const meta = aggregated.usageMetadata;
  const functionCalls = aggregated.functionCalls();

  yield {
    text: '',
    usage: meta
      ? toStreamUsage(
          {
            prompt_tokens: meta.promptTokenCount,
            completion_tokens: meta.candidatesTokenCount,
            total_tokens: meta.totalTokenCount,
          },
          model,
        )
      : null,
    toolCalls: functionCalls?.length
      ? functionCalls.map((call, index) => ({
          // Gemini issues no call id. The ordinal is what the loop keys on anyway, and a
          // synthetic id keeps the tool-result message addressable in the same shape.
          id: `gemini-${index}`,
          name: call.name,
          arguments: JSON.stringify(call.args ?? {}),
        }))
      : null,
  };
}
