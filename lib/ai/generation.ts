import { recordAiCall, classifyFailure } from './usage';
import { DEFAULT_MODEL, type ModelId } from './models';
import {
  createGeminiClient,
  createGroqClient,
  GEMINI_FALLBACK_MODEL,
  hasAnyProvider,
  primaryProvider,
  shouldFallbackToGemini,
  type AiProviderId,
} from './providerRouting';

/**
 * Tool-less structured generation for background work (Revenue AI Phase 8a).
 *
 * `provider.ts` streams a conversation and runs the tool loop — the right shape for a chat turn,
 * the wrong one for a worker that wants one bounded completion and a parsed object. This is that
 * primitive.
 *
 * **Provider selection and failover are not implemented here.** They live in
 * `./providerRouting`, which `streamChat` uses too, because the first revision of this file grew
 * its own `if (GROQ_API_KEY) … else Gemini` and immediately disagreed with the chat path: a Groq
 * 429 degraded background generation while the same two keys made chat retry on Gemini. One
 * router, two modes.
 *
 * ## Two attempts are two rows
 *
 * When Groq is rate limited and Gemini succeeds, two provider operations happened. Both are
 * recorded through the single existing `recordAiCall` ledger — the failed attempt as
 * `rate_limited`, the fallback as `ok`. Collapsing them would hide a provider's reliability
 * problem behind its replacement's success, and understate what the tenant's traffic cost.
 *
 * ## It never throws
 *
 * A provider outage degrades the feature, not the caller. Every failure returns
 * `available: false` with a reason, and the caller falls back to what it does without AI. There
 * are no tools here, so a background generation cannot reach a CRM mutation by any path.
 */

export interface GenerationAttribution {
  tenantId: string;
  userId?: string | null;
  leadId?: string | null;
  workOrderId?: string | null;
  agentActionId?: string | null;
  /** What the call was for — 'prioritization', 'sequence_draft', … */
  operation: string;
}

export interface GenerateStructuredInput extends GenerationAttribution {
  systemPrompt: string;
  userPrompt: string;
  modelId?: ModelId;
  maxOutputTokens?: number;
}

export interface GenerationAttempt {
  provider: AiProviderId;
  model: string;
  status: 'ok' | 'rate_limited' | 'error' | 'unavailable';
  aiCallId: string | null;
}

export interface GenerationOutcome<T> {
  /** False when no provider produced usable output. */
  available: boolean;
  data: T | null;
  raw: string | null;
  /** The successful call's id, or the last failed attempt's. */
  aiCallId: string | null;
  reason?: string;
  model?: string;
  provider?: AiProviderId;
  /** Every provider operation this generation performed, in order. */
  attempts: GenerationAttempt[];
}

/** True when at least one generation provider is configured. */
export function isGenerationAvailable(): boolean {
  return hasAnyProvider();
}

