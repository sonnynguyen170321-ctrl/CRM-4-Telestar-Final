import { prisma } from '@/lib/prisma';
import { estimateTokenCost, estimateCallCost } from './pricing';

/**
 * AI usage recording (Revenue AI Phase 1).
 *
 * The only writer of `AiCall`. Two rules hold this together, and both are about what
 * *cannot* happen:
 *
 *   1. Recording never throws into the caller. Accounting is not worth failing an SDR's
 *      question over, and `usage.ts` sits inside the AI request path.
 *   2. Nothing in the CRM imports this module. It records AI spend; it is not a general
 *      metrics facility. `tests/ai-optional.test.ts` asserts the CRM's independence from
 *      the whole `lib/ai` tree, this file included.
 */

export type AiProvider = 'groq' | 'gemini' | 'tavily' | 'jina';
export type AiCallStatus = 'ok' | 'error' | 'rate_limited' | 'unavailable';

export interface AiCallRecord {
  /**
   * Undefined only from a call site not yet threaded for attribution. Such a call is
   * skipped rather than written under a placeholder: a row no tenant-scoped query can
   * return is worse than a visible gap, because it looks like data.
   */
  tenantId: string | undefined;
  userId?: string | null;
  leadId?: string | null;
  workOrderId?: string | null;
  agentActionId?: string | null;
  /** What the call was for: 'chat', 'briefing', 'research', 'draft_reply', … */
  operation: string;
  provider: AiProvider;
  /** Model id for LLM providers. Omitted for search/fetch. */
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  searchCredits?: number | null;
  latencyMs: number;
  status: AiCallStatus;
  errorCode?: string | null;
}

/**
 * Persist one provider round trip.
 *
 * Returns the estimated cost so a caller can accumulate against a budget without a
 * second query — `null` when the model or provider has no rate, which is a visible gap
 * rather than a fabricated number.
 */
export async function recordAiCall(record: AiCallRecord): Promise<number | null> {
  const estimatedCostUsd = estimateCost(record);

  if (!record.tenantId) {
    console.warn(`[ai/usage] unattributed ${record.provider} call (${record.operation}) — no tenant`);
    return estimatedCostUsd;
  }

  try {
    await prisma.aiCall.create({
      data: {
        tenantId: record.tenantId,
        userId: record.userId ?? null,
        leadId: record.leadId ?? null,
        workOrderId: record.workOrderId ?? null,
        agentActionId: record.agentActionId ?? null,
        operation: record.operation,
        provider: record.provider,
        model: record.model ?? null,
        promptTokens: record.promptTokens ?? null,
        completionTokens: record.completionTokens ?? null,
        totalTokens: record.totalTokens ?? null,
        searchCredits: record.searchCredits ?? null,
        latencyMs: record.latencyMs,
        estimatedCostUsd,
        status: record.status,
        errorCode: record.errorCode ?? null,
      },
    });
  } catch (err) {
    // Rule 1. A missing accounting row is a reporting gap; a thrown error here would be
    // a failed answer to a user who asked a question.
    console.error('[ai/usage] failed to record AiCall:', err);
  }

  return estimatedCostUsd;
}

function estimateCost(record: AiCallRecord): number | null {
  if (record.provider === 'tavily' || record.provider === 'jina') {
    return estimateCallCost(record.provider, record.searchCredits ?? 1);
  }
  if (!record.model) return null;
  return estimateTokenCost(record.model, record.promptTokens, record.completionTokens);
}

/**
 * Wrap a provider call so timing, outcome and usage are recorded whichever way it goes.
 *
 * A failed call still costs latency and still matters to whoever is asking why a work
 * order stalled, so the error path records a row and rethrows rather than swallowing.
 */
export async function withAiCallRecording<T>(
  base: Omit<AiCallRecord, 'latencyMs' | 'status' | 'promptTokens' | 'completionTokens' | 'totalTokens'>,
  fn: () => Promise<T>,
  extractUsage: (result: T) => {
    promptTokens?: number | null;
    completionTokens?: number | null;
    totalTokens?: number | null;
  }
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    await recordAiCall({
      ...base,
      ...extractUsage(result),
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });
    return result;
  } catch (err) {
    await recordAiCall({
      ...base,
      latencyMs: Date.now() - startedAt,
      status: classifyFailure(err),
      errorCode: errorCodeOf(err),
    });
    throw err;
  }
}

/** Rate limiting is the one failure worth separating: it is a budget signal, not a bug. */
export function classifyFailure(err: unknown): AiCallStatus {
  if ((err as { status?: number })?.status === 429) return 'rate_limited';
  const msg = err instanceof Error ? err.message : String(err);
  if (/rate.?limit|\b429\b|tokens per day|\bTPD\b|quota/i.test(msg)) return 'rate_limited';
  if (/not configured|missing api key|ENOTFOUND|ECONNREFUSED/i.test(msg)) return 'unavailable';
  return 'error';
}

function errorCodeOf(err: unknown): string | null {
  const status = (err as { status?: number })?.status;
  if (typeof status === 'number') return String(status);
  if (err instanceof Error) return err.name || null;
  return null;
}
