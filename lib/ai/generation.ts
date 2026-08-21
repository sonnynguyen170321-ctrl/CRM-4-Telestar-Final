/**
 * Tool-less structured generation for background work.
 *
 * `AiGateway.streamWithTools` runs a conversation and its tool loop — the right shape for a
 * chat turn, the wrong one for a worker that wants one bounded completion and a parsed object.
 * This is that primitive, and it is a thin adapter: **provider selection, failover, budget,
 * circuit breaking and attribution all belong to the gateway**, which is the only module in the
 * codebase that constructs a provider client.
 *
 * This file used to own a second router. It selected Groq first, hard-coded
 * `llama-3.3-70b-versatile`, and fell back to Gemini only on a rate limit — so when Groq
 * withdrew that model every draft reply, briefing, enrichment, reply classification and
 * sequence draft in the product started failing with a 404 that no fallback caught. One router.
 *
 * ## Two attempts are two rows
 *
 * When one provider fails and the next succeeds, two provider operations happened. Both are
 * recorded through the single `recordAiCall` ledger by the gateway — the failed attempt under
 * its failure classification, the fallback as `ok`. Collapsing them would hide a provider's
 * reliability problem behind its replacement's success, and understate what the tenant's
 * traffic cost.
 *
 * ## It never throws
 *
 * A provider outage degrades the feature, not the caller. Every failure returns
 * `available: false` with a reason, and the caller falls back to what it does without AI. There
 * are no tools here, so a background generation cannot reach a CRM mutation by any path.
 */

import { aiGateway, GatewayError, type GatewayAttempt } from './gateway';
import { recordAiCall } from './usage';
import type { ModelId } from './models';
import type { RoutingCriteria } from './router';
import { CHAT_OUTPUT_BUDGET_TOKENS } from './registry';

export type AiProviderId = 'openai' | 'google' | 'groq';

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
  /** A specific approved model, or omitted to let the router choose. */
  modelId?: ModelId;
  maxOutputTokens?: number;
  /** Routing hints — complexity, latency sensitivity, capability requirements. */
  criteria?: Omit<RoutingCriteria, 'task' | 'preferredModel'>;
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
  return aiGateway.hasAnyProvider();
}

function toGenerationAttempts(attempts: GatewayAttempt[]): GenerationAttempt[] {
  return attempts.map((attempt) => ({
    provider: attempt.provider,
    model: attempt.model,
    status: attempt.status,
    aiCallId: attempt.aiCallId,
  }));
}

export async function generateStructured<T>(
  input: GenerateStructuredInput,
  parse: (raw: string) => T | null
): Promise<GenerationOutcome<T>> {
  if (!isGenerationAvailable()) {
    // Still attributable. "The AI did nothing because nothing was configured" is an operational
    // fact somebody has to be able to query for; a silent return would make a misconfigured
    // deployment indistinguishable from a quiet one.
    const record = await recordAiCall({
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      leadId: input.leadId ?? null,
      workOrderId: input.workOrderId ?? null,
      agentActionId: input.agentActionId ?? null,
      operation: input.operation,
      provider: 'openai',
      model: null,
      latencyMs: 0,
      status: 'unavailable',
      errorCode: 'NO_API_KEY',
    });

    return {
      available: false,
      data: null,
      raw: null,
      aiCallId: record.aiCallId,
      reason: 'no generation provider configured',
      attempts: [{ provider: 'openai', model: 'none', status: 'unavailable', aiCallId: record.aiCallId }],
    };
  }

  try {
    const result = await aiGateway.generate({
      messages: [{ role: 'user', content: input.userPrompt }],
      systemPrompt: input.systemPrompt,
      responseFormatJson: true,
      maxTokens: input.maxOutputTokens ?? CHAT_OUTPUT_BUDGET_TOKENS,
      temperature: 0.4,
      operation: input.operation,
      leadId: input.leadId ?? undefined,
      workOrderId: input.workOrderId ?? undefined,
      preferredModel: input.modelId,
      criteria: {
        ...input.criteria,
        task: input.operation,
        requiresStructuredOutput: true,
      },
      attribution: {
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        agentActionId: input.agentActionId ?? null,
      },
    });

    const attempts = toGenerationAttempts(result.attempts);
    const parsed = safeParse(result.content, parse);

    if (parsed === null) {
      // The provider answered; the answer was unusable. Not a provider fault, so no retry —
      // another model would be just as free to return prose.
      return {
        available: false,
        data: null,
        raw: result.content,
        aiCallId: result.aiCallId,
        reason: 'generation could not be parsed into the expected shape',
        model: result.modelId,
        provider: result.provider,
        attempts,
      };
    }

    return {
      available: true,
      data: parsed,
      raw: result.content,
      aiCallId: result.aiCallId,
      model: result.modelId,
      provider: result.provider,
      attempts,
    };
  } catch (err) {
    const attempts = err instanceof GatewayError ? toGenerationAttempts(err.attempts) : [];
    return {
      available: false,
      data: null,
      raw: null,
      aiCallId: attempts[attempts.length - 1]?.aiCallId ?? null,
      reason: err instanceof Error ? err.message : String(err),
      attempts,
    };
  }
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
