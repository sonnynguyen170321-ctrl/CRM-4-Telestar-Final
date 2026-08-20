/**
 * Telestar Provider-Neutral AI Gateway.
 *
 * The single entrypoint for every AI generation, stream, structured output and tool loop in
 * the product. Nothing else in the codebase constructs a provider client.
 *
 * There used to be three ways to reach a model — this gateway, `lib/ai/provider.ts` for chat,
 * and `lib/ai/providerRouting.ts` for background generation — each with its own idea of which
 * provider to try and when a failure was a fallback. They disagreed, and the disagreement is
 * what shipped: chat hard-coded a Groq model that had been withdrawn, returned a 404, and
 * because the legacy router only failed over on a rate limit the SDR saw
 * "Sorry, I ran into a problem generating that." for every message. One router now.
 *
 * What this module owns: model routing, circuit breaking, timeouts, budget reservation and
 * settlement, usage attribution, and the provider-neutral tool loop.
 *
 * What it deliberately does not own: **tool authorization**. `runToolLoop` executes tools
 * through a caller-supplied `GatewayToolExecutor`, so no Prisma client and no agent-runtime
 * import enters this file. Capability and object authorization stay in the CRM domain
 * services where `tests/agent-object-authorization.test.ts` can hold them.
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { z } from 'zod';
import { circuitBreaker } from './circuitBreaker';
import { routeModel, UnroutableRequestError, type RoutingCriteria } from './router';
import type { ModelMetadata, ModelProvider } from './registry';
import { recordAiCall, classifyFailure, type AiCallStatus } from './usage';
import { checkAndReserveAiBudget, type BudgetReservation } from './budget';
import {
  streamGemini,
  streamGroq,
  streamOpenAi,
  type AdapterOptions,
  type StreamChunk,
  type StreamUsage,
} from './providerAdapters';
import {
  toLoopMessages,
  type ChatMessage,
  type GatewayToolDefinition,
  type GatewayToolExecutor,
  type LoopMessage,
  type PendingToolCall,
} from './conversation';

export type { ChatMessage, GatewayToolDefinition, GatewayToolExecutor } from './conversation';
export type { StreamUsage } from './providerAdapters';

/** What the CRM says when no provider can serve a streamed request. */
export const STREAM_UNAVAILABLE_MESSAGE =
  'Telestar AI is temporarily unavailable. Core CRM operations remain operational.';

/** How many times one turn may go around the tool loop before it must answer. */
const MAX_TOOL_ITERATIONS = 3;

/**
 * Who a call is billed and attributed to.
 *
 * `sessionUser` covers every request made on behalf of a signed-in person. Background
 * generation has a tenant but no session, and a row written under a placeholder user is worse
 * than one written under none — so the tenant-only shape is a first-class alternative rather
 * than a reason to skip the ledger.
 */
export interface GatewayAttribution {
  tenantId: string;
  userId?: string | null;
  agentActionId?: string | null;
}

export interface GatewayRequestOptions {
  messages: ChatMessage[];
  systemPrompt?: string;
  criteria?: RoutingCriteria;
  preferredModel?: string;
  temperature?: number;
  maxTokens?: number;
  /**
   * Structural rather than `SessionUser` so the gateway does not depend on the auth module.
   * `tenantId` is optional because `SessionUser`'s is: a session without one is refused by the
   * CRM services, and here it simply means the call cannot be attributed and is not recorded.
   */
  sessionUser?: { id: string; tenantId?: string };
  /** Used when there is no session — background work owned by a tenant, not a person. */
  attribution?: GatewayAttribution;
  leadId?: string;
  workOrderId?: string;
  operation?: string;
  executionId?: string;
  /** Correlation id for one logical turn, echoed into every log line and attribution row. */
  turnId?: string;
  isEssential?: boolean;
  timeoutMs?: number;
  /** Ask the provider for JSON, in whichever shape it accepts. */
  responseFormatJson?: boolean;
}

export interface ToolLoopOptions extends GatewayRequestOptions {
  tools: GatewayToolDefinition[];
  executeTool: GatewayToolExecutor;
}

