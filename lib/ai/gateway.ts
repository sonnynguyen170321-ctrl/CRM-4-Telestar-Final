/**
 * Telestar Provider-Neutral AI Gateway (Directive Phase 1 §8–§21).
 * Single unified entrypoint for all AI generation, streaming, structured output, and tool loops.
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { z } from 'zod';
import { circuitBreaker } from './circuitBreaker';
import { routeModel, type RoutingCriteria } from './router';
import type { ModelMetadata } from './registry';
import { recordAiCall, classifyFailure, type AiCallStatus } from './usage';
import { checkAndReserveAiBudget, type BudgetReservation } from './budget';
import type { SessionUser } from '@/lib/auth';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface GatewayRequestOptions {
  messages: ChatMessage[];
  systemPrompt?: string;
  criteria?: RoutingCriteria;
  preferredModel?: string;
  temperature?: number;
  maxTokens?: number;
  sessionUser?: SessionUser;
  leadId?: string;
  workOrderId?: string;
  operation?: string;
  executionId?: string;
  turnId?: string;
  isEssential?: boolean;
  timeoutMs?: number;
}

export interface GatewayResult {
  content: string;
  provider: string;
  modelId: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  durationMs: number;
}

/** What the CRM says when no provider can serve a streamed request. */
const STREAM_UNAVAILABLE_MESSAGE =
  'Telestar AI is temporarily unavailable. Core CRM operations remain operational.';

/** Token counts as the OpenAI-compatible providers report them. */
interface RawUsage {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
}

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface StreamChunk {
  text: string;
  usage: StreamUsage | null;
}

function toStreamUsage(raw: RawUsage, model: ModelMetadata): StreamUsage {
  const promptTokens = raw.prompt_tokens ?? 0;
  const completionTokens = raw.completion_tokens ?? 0;
  return {
    promptTokens,
    completionTokens,
    totalTokens: raw.total_tokens ?? promptTokens + completionTokens,
    estimatedCostUsd:
      (promptTokens / 1000) * model.costPer1kInputUsd +
      (completionTokens / 1000) * model.costPer1kOutputUsd,
  };
}

export interface StructuredRequestOptions<T> extends GatewayRequestOptions {
  schemaDescription: string;
  schema?: z.ZodType<T>;
  exampleJson?: T;
}

export class AiGateway {
  private openaiClient: OpenAI | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;
  private groqClient: Groq | null = null;

  constructor() {
    this.initClients();
  }