export async function generateStructured<T>(
  input: GenerateStructuredInput,
  parse: (raw: string) => T | null
): Promise<GenerationOutcome<T>> {
  const attribution = {
    tenantId: input.tenantId,
    userId: input.userId ?? null,
    leadId: input.leadId ?? null,
    workOrderId: input.workOrderId ?? null,
    agentActionId: input.agentActionId ?? null,
    operation: input.operation,
  };

  const first = primaryProvider();
  if (!first) {
    const rec = await recordAiCall({
      ...attribution,
      provider: 'groq',
      model: input.modelId ?? DEFAULT_MODEL,
      latencyMs: 0,
      status: 'unavailable',
      errorCode: 'NO_API_KEY',
    });
    return {
      available: false,
      data: null,
      raw: null,
      aiCallId: rec.aiCallId,
      reason: 'no generation provider configured',
      attempts: [
        { provider: 'groq', model: input.modelId ?? DEFAULT_MODEL, status: 'unavailable', aiCallId: rec.aiCallId },
      ],
    };
  }

  const attempts: GenerationAttempt[] = [];
  let provider: AiProviderId | null = first;
  let lastReason = 'generation failed';

  while (provider) {
    const startedAt = Date.now();
    const model = provider === 'groq' ? (input.modelId ?? DEFAULT_MODEL) : GEMINI_FALLBACK_MODEL;

    try {
      const completion =
        provider === 'groq' ? await completeWithGroq(input, model) : await completeWithGemini(input, model);

      const rec = await recordAiCall({
        ...attribution,
        provider,
        model,
        promptTokens: completion.promptTokens,
        completionTokens: completion.completionTokens,
        totalTokens: completion.totalTokens,
        latencyMs: Date.now() - startedAt,
        status: 'ok',
      });
      attempts.push({ provider, model, status: 'ok', aiCallId: rec.aiCallId });

      const parsed = safeParse(completion.text, parse);
      if (parsed === null) {
        // The provider answered; the answer was unusable. Not a provider fault, so no fallback —
        // the other model would be just as free to return prose.
        return {
          available: false,
          data: null,
          raw: completion.text,
          aiCallId: rec.aiCallId,
          reason: 'generation could not be parsed into the expected shape',
          model,
          provider,
          attempts,
        };
      }

      return {
        available: true,
        data: parsed,
        raw: completion.text,
        aiCallId: rec.aiCallId,
        model,
        provider,
        attempts,
      };
    } catch (err) {
      const status = classifyFailure(err);
      const rec = await recordAiCall({
        ...attribution,
        provider,
        model,
        latencyMs: Date.now() - startedAt,
        status,
        errorCode: err instanceof Error ? err.name : null,
      });
      attempts.push({ provider, model, status, aiCallId: rec.aiCallId });
      lastReason = err instanceof Error ? err.message : String(err);

      // The shared policy decides, not a second copy of it here.
      provider = shouldFallbackToGemini(provider, err) ? 'gemini' : null;
    }
  }

  return {
    available: false,
    data: null,
    raw: null,
    aiCallId: attempts[attempts.length - 1]?.aiCallId ?? null,
    reason: lastReason,
    attempts,
  };
}

interface Completion {
  text: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

async function completeWithGroq(
  input: GenerateStructuredInput,
  model: string
): Promise<Completion> {
  const groq = createGroqClient();

  const response = await groq.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: input.systemPrompt },
      { role: 'user', content: input.userPrompt },
    ],
    max_tokens: input.maxOutputTokens ?? 1200,
    temperature: 0.4,
    response_format: { type: 'json_object' },
  });

  return {
    text: response.choices?.[0]?.message?.content ?? '',
    promptTokens: response.usage?.prompt_tokens ?? null,
    completionTokens: response.usage?.completion_tokens ?? null,
    totalTokens: response.usage?.total_tokens ?? null,
  };
}

async function completeWithGemini(
  input: GenerateStructuredInput,
  model: string
): Promise<Completion> {
  const generative = createGeminiClient().getGenerativeModel({
    model,
    systemInstruction: input.systemPrompt,
    generationConfig: { responseMimeType: 'application/json' },
  });

  const result = await generative.generateContent(input.userPrompt);
  const usage = result.response.usageMetadata;

  return {
    text: result.response.text(),
    promptTokens: usage?.promptTokenCount ?? null,
    completionTokens: usage?.candidatesTokenCount ?? null,
    totalTokens: usage?.totalTokenCount ?? null,
  };
}

/**
 * Parse defensively.
 *
 * Models wrap JSON in prose and fences often enough that a bare `JSON.parse` on the raw text
 * discards usable output. This extracts the first balanced object/array and hands it to the
 * caller's parser; anything the parser rejects, or that throws, becomes `null`.
 */
function safeParse<T>(text: string, parse: (raw: string) => T | null): T | null {
  if (!text?.trim()) return null;
  const candidates = [text, extractJson(text)].filter((value): value is string => !!value);
  for (const candidate of candidates) {
    try {
      const parsed = parse(candidate);
      if (parsed !== null && parsed !== undefined) return parsed;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function extractJson(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) return null;
  return body.slice(start, end + 1);
}
