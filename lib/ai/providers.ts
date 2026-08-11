import { recordAiCall } from './usage';
import type { ToolContext } from './tools';

export interface ProviderResult {
  success: boolean;
  data: string;
  aiCallId: string | null;
  status: 'ok' | 'error' | 'unavailable' | 'refused';
  sources?: { url: string; title: string; content: string }[];
  /**
   * Whether the same call is worth attempting again. Callers turn this into a
   * `RetryableResearchError`, which reaches the existing Agent/BullMQ retry boundary —
   * a permanent failure must never take that path or the job retries three times to
   * fail identically.
   */
  retryable: boolean;
}

/**
 * Classifies an HTTP status from a provider.
 *
 * Retryable: 429 (rate limited) and transient 5xx. Everything else — a missing or rejected
 * key, a malformed request — is permanent and retrying it only burns the retry budget.
 */
export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Classifies a thrown fetch failure. Network faults, DNS failures and the 15s
 * `AbortSignal.timeout` are transient; anything else is treated as permanent.
 */
export function isRetryableTransportError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket hang up|network|fetch failed/i.test(
    msg
  );
}

/**
 * Low-level Tavily search provider primitive.
 * Records attributable AiCall and returns strict result status.
 */
export async function performTavilySearch(
  query: string,
  ctx: ToolContext
): Promise<ProviderResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    await recordAiCall({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: ctx.leadId ?? null,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      operation: ctx.operation ?? 'research',
      provider: 'tavily',
      searchCredits: 0,
      latencyMs: 0,
      status: 'unavailable',
      errorCode: 'NO_API_KEY',
    });
    // Missing configuration is permanent: no number of retries produces a key.
    return { success: false, data: '', aiCallId: null, status: 'unavailable', retryable: false };
  }

  const startedAt = Date.now();

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 4,
        include_answer: true,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const rec = await recordAiCall({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        leadId: ctx.leadId ?? null,
        workOrderId: ctx.workOrderId ?? null,
        agentActionId: ctx.agentActionId ?? null,
        operation: ctx.operation ?? 'research',
        provider: 'tavily',
        searchCredits: 1,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorCode: String(res.status),
      });
      return {
        success: false,
        data: '',
        aiCallId: rec.aiCallId,
        status: 'error',
        retryable: isRetryableHttpStatus(res.status),
      };
    }

    const data = await res.json();
    const rec = await recordAiCall({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: ctx.leadId ?? null,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      operation: ctx.operation ?? 'research',
      provider: 'tavily',
      searchCredits: 1,
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });

    const sources = data.results
      ?.slice(0, 4)
      .map((r: { title: string; url: string; content: string }) => ({
        url: r.url,
        title: r.title,
        content: r.content,
      })) || [];

    const results = sources
      .map((s: { title: string; url: string; content: string }) => `[${s.title}](${s.url})\n${s.content?.slice(0, 300)}`)
      .join('\n\n');

    const summaryText = data.answer ? `Summary: ${data.answer}\n\n${results}` : results || '';

    return {
      success: !!summaryText,
      data: summaryText,
      aiCallId: rec.aiCallId,
      status: summaryText ? 'ok' : 'error',
      sources,
      // A 200 with nothing in it is an answer, not a fault. Retrying returns the same nothing.
      retryable: false,
    };
  } catch (err) {
    const rec = await recordAiCall({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: ctx.leadId ?? null,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      operation: ctx.operation ?? 'research',
      provider: 'tavily',
      searchCredits: 1,
      latencyMs: Date.now() - startedAt,
      status: 'unavailable',
      errorCode: err instanceof Error ? err.name : undefined,
    });
    return {
      success: false,
      data: '',
      aiCallId: rec.aiCallId,
      status: 'unavailable',
      retryable: isRetryableTransportError(err),
    };
  }
}

/**
 * Low-level Jina page fetch provider primitive.
 * Records attributable AiCall and returns strict result status.
 */
export async function performJinaFetch(
  url: string,
  ctx: ToolContext
): Promise<ProviderResult> {
  if (!url.startsWith('https://') && !url.startsWith('http://')) {
    // Invalid argument — permanent.
    return { success: false, data: '', aiCallId: null, status: 'error', retryable: false };
  }

  const startedAt = Date.now();

  try {
    const jinaUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(jinaUrl, {
      headers: {
        Accept: 'text/plain',
        'X-Return-Format': 'markdown',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const rec = await recordAiCall({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        leadId: ctx.leadId ?? null,
        workOrderId: ctx.workOrderId ?? null,
        agentActionId: ctx.agentActionId ?? null,
        operation: ctx.operation ?? 'research',
        provider: 'jina',
        searchCredits: 1,
        latencyMs: Date.now() - startedAt,
        status: 'error',
        errorCode: String(res.status),
      });
      return {
        success: false,
        data: '',
        aiCallId: rec.aiCallId,
        status: 'error',
        retryable: isRetryableHttpStatus(res.status),
      };
    }

    const text = await res.text();
    const rec = await recordAiCall({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: ctx.leadId ?? null,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      operation: ctx.operation ?? 'research',
      provider: 'jina',
      searchCredits: 1,
      latencyMs: Date.now() - startedAt,
      status: 'ok',
    });

    const trimmed = text.slice(0, 3000);
    return {
      success: !!trimmed,
      data: trimmed,
      aiCallId: rec.aiCallId,
      status: trimmed ? 'ok' : 'error',
      retryable: false,
    };
  } catch (err) {
    const rec = await recordAiCall({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      leadId: ctx.leadId ?? null,
      workOrderId: ctx.workOrderId ?? null,
      agentActionId: ctx.agentActionId ?? null,
      operation: ctx.operation ?? 'research',
      provider: 'jina',
      searchCredits: 1,
      latencyMs: Date.now() - startedAt,
      status: 'unavailable',
      errorCode: err instanceof Error ? err.name : undefined,
    });
    return {
      success: false,
      data: '',
      aiCallId: rec.aiCallId,
      status: 'unavailable',
      retryable: isRetryableTransportError(err),
    };
  }
}