  private initClients() {
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY.trim() });
    }
    if (process.env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
    }
    if (process.env.GROQ_API_KEY) {
      this.groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });
    }
  }

  /**
   * Standard non-streaming completion with automatic failover and pre-provider budget guard.
   */
  public async generate(opts: GatewayRequestOptions): Promise<GatewayResult> {
    // Pre-provider budget reservation
    const tenantId = opts.sessionUser?.tenantId;
    const reservation: BudgetReservation | null = await checkAndReserveAiBudget({
      tenantId,
      estimatedCostUsd: 0.005,
      operation: opts.operation || opts.criteria?.task || 'generate',
      isEssential: opts.isEssential,
    });

    // Pick up circuits other instances have opened before choosing a model (TEL-P1-017).
    await circuitBreaker.sync();

    const route = routeModel(opts.criteria || { task: 'generate', preferredModel: opts.preferredModel });
    const modelsToTry = [route.primaryModel, ...route.fallbackModels];

    let lastError: unknown = null;

    for (const model of modelsToTry) {
      if (!circuitBreaker.isAvailable(model.provider, model.modelId)) continue;
      // Exactly one instance probes a recovering provider.
      if (!(await circuitBreaker.tryEnterHalfOpen(model.provider, model.modelId))) continue;

      const startedAt = Date.now();
      try {
        const timeout = opts.timeoutMs ?? 15000;
        const callPromise = (async () => {
          if (model.provider === 'openai') {
            return this.callOpenAi(model, opts);
          } else if (model.provider === 'google') {
            return this.callGemini(model, opts);
          } else {
            return this.callGroq(model, opts);
          }
        })();

        const result: GatewayResult = await Promise.race([
          callPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI provider ${model.provider} timed out after ${timeout}ms`)), timeout)
          ),
        ]);

        circuitBreaker.recordSuccess(model.provider, model.modelId);
        await circuitBreaker.publish(model.provider, model.modelId);
        await circuitBreaker.exitHalfOpen(model.provider, model.modelId);
        await this.recordAttribution(opts, model, result.durationMs, 'ok');

        if (reservation && result.usage?.estimatedCostUsd) {
          await reservation.reconcile(result.usage.estimatedCostUsd);
        } else if (reservation) {
          await reservation.release();
        }

        return result;
      } catch (err: unknown) {
        lastError = err;
        const isRateLimit = this.isRateLimit(err);
        circuitBreaker.recordFailure(model.provider, model.modelId, isRateLimit);
        await circuitBreaker.publish(model.provider, model.modelId);
        await circuitBreaker.exitHalfOpen(model.provider, model.modelId);
        await this.recordAttribution(opts, model, Date.now() - startedAt, 'error', String(err));
        // Continue to fallback model
      }
    }

    if (reservation) {
      await reservation.release();
    }

    throw new Error(`All AI providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  /**
   * Structured JSON completion with runtime Zod validation.
   */
  public async generateStructured<T>(opts: StructuredRequestOptions<T>): Promise<T> {
    const systemWithJson = `${opts.systemPrompt || ''}\n\nIMPORTANT: You must respond ONLY with valid, parseable JSON matching this specification:\n${opts.schemaDescription}\nDo not include backticks, markdown, or explanatory text.`;
    
    const res = await this.generate({
      ...opts,
      systemPrompt: systemWithJson,
      criteria: { ...opts.criteria, task: 'structured_json', requiresStructuredOutput: true },
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
   * Streaming generator with provider failover, under the same governance as `generate`
   * (TEL-P1-016).
   *
   * The previous implementation opened a provider stream with none of it: no budget
   * reservation, no timeout, no usage reconciliation, no attribution row, and no accounting
   * when the consumer walked away. Streamed tokens were free as far as the ledger knew.
   *
   * Every exit path settles exactly once - success, provider error before the first token,
   * error mid-stream, timeout, consumer cancellation, and every-provider-unavailable. The
   * `finally` block is what makes cancellation safe: a consumer that breaks out of the
   * `for await` triggers the generator's `return()`, which runs it.
   */
  public async *stream(opts: GatewayRequestOptions): AsyncGenerator<string> {
    const reservation: BudgetReservation | null = await checkAndReserveAiBudget({
      tenantId: opts.sessionUser?.tenantId,
      estimatedCostUsd: 0.005,
      operation: opts.operation || opts.criteria?.task || 'stream',
      isEssential: opts.isEssential,
    });

    let settled = false;
    const settleOnce = async (actualCostUsd: number | null): Promise<void> => {
      if (settled || !reservation) return;
      settled = true;
      if (actualCostUsd === null) await reservation.release();
      else await reservation.reconcile(actualCostUsd);
    };

    try {
      // Pick up circuits other instances have opened before choosing a model.
      await circuitBreaker.sync();

      let modelsToTry: ModelMetadata[];
      try {
        const route = routeModel(
          opts.criteria || { task: 'stream', preferredModel: opts.preferredModel },
        );
        modelsToTry = [route.primaryModel, ...route.fallbackModels];
      } catch {
        // Nothing can serve this request. Degrade rather than throwing into the UI.
        await settleOnce(null);
        yield STREAM_UNAVAILABLE_MESSAGE;
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
          for await (const chunk of this.openProviderStream(model, opts, controller.signal)) {
            if (chunk.text) {
              produced = true;
              yield chunk.text;
            }
            if (chunk.usage) usage = chunk.usage;
          }

          clearTimeout(deadline);
          circuitBreaker.recordSuccess(model.provider, model.modelId);
          await circuitBreaker.publish(model.provider, model.modelId);
          await circuitBreaker.exitHalfOpen(model.provider, model.modelId);

          const cost = await this.recordAttribution(
            opts,
            model,
            Date.now() - startedAt,
            'ok',
            undefined,
            usage,
          );
          await settleOnce(cost ?? 0);
          return;
        } catch (err: unknown) {
          clearTimeout(deadline);
          const timedOut = controller.signal.aborted;
          circuitBreaker.recordFailure(model.provider, model.modelId, this.isRateLimit(err));
          await circuitBreaker.publish(model.provider, model.modelId);
          await circuitBreaker.exitHalfOpen(model.provider, model.modelId);

          // Tokens already streamed were still billed by the provider, so partial usage is
          // charged rather than discarded.
          const partialCost = await this.recordAttribution(
            opts,
            model,
            Date.now() - startedAt,
            timedOut ? 'unavailable' : 'error',
            String(err),
            usage,
            timedOut ? 'provider_timeout' : undefined,
          );

          if (produced) {
            // The consumer has already seen part of an answer. Failing over now would
            // splice two different completions together, so this stream ends here.
            await settleOnce(partialCost ?? 0);
            return;
          }
          // Nothing emitted yet - a fallback can still serve the request cleanly.
        }
      }

      await settleOnce(null);
      yield STREAM_UNAVAILABLE_MESSAGE;
    } finally {
      // Consumer cancellation lands here: the generator was disposed before any path
      // settled. Releasing the hold is what stops an abandoned stream from permanently
      // consuming a slice of the tenant's budget.
      if (!settled && reservation) {
        settled = true;
        await reservation.release();
      }
    }
  }

  /**
   * Normalises the three provider SDKs into one chunk stream carrying text and, where the
   * provider reports it, usage. OpenAI-compatible providers report usage in a final chunk
   * when asked; Gemini reports it on the aggregated response.
   */
  private async *openProviderStream(
    model: ModelMetadata,
    opts: GatewayRequestOptions,
    signal: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    if (model.provider === 'openai') {
      if (!this.openaiClient) throw new Error('OPENAI_API_KEY is not configured');
      const stream = await this.openaiClient.chat.completions.create(
        {
          model: model.modelId,
          messages: this.buildOpenAiMessages(opts),
          stream: true,
          stream_options: { include_usage: true },
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? model.maxOutputTokens,
        },
        { signal },
      );

      for await (const chunk of stream) {
        yield {
          text: chunk.choices[0]?.delta?.content ?? '',
          usage: chunk.usage ? toStreamUsage(chunk.usage, model) : null,
        };
      }
      return;
    }

    if (model.provider === 'groq') {
      if (!this.groqClient) throw new Error('GROQ_API_KEY is not configured');
      const stream = await this.groqClient.chat.completions.create(
        {
          model: model.modelId,
          messages: this.buildGroqMessages(opts),
          stream: true,
          temperature: opts.temperature ?? 0.7,
          max_tokens: opts.maxTokens ?? model.maxOutputTokens,
        },
        { signal },
      );

      for await (const chunk of stream) {
        const usage = (chunk as { x_groq?: { usage?: RawUsage } }).x_groq?.usage;
        yield {
          text: chunk.choices[0]?.delta?.content ?? '',
          usage: usage ? toStreamUsage(usage, model) : null,
        };
      }
      return;
    }

    if (model.provider === 'google') {
      if (!this.geminiClient) throw new Error('GEMINI_API_KEY is not configured');
      const genModel = this.geminiClient.getGenerativeModel({ model: model.modelId });
      const prompt = `${opts.systemPrompt ? `[SYSTEM]: ${opts.systemPrompt}\n\n` : ''}${opts.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`;
      const result = await genModel.generateContentStream(prompt);

      for await (const chunk of result.stream) {
        // The Gemini SDK takes no AbortSignal, so the deadline is enforced between chunks.
        if (signal.aborted) throw new Error('AI provider google timed out');
        const text = chunk.text();
        if (text) yield { text, usage: null };
      }

      const aggregated = await result.response;
      const meta = aggregated.usageMetadata;
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
      };
      return;
    }

    throw new Error(`No streaming implementation for provider ${model.provider}`);
  }


  // ── Provider Implementations ───────────────────────────────────────────────

  private async callOpenAi(model: ModelMetadata, opts: GatewayRequestOptions): Promise<GatewayResult> {
    if (!this.openaiClient) throw new Error('OPENAI_API_KEY is not configured');
    const start = Date.now();

    const response = await this.openaiClient.chat.completions.create({
      model: model.modelId,
      messages: this.buildOpenAiMessages(opts),
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? model.maxOutputTokens,
    });

    const choice = response.choices[0];
    const durationMs = Date.now() - start;
    const usage = response.usage;

    return {
      content: choice?.message?.content || '',
      provider: 'openai',
      modelId: model.modelId,
      durationMs,
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens,
            completionTokens: usage.completion_tokens,
            totalTokens: usage.total_tokens,
            estimatedCostUsd:
              (usage.prompt_tokens / 1000) * model.costPer1kInputUsd +
              (usage.completion_tokens / 1000) * model.costPer1kOutputUsd,
          }
        : undefined,
    };
  }

  private async callGemini(model: ModelMetadata, opts: GatewayRequestOptions): Promise<GatewayResult> {
    if (!this.geminiClient) throw new Error('GEMINI_API_KEY is not configured');
    const start = Date.now();

    const genModel = this.geminiClient.getGenerativeModel({ model: model.modelId });
    const prompt = `${opts.systemPrompt ? `[SYSTEM]: ${opts.systemPrompt}\n\n` : ''}${opts.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`;
    const res = await genModel.generateContent(prompt);
    const text = res.response.text();
    const durationMs = Date.now() - start;

    return {
      content: text || '',
      provider: 'google',
      modelId: model.modelId,
      durationMs,
    };
  }

  private async callGroq(model: ModelMetadata, opts: GatewayRequestOptions): Promise<GatewayResult> {
    if (!this.groqClient) throw new Error('GROQ_API_KEY is not configured');
    const start = Date.now();

    const response = await this.groqClient.chat.completions.create({
      model: model.modelId,
      messages: this.buildGroqMessages(opts),
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? model.maxOutputTokens,
    });

    const choice = response.choices[0];
    const durationMs = Date.now() - start;

    return {
      content: choice?.message?.content || '',
      provider: 'groq',
      modelId: model.modelId,
      durationMs,
    };
  }

  private buildOpenAiMessages(opts: GatewayRequestOptions): OpenAI.Chat.ChatCompletionMessageParam[] {
    const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemPrompt) {
      msgs.push({ role: 'system', content: opts.systemPrompt });
    }
    for (const m of opts.messages) {
      msgs.push({ role: m.role, content: m.content });
    }
    return msgs;
  }

  private buildGroqMessages(opts: GatewayRequestOptions): Groq.Chat.ChatCompletionMessageParam[] {
    const msgs: Groq.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemPrompt) {
      msgs.push({ role: 'system', content: opts.systemPrompt });
    }
    for (const m of opts.messages) {
      msgs.push({ role: m.role, content: m.content } as Groq.Chat.ChatCompletionMessageParam);
    }
    return msgs;
  }

  private isRateLimit(err: unknown): boolean {
    if ((err as { status?: number })?.status === 429) return true;
    const msg = err instanceof Error ? err.message : String(err);
    return /rate.?limit|\b429\b|quota|tpd|tpm/i.test(msg);
  }

  private async recordAttribution(
    opts: GatewayRequestOptions,
    model: ModelMetadata,
    latencyMs: number,
    status: AiCallStatus,
    errorMessage?: string,
    usage?: StreamUsage | null,
    errorCodeOverride?: string
  ): Promise<number | null> {
    if (!opts.sessionUser) return null;

    const outcome = await recordAiCall({
      tenantId: opts.sessionUser.tenantId,
      userId: opts.sessionUser.id,
      leadId: opts.leadId ?? null,
      workOrderId: opts.workOrderId ?? null,
      operation: opts.operation ?? 'gateway_inference',
      provider: model.provider,
      model: model.modelId,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      totalTokens: usage?.totalTokens ?? null,
      latencyMs,
      status,
      errorCode: errorCodeOverride ?? (errorMessage ? classifyFailure(errorMessage) : undefined),
    });

    return outcome.estimatedCostUsd;
  }

  public getHealth(): Record<string, unknown> {
    return {
      providers: {
        openai: !!process.env.OPENAI_API_KEY,
        google: !!process.env.GEMINI_API_KEY,
        groq: !!process.env.GROQ_API_KEY,
      },
      circuits: circuitBreaker.getStatuses(),
    };
  }
}

export const aiGateway = new AiGateway();