/** One provider round trip, successful or not. Two attempts are two rows, and two entries. */
export interface GatewayAttempt {
  provider: ModelProvider;
  model: string;
  status: AiCallStatus;
  aiCallId: string | null;
  latencyMs: number;
  /** Safe classification only — never a provider payload. */
  errorCode?: string | null;
}

export interface GatewayResult {
  content: string;
  provider: ModelProvider;
  modelId: string;
  usage?: StreamUsage;
  durationMs: number;
  /** Every provider operation this request performed, in order. */
  attempts: GatewayAttempt[];
  aiCallId: string | null;
}

export interface StructuredRequestOptions<T> extends GatewayRequestOptions {
  schemaDescription: string;
  schema?: z.ZodType<T>;
  exampleJson?: T;
}

/** Why a request could not be served, in terms the UI layer can turn into a sentence. */
export type GatewayFailureKind =
  | 'authentication'
  | 'model_unavailable'
  | 'bad_request'
  | 'rate_limit'
  | 'quota_exceeded'
  | 'timeout'
  | 'provider_outage'
  | 'budget_exceeded'
  | 'all_providers_unavailable';

export class GatewayError extends Error {
  constructor(
    public readonly kind: GatewayFailureKind,
    message: string,
    public readonly attempts: GatewayAttempt[] = [],
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

/**
 * Classifies a provider failure without ever surfacing its payload.
 *
 * The distinction that matters operationally is between "this request was wrong" and "this
 * provider is unwell": the first will fail identically on the fallback and retrying it just
 * spends a second call, the second is exactly what a fallback exists for.
 */
export function classifyGatewayFailure(err: unknown): GatewayFailureKind {
  const status = (err as { status?: number })?.status;
  const message = err instanceof Error ? err.message : String(err);

  if (status === 401 || status === 403 || /api key|unauthorized|invalid_api_key/i.test(message)) {
    return 'authentication';
  }
  if (status === 429 || /rate.?limit|\b429\b|tokens per day|\bTPD\b|\bTPM\b/i.test(message)) {
    return 'rate_limit';
  }
  if (/quota|billing|insufficient_quota/i.test(message)) return 'quota_exceeded';
  if (status === 404 || /model_not_found|does not exist|decommissioned/i.test(message)) {
    return 'model_unavailable';
  }
  if (status === 400 || /invalid_request_error|unsupported parameter|unsupported value/i.test(message)) {
    return 'bad_request';
  }
  if (/timed out|timeout|ETIMEDOUT|AbortError|aborted/i.test(message)) return 'timeout';
  return 'provider_outage';
}

/*
 * Every failure kind fails over, and that is deliberate.
 *
 * The older policy only failed over on a rate limit, on the reasoning that a bad request or a
 * bad key would fail identically on the second provider. That reasoning holds for one provider
 * behind several models; it does not hold here. The three approved models sit behind three
 * separate credentials and accept genuinely different parameters — `max_tokens` is a 400 on
 * Luna and correct on Groq — so one model's authentication failure or 400 says nothing about
 * the next model's. Refusing to fail over is precisely how a withdrawn model turned into a
 * total chat outage.
 */

/**
 * Lazily builds one SDK client per credential value.
 *
 * The obvious alternative — construct all three in the constructor — reads the environment
 * once, at import time. The module-level `aiGateway` singleton is imported during Next.js
 * route compilation, which in a container whose secrets arrive after boot, and in every test
 * that sets a key inside `beforeEach`, is *before* the environment is final. A key set later
 * would then never be seen, and the provider would look unconfigured while its key sat right
 * there in `process.env`. Caching on the key value keeps that from costing a construction per
 * request.
 */
class LazyClient<T> {
  private cachedKey: string | null = null;
  private client: T | null = null;

  constructor(
    private readonly envVar: string,
    private readonly build: (apiKey: string) => T,
  ) {}

  get(): T | null {
    const key = (process.env[this.envVar] || '').trim();
    if (!key) {
      this.cachedKey = null;
      this.client = null;
      return null;
    }
    if (key !== this.cachedKey) {
      this.cachedKey = key;
      this.client = this.build(key);
    }
    return this.client;
  }
}

export class AiGateway {
  private readonly openai = new LazyClient('OPENAI_API_KEY', (apiKey) => new OpenAI({ apiKey }));
  private readonly gemini = new LazyClient('GEMINI_API_KEY', (apiKey) => new GoogleGenerativeAI(apiKey));
  private readonly groq = new LazyClient('GROQ_API_KEY', (apiKey) => new Groq({ apiKey }));

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Non-streaming completion with automatic failover and a pre-provider budget guard. */
  public async generate(opts: GatewayRequestOptions): Promise<GatewayResult> {
    const collected: string[] = [];
    let final: GatewayResult | null = null;
    let failure: { attempts: GatewayAttempt[]; truncated: boolean } | null = null;

    for await (const event of this.run(opts, null)) {
      if (event.kind === 'text') collected.push(event.text);
      if (event.kind === 'done') final = { ...event.result, content: collected.join('') };
      if (event.kind === 'truncated') failure = { attempts: event.attempts, truncated: true };
      if (event.kind === 'unavailable') failure = { attempts: event.attempts, truncated: false };
    }

    if (final) return final;

    // A truncated completion is not a partial success: the caller asked for a whole answer,
    // and for structured output half a JSON document parses as nothing at all.
    const attempts = failure?.attempts ?? [];
    const lastKind = (attempts[attempts.length - 1]?.errorCode ?? null) as GatewayFailureKind | null;
    throw new GatewayError(
      lastKind ?? 'all_providers_unavailable',
      failure?.truncated
        ? 'The AI provider stopped mid-response.'
        : 'No AI provider could serve this request.',
      attempts,
    );
  }

  /** Structured JSON completion with runtime Zod validation. */
  public async generateStructured<T>(opts: StructuredRequestOptions<T>): Promise<T> {
    const systemWithJson = `${opts.systemPrompt || ''}\n\nIMPORTANT: You must respond ONLY with valid, parseable JSON matching this specification:\n${opts.schemaDescription}\nDo not include backticks, markdown, or explanatory text.`;

    const res = await this.generate({
      ...opts,
      systemPrompt: systemWithJson,
      responseFormatJson: true,
      criteria: { ...opts.criteria, task: opts.criteria?.task ?? 'structured_json', requiresStructuredOutput: true },
    });

    const clean = res.content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(clean);
    } catch {
      throw new Error(`AI generated invalid JSON: ${res.content}`);
    }

    if (opts.schema) {
      const validation = opts.schema.safeParse(parsedJson);
      if (!validation.success) {
        throw new Error(`AI structured output schema validation failed: ${validation.error.message}`);
      }
      return validation.data;
    }

    return parsedJson as T;
  }

  /**
   * Streaming generator with provider failover, under full governance.
   *
   * Every exit path settles the budget reservation exactly once — success, provider error
   * before the first token, error mid-stream, timeout, consumer cancellation, and
   * every-provider-unavailable. Streamed tokens are never free as far as the ledger knows.
   */
  public async *stream(opts: GatewayRequestOptions): AsyncGenerator<string> {
    for await (const event of this.execute(opts)) {
      if (event.kind === 'text') yield event.text;
      if (event.kind === 'unavailable') yield STREAM_UNAVAILABLE_MESSAGE;
    }
  }

  /**
   * Streaming turn that may call CRM tools before it answers.
   *
   * Tools are attached to the stream itself rather than run as a separate non-streaming pass,
   * so the final answer reaches the reader progressively instead of arriving whole and being
   * chopped into fake chunks.
   */
  public async *streamWithTools(opts: ToolLoopOptions): AsyncGenerator<string> {
    for await (const event of this.execute(opts)) {
      if (event.kind === 'text') yield event.text;
      if (event.kind === 'unavailable') yield STREAM_UNAVAILABLE_MESSAGE;
    }
  }

  /**
   * The full event stream: text, the terminal outcome, and the attempt ledger.
   *
   * `stream` and `streamWithTools` flatten this to plain text for callers that only want to
   * render. A caller that must distinguish "rate limited" from "provider outage" from
   * "finished cleanly" — the chat route, which owes the SDR an accurate sentence — consumes
   * the events instead. Every failure classification the UI shows comes from here rather than
   * from re-inspecting an exception, so the two can never disagree.
   */
  public execute(opts: GatewayRequestOptions | ToolLoopOptions): AsyncGenerator<GatewayEvent> {
    const toolLoop =
      'tools' in opts && Array.isArray(opts.tools)
        ? { tools: opts.tools, executeTool: (opts as ToolLoopOptions).executeTool }
        : null;
    return this.run(opts, toolLoop);
  }

  public getHealth(): Record<string, unknown> {
    return {
      providers: {
        openai: this.isProviderConfigured('openai'),
        google: this.isProviderConfigured('google'),
        groq: this.isProviderConfigured('groq'),
      },
      circuits: circuitBreaker.getStatuses(),
    };
  }

  /** Whether a provider's credentials are present in this process. Never returns the value. */
  public isProviderConfigured(provider: ModelProvider): boolean {
    if (provider === 'openai') return !!this.openai.get();
    if (provider === 'google') return !!this.gemini.get();
    return !!this.groq.get();
  }

  public hasAnyProvider(): boolean {
    return (
      this.isProviderConfigured('openai') ||
      this.isProviderConfigured('google') ||
      this.isProviderConfigured('groq')
    );
  }

  // ── The one execution path ─────────────────────────────────────────────────

  private async *run(
    opts: GatewayRequestOptions,
    toolLoop: { tools: GatewayToolDefinition[]; executeTool: GatewayToolExecutor } | null,
  ): AsyncGenerator<GatewayEvent> {
    const reservation: BudgetReservation | null = await checkAndReserveAiBudget({
      tenantId: this.tenantOf(opts),
      estimatedCostUsd: 0.005,
      operation: opts.operation || opts.criteria?.task || 'generate',
      isEssential: opts.isEssential,
    });

    let settled = false;
    const settleOnce = async (actualCostUsd: number | null): Promise<void> => {
      if (settled || !reservation) return;
      settled = true;
      if (actualCostUsd === null) await reservation.release();
      else await reservation.reconcile(actualCostUsd);
    };

    const attempts: GatewayAttempt[] = [];

    try {
      // Pick up circuits other instances have opened before choosing a model.
      await circuitBreaker.sync();

      const criteria: RoutingCriteria = {
        task: opts.operation ?? 'stream',
        ...opts.criteria,
        ...(opts.preferredModel ? { preferredModel: opts.preferredModel } : {}),
      };

      let modelsToTry: ModelMetadata[];
      try {
        const route = routeModel(criteria, {
          // A provider with no credentials in this process can never answer. Filtering it out
          // here rather than discovering it inside the loop stops it from consuming a
          // failover slot that a usable model needed.
          requireConfiguredProvider: true,
        });
        modelsToTry = [route.primaryModel, ...route.fallbackModels];
      } catch (err) {
        if (!(err instanceof UnroutableRequestError)) throw err;
        await settleOnce(null);
        yield { kind: 'unavailable', reason: 'unroutable', attempts };
        return;
      }

      const timeoutMs = opts.timeoutMs ?? 60_000;

      for (const model of modelsToTry) {
        if (!circuitBreaker.isAvailable(model.provider, model.modelId)) continue;
        // Exactly one instance probes a recovering provider.
        if (!(await circuitBreaker.tryEnterHalfOpen(model.provider, model.modelId))) continue;

        const startedAt = Date.now();
        const controller = new AbortController();
        const deadline = setTimeout(() => controller.abort(), timeoutMs);
        let usage: StreamUsage | null = null;
        let produced = false;

        try {
          const loop = this.runModel(model, opts, toolLoop, controller.signal);
          for await (const chunk of loop) {
            if (chunk.text) {
              produced = true;
              yield { kind: 'text', text: chunk.text };
            }
            if (chunk.usage) usage = accumulate(usage, chunk.usage);
          }

          clearTimeout(deadline);
          circuitBreaker.recordSuccess(model.provider, model.modelId);
          await circuitBreaker.publish(model.provider, model.modelId);
          await circuitBreaker.exitHalfOpen(model.provider, model.modelId);

          const record = await this.recordAttribution(opts, model, Date.now() - startedAt, 'ok', usage);
          attempts.push({
            provider: model.provider,
            model: model.modelId,
            status: 'ok',
            aiCallId: record.aiCallId,
            latencyMs: Date.now() - startedAt,
          });
          await settleOnce(record.estimatedCostUsd ?? 0);

          yield {
            kind: 'done',
            result: {
              content: '',
              provider: model.provider,
              modelId: model.modelId,
              usage: usage ?? undefined,
              durationMs: Date.now() - startedAt,
              attempts,
              aiCallId: record.aiCallId,
            },
          };
          return;
        } catch (err: unknown) {
          clearTimeout(deadline);
          const timedOut = controller.signal.aborted;
          const kind = timedOut ? 'timeout' : classifyGatewayFailure(err);
          const status: AiCallStatus =
            kind === 'rate_limit' || kind === 'quota_exceeded'
              ? 'rate_limited'
              : kind === 'timeout' || kind === 'authentication'
                ? 'unavailable'
                : 'error';

          circuitBreaker.recordFailure(model.provider, model.modelId, status === 'rate_limited');
          await circuitBreaker.publish(model.provider, model.modelId);
          await circuitBreaker.exitHalfOpen(model.provider, model.modelId);

          // Tokens already streamed were still billed by the provider, so partial usage is
          // charged rather than discarded.
          const record = await this.recordAttribution(opts, model, Date.now() - startedAt, status, usage, kind);
          attempts.push({
            provider: model.provider,
            model: model.modelId,
            status,
            aiCallId: record.aiCallId,
            latencyMs: Date.now() - startedAt,
            errorCode: kind,
          });

          logGatewayFailure(opts, model, kind, Date.now() - startedAt);

          if (produced) {
            // The consumer has already seen part of an answer. Failing over now would splice
            // two different completions together, so this stream ends here.
            await settleOnce(record.estimatedCostUsd ?? 0);
            yield { kind: 'truncated', attempts };
            return;
          }
          // Nothing emitted yet — a fallback can still serve the request cleanly.
        }
      }

      await settleOnce(null);
      yield { kind: 'unavailable', reason: 'all_providers_failed', attempts };
    } finally {
      // Consumer cancellation lands here: the generator was disposed before any path settled.
      // Releasing the hold is what stops an abandoned stream from permanently consuming a
      // slice of the tenant's budget.
      if (!settled && reservation) {
        settled = true;
        await reservation.release();
      }
    }
  }

  /**
   * One model, one turn — including however many tool round trips the turn needs.
   *
   * A tool round trip is a fresh provider stream over a longer message list. It is not a new
   * routing decision: switching models mid-turn would hand the second half of a conversation
   * to a model that never saw the tool results it is meant to be summarising.
   */
  private async *runModel(
    model: ModelMetadata,
    opts: GatewayRequestOptions,
    toolLoop: { tools: GatewayToolDefinition[]; executeTool: GatewayToolExecutor } | null,
    signal: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const messages: LoopMessage[] = toLoopMessages(opts.systemPrompt, opts.messages);
    const adapterOptions: AdapterOptions = {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      responseFormatJson: opts.responseFormatJson,
      ...(toolLoop && model.supportsTools ? { tools: toolLoop.tools } : {}),
    };

    let ordinal = 0;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      let pendingText = '';
      let pendingCalls: PendingToolCall[] | null = null;

      for await (const chunk of this.openProviderStream(model, messages, adapterOptions, signal)) {
        if (chunk.text) pendingText += chunk.text;
        if (chunk.toolCalls) pendingCalls = chunk.toolCalls;
        yield chunk;
      }

      if (!toolLoop || !pendingCalls || pendingCalls.length === 0) return;

      messages.push({ role: 'assistant', content: pendingText, toolCalls: pendingCalls });

      for (const call of pendingCalls) {
        const result = await toolLoop.executeTool({
          name: call.name,
          args: parseToolArguments(call.arguments),
          ordinal: ordinal++,
        });
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: result });
      }
    }

    // Iterations exhausted with the model still asking for tools. Say so rather than ending
    // on silence, which the UI would render as an empty assistant bubble.
    yield {
      text: 'I could not finish that in the number of steps available. Ask me again, more specifically.',
      usage: null,
    };
  }

  private openProviderStream(
    model: ModelMetadata,
    messages: LoopMessage[],
    adapterOptions: AdapterOptions,
    signal: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    if (model.provider === 'openai') {
      const client = this.openai.get();
      if (!client) throw new Error('OPENAI_API_KEY is not configured');
      return streamOpenAi(client, model, messages, adapterOptions, signal);
    }
    if (model.provider === 'groq') {
      const client = this.groq.get();
      if (!client) throw new Error('GROQ_API_KEY is not configured');
      return streamGroq(client, model, messages, adapterOptions, signal);
    }
    const client = this.gemini.get();
    if (!client) throw new Error('GEMINI_API_KEY is not configured');
    return streamGemini(client, model, messages, adapterOptions, signal);
  }

  private tenantOf(opts: GatewayRequestOptions): string | undefined {
    return opts.sessionUser?.tenantId ?? opts.attribution?.tenantId;
  }

  private async recordAttribution(
    opts: GatewayRequestOptions,
    model: ModelMetadata,
    latencyMs: number,
    status: AiCallStatus,
    usage?: StreamUsage | null,
    failureKind?: GatewayFailureKind,
  ): Promise<{ estimatedCostUsd: number | null; aiCallId: string | null }> {
    const tenantId = this.tenantOf(opts);
    if (!tenantId) return { estimatedCostUsd: null, aiCallId: null };

    return recordAiCall({
      tenantId,
      userId: opts.sessionUser?.id ?? opts.attribution?.userId ?? null,
      leadId: opts.leadId ?? null,
      workOrderId: opts.workOrderId ?? null,
      agentActionId: opts.attribution?.agentActionId ?? null,
      operation: opts.operation ?? 'gateway_inference',
      provider: model.provider,
      // The registry's alias is the provider's own model id, so this row names the model that
      // actually answered. It used to name an alias that mapped to something else entirely.
      model: model.modelId,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      latencyMs,
      status,
      errorCode: failureKind ?? null,
    });
  }
}

