import { crawlCompanySite } from '@telestar/core-intel/crawlCompanySite';
import type { FetchStatus } from '@telestar/core-intel/fetchWebsite';
import { IDENTITY_PAGE_TYPES, identityText, type RawPageInput } from '@telestar/core-intel/reasoning/pageModel';

import { recordingFetch, type SearchAccounting } from '@/lib/research/searchGateway';

/**
 * The few pages of a company's own site that say what the company is — homepage, about, product,
 * services — for classifying a research candidate whose search snippet was too thin (2026-10-08).
 *
 * Deliberately small: three pages, four attempts, 1.5 MB, 8 s per request. `runCompanyResearch` crawls a
 * dozen pages and runs paid searches per company; this is a check, not an enrichment. The crawl goes
 * through `safeFetch` (private addresses refused on every redirect hop) and robots.txt, and every
 * request is written to ResearchProviderAttempt under stage `verify` so the spend is visible.
 *
 * Returned as plain text pages (`buildClassificationBundle` re-reads them), carrying the descriptive
 * parts — title, meta and headings — ahead of the body, since that is where a company says what it is.
 */
export async function fetchIdentityPages(
  domain: string,
  accounting: SearchAccounting,
  deps: { crawl?: typeof crawlCompanySite } = {}
): Promise<{ status: FetchStatus; pages: RawPageInput[]; errorCode: string | null }> {
  const crawl = deps.crawl ?? crawlCompanySite;
  const result = await crawl({
    canonicalDomain: domain,
    maxPages: 3,
    maxAttempts: 4,
    timeoutMs: 8000,
    maxTotalBytes: 1_500_000,
    fetchImpl: recordingFetch({ ...accounting, stage: 'verify' }),
  });
  return {
    status: result.status,
    pages: result.pages
      .filter((page) => IDENTITY_PAGE_TYPES.has(page.pageType))
      .map((page) => ({ url: page.url, path: page.path, text: [page.title, identityText(page)].filter(Boolean).join(' | ') })),
    errorCode: result.errorCode,
  };
}
