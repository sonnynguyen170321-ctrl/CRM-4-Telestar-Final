/**
 * Telestar Provider-Neutral AI Gateway (Directive Phase 1 §8–§21).
 * Single unified entrypoint for all AI generation, streaming, structured output, and tool loops.
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Groq from 'groq-sdk';
import { circuitBreaker } from './circuitBreaker';
import { routeModel, type RoutingCriteria } from './router';
import type { ModelMetadata } from './registry';
import { recordAiCall, classifyFailure } from './usage';
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

export interface StructuredRequestOptions<T> extends GatewayRequestOptions {
  schemaDescription: string;
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
   * Standard non-streaming completion with automatic failover.
   */
  public async generate(opts: GatewayRequestOptions): Promise<GatewayResult> {
    const route = routeModel(opts.criteria || { task: 'generate', preferredModel: opts.preferredModel });
    const modelsToTry = [route.primaryModel, ...route.fallbackModels];

    let lastError: unknown = null;

    for (const model of modelsToTry) {
      if (!circuitBreaker.isAvailable(model.provider, model.modelId)) continue;

      const startedAt = Date.now();
      try {
        let result: GatewayResult;

        if (model.provider === 'openai') {
          result = await this.callOpenAi(model, opts);
        } else if (model.provider === 'google') {
          result = await this.callGemini(model, opts);
        } else {
          result = await this.callGroq(model, opts);
        }

        circuitBreaker.recordSuccess(model.provider, model.modelId);
        await this.recordAttribution(opts, model, result.durationMs, 'ok');
        return result;
      } catch (err: unknown) {
        lastError = err;
        const isRateLimit = this.isRateLimit(err);
        circuitBreaker.recordFailure(model.provider, model.modelId, isRateLimit);
        await this.recordAttribution(opts, model, Date.now() - startedAt, 'error', String(err));
        // Continue to fallback model
      }
    }

    throw new Error(`All AI providers failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  /**
   * Structured JSON completion.
   */
  public async generateStructured<T>(opts: StructuredRequestOptions<T>): Promise<T> {
    const systemWithJson = `${opts.systemPrompt || ''}\n\nIMPORTANT: You must respond ONLY with valid, parseable JSON matching this specification:\n${opts.schemaDescription}\nDo not include backticks, markdown, or explanatory text.`;
    
    const res = await this.generate({
      ...opts,
      systemPrompt: systemWithJson,
      criteria: { ...opts.criteria, task: 'structured_json', requiresStructuredOutput: true },
    });

    try {
      const clean = res.content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
      return JSON.parse(clean) as T;
    } catch {
      throw new Error(`AI generated invalid JSON: ${res.content}`);
    }
  }

  /**
   * Streaming generator with provider failover.
   */
  public async *stream(opts: GatewayRequestOptions): AsyncGenerator<string> {
    const route = routeModel(opts.criteria || { task: 'stream', preferredModel: opts.preferredModel });
    const modelsToTry = [route.primaryModel, ...route.fallbackModels];

    for (const model of modelsToTry) {
      if (!circuitBreaker.isAvailable(model.provider, model.modelId)) continue;

      try {
        if (model.provider === 'openai' && this.openaiClient) {
          const stream = await this.openaiClient.chat.completions.create({
            model: model.modelId,
            messages: this.buildOpenAiMessages(opts),
            stream: true,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.maxTokens ?? model.maxOutputTokens,
          });

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) yield delta;
          }
          circuitBreaker.recordSuccess(model.provider, model.modelId);
          return;
        } else if (model.provider === 'groq' && this.groqClient) {
          const stream = await this.groqClient.chat.completions.create({
            model: model.modelId,
            messages: this.buildGroqMessages(opts),
            stream: true,
            temperature: opts.temperature ?? 0.7,
            max_tokens: opts.maxTokens ?? model.maxOutputTokens,
          });

          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) yield delta;
          }
          circuitBreaker.recordSuccess(model.provider, model.modelId);
          return;
        } else if (model.provider === 'google' && this.geminiClient) {
          const genModel = this.geminiClient.getGenerativeModel({ model: model.modelId });
          const prompt = `${opts.systemPrompt ? `[SYSTEM]: ${opts.systemPrompt}\n\n` : ''}${opts.messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}`;
          const result = await genModel.generateContentStream(prompt);

          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) yield text;
          }
          circuitBreaker.recordSuccess(model.provider, model.modelId);
          return;
        }
      } catch (err: unknown) {
        circuitBreaker.recordFailure(model.provider, model.modelId, this.isRateLimit(err));
        // Continue to fallback
      }
    }

    yield 'Telestar AI is temporarily unavailable. Core CRM operations remain operational.';
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
    status: 'ok' | 'error',
    errorMessage?: string
  ) {
    if (!opts.sessionUser) return;

    await recordAiCall({
      tenantId: opts.sessionUser.tenantId,
      userId: opts.sessionUser.id,
      leadId: opts.leadId ?? null,
      workOrderId: opts.workOrderId ?? null,
      operation: opts.operation ?? 'gateway_inference',
      provider: model.provider,
      model: model.modelId,
      latencyMs,
      status,
      errorCode: errorMessage ? classifyFailure(errorMessage) : undefined,
    });
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
