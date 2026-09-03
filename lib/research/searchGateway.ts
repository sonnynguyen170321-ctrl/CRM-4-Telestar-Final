import { searchDepsFromEnv, type SearchDeps } from '@telestar/core-search/search/companyIntelSearch';

import { prisma } from '@/lib/prisma';

// Search for the CRM, with every provider call accounted for.
//
// `@telestar/core-search` takes a `fetchImpl`, which is the seam: the package stays free of any
// database or tenant concept, and this wraps it so each call lands in `ResearchProviderAttempt`.
// Search is paid per query across exa, brave and serper, so "which provider did we ask, did it
// answer, how long did it take" has to be inspectable rather than reconstructed from an invoice.
//
// It records rather than routing through `lib/ai/gateway`: `recordAiCall` has a fixed provider union
// (openai, groq, gemini, google, tavily, jina) wired into token pricing, and widening it for search
// engines that bill per query, not per token, would put two different cost models behind one number.

export type SearchAccounting = {
  tenantId: string;
  runId?: string | null;
  candidateId?: string | null;
  /** Which part of the pipeline is spending: "discovery", "enrich", "verify". */
  stage: string;
};

/**
 * Wraps `fetch` so every provider request is timed and persisted.
 *
 * Failures are recorded and re-thrown, never swallowed: the provider chain upstream needs the throw
 * to fall through to the next provider, and a silent failure would make a dead API key look like a
 * search that legitimately found nothing.
 */
export function recordingFetch(accounting: SearchAccounting, base: typeof fetch = fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const provider = providerFromUrl(url);
    const startedAt = new Date();

    const write = (status: string, errorMessage?: string) =>
      prisma.researchProviderAttempt
        .create({
          data: {
            tenantId: accounting.tenantId,
            runId: accounting.runId ?? null,
            candidateId: accounting.candidateId ?? null,
            stage: accounting.stage,
            provider,
            status,
            requestJson: { url: redact(url) } as never,
            errorMessage: errorMessage ?? null,
            startedAt,
            finishedAt: new Date(),
          },
        })
        // Accounting must never break the search it is measuring.
        .catch((error) => console.error('[research] failed to record provider attempt', error));

    try {
      const response = await base(input as never, init as never);
      await write(response.ok ? 'ok' : `http_${response.status}`);
      return response;
    } catch (error) {
      await write('error', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }) as typeof fetch;
}

/** Provider chain from the environment, with accounting attached. */
export function searchDepsFor(accounting: SearchAccounting): SearchDeps {
  return searchDepsFromEnv(process.env, recordingFetch(accounting));
}

const PROVIDER_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)exa\.ai$/i, 'exa'],
  [/(^|\.)search\.brave\.com$/i, 'brave'],
  [/(^|\.)google\.serper\.dev$/i, 'serper'],
  [/(^|\.)duckduckgo\.com$/i, 'ddg'],
];

function providerFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    for (const [pattern, name] of PROVIDER_HOSTS) {
      if (pattern.test(host)) return name;
    }
    // A self-hosted SearXNG has no fixed hostname, so anything unrecognised is recorded by host
    // rather than as "unknown" — an attempt nobody can attribute is not worth storing.
    return host;
  } catch {
    return 'unknown';
  }
}

/** API keys travel in query strings for some providers; the recorded URL must not carry them. */
function redact(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of [...parsed.searchParams.keys()]) {
      if (/key|token|secret|api/i.test(key)) parsed.searchParams.set(key, '***');
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