// ── Internals ────────────────────────────────────────────────────────────────

export type GatewayEvent =
  /** A piece of the answer, already safe to render. */
  | { kind: 'text'; text: string }
  /** The turn completed. `result.content` is empty on the streaming paths — text was yielded. */
  | { kind: 'done'; result: GatewayResult }
  /** A provider died after emitting text. No failover, because splicing two answers is worse. */
  | { kind: 'truncated'; attempts: GatewayAttempt[] }
  /** Nothing could serve the request. `attempts` says what was tried and why each failed. */
  | { kind: 'unavailable'; reason: string; attempts: GatewayAttempt[] };

function accumulate(current: StreamUsage | null, next: StreamUsage): StreamUsage {
  if (!current) return next;
  return {
    promptTokens: current.promptTokens + next.promptTokens,
    completionTokens: current.completionTokens + next.completionTokens,
    totalTokens: current.totalTokens + next.totalTokens,
    estimatedCostUsd: current.estimatedCostUsd + next.estimatedCostUsd,
  };
}

/**
 * Arguments the model emitted, or `null` when they are not valid JSON.
 *
 * Returning `null` rather than throwing hands the decision to the executor, which is the layer
 * that knows whether a malformed call should be refused or retried — and which must record the
 * refusal rather than let a parse error abort the whole turn.
 */
function parseToolArguments(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * One structured line per failed provider attempt.
 *
 * Deliberately carries no prompt, no completion, no credential and no provider payload — only
 * the classification and the ids needed to find the turn again. The whole reason this defect
 * took so long to place was that the browser saw one generic sentence and the server logged a
 * bare message with no correlation id.
 */
function logGatewayFailure(
  opts: GatewayRequestOptions,
  model: ModelMetadata,
  kind: GatewayFailureKind,
  latencyMs: number,
): void {
  console.error(
    '[ai/gateway] provider attempt failed',
    JSON.stringify({
      operation: opts.operation ?? 'gateway_inference',
      turnId: opts.turnId ?? null,
      executionId: opts.executionId ?? null,
      tenantId: opts.sessionUser?.tenantId ?? opts.attribution?.tenantId ?? null,
      userId: opts.sessionUser?.id ?? opts.attribution?.userId ?? null,
      provider: model.provider,
      model: model.modelId,
      failure: kind,
      latencyMs,
    }),
  );
}

export const aiGateway = new AiGateway();
