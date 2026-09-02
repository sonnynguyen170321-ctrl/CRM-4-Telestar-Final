import { createHash } from "node:crypto";
import { buildFetchUrl } from "./canonicalDomain";
import { assertSafePublicUrl } from "./urlSafety";
import type { FetchedPage } from "./extractFacts";

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
export const MIN_VISIBLE_TEXT_BYTES = 500;
export const DEFAULT_RATE_LIMIT_INTERVAL_MS = 500;

export const ENRICHMENT_USER_AGENT =
  "TeleStarV2EnrichmentBot/1.0 (+https://telestar.example/bot)";

// Default number of priority paths crawled per company (homepage + first N-1). Env-tunable
// via COMPANY_INTEL_MAX_CRAWL_PAGES; clamped to [1, PRIORITY_PATHS.length].
export const DEFAULT_MAX_CRAWL_PAGES = 6;
export function maxCrawlPages(): number {
  const n = Number(process.env.COMPANY_INTEL_MAX_CRAWL_PAGES);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_MAX_CRAWL_PAGES;
  return Math.min(Math.floor(n), PRIORITY_PATHS.length);
}

export const PRIORITY_PATHS = [
  "/",
  "/about",
  "/about-us",
  "/contact",
  "/pricing",
  "/product",
  "/products",
  "/solutions",
  "/careers",
  "/jobs",
  "/customers",
  "/case-studies",
  "/press",
  "/news",
] as const;

/**
 * Statuses recorded on V2CompanyResearchSnapshot. Mirrors prisma V2ResearchStatus.
 */
export type FetchStatus =
  | "SUCCESS"
  | "NO_WEBSITE"
  | "OFFLINE"
  | "BLOCKED"
  | "TIMEOUT"
  | "JS_RENDER_REQUIRED"
  | "PARTIAL"
  | "INVALID_URL"
  | "PARKED"
  | "NOT_RUN";

export type PageFetchRecord = {
  url: string;
  path: string;
  httpStatus: number | null;
  bytes: number;
};

export type FetchPagesResult = {
  status: FetchStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChainJson: string[];
  pagesFetchedJson: PageFetchRecord[];
  pages: FetchedPage[];
  rawTextHash: string | null;
  contentHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type FetchImpl = typeof fetch;

export type FetchCompanyPagesInput = {
  canonicalDomain: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
  userAgent?: string;
  rateLimitIntervalMs?: number;
  paths?: readonly string[];
};

const PARKED_DOMAIN_PATTERNS = [
  /this domain is for sale/i,
  /buy this domain/i,
  /domain (?:may be |is )?for sale/i,
  /this domain is parked/i,
  /related searches/i,
  /godaddy\.com\/domains/i,
];

const rateLimitState = new Map<string, number>();

/**
 * Fetches the configured priority paths for a canonical domain, respecting
 * robots.txt and a per-domain rate limit, and derives an overall FetchStatus.
 */
// Domain-dedup cache: the crawl is domain-pure (same public site => same pages), and dirty
// upload lists repeat domains heavily. Cache the result per canonical domain for a short TTL so
// repeats in a batch skip the whole multi-page crawl. Only for the real network path (skip when
// a test injects fetchImpl/paths). Env: COMPANY_INTEL_DOMAIN_CACHE_TTL_MS (0 disables).
type CrawlCacheEntry = { at: number; result: FetchPagesResult };
const crawlCache = new Map<string, CrawlCacheEntry>();
function domainCacheTtlMs(): number {
  const n = Number(process.env.COMPANY_INTEL_DOMAIN_CACHE_TTL_MS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 600_000; // 10 min
}

export async function fetchCompanyPages(
  input: FetchCompanyPagesInput
): Promise<FetchPagesResult> {
  const ttl = domainCacheTtlMs();
  const cacheable = ttl > 0 && !input.fetchImpl && !input.paths && !!input.canonicalDomain;
  const cacheKey = cacheable ? `${input.canonicalDomain}::${maxCrawlPages()}` : "";
  if (cacheable) {
    const hit = crawlCache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttl) return hit.result;
  }
  const result = await fetchCompanyPagesUncached(input);
  if (cacheable) crawlCache.set(cacheKey, { at: Date.now(), result });
  return result;
}

async function fetchCompanyPagesUncached(
  input: FetchCompanyPagesInput
): Promise<FetchPagesResult> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const userAgent = input.userAgent ?? ENRICHMENT_USER_AGENT;
  const rateLimitIntervalMs =
    input.rateLimitIntervalMs ?? DEFAULT_RATE_LIMIT_INTERVAL_MS;
  // Pages are crawled serially with a rate-limit gap, so the path count dominates per-company
  // latency. Cap the default set (env-tunable) to trade coverage for throughput on big batches.
  const paths = input.paths ?? PRIORITY_PATHS.slice(0, maxCrawlPages());

  const robots = await fetchRobotsRules(input.canonicalDomain, {
    fetchImpl,
    timeoutMs,
    userAgent,
    rateLimitIntervalMs,
  });

  if (isPathDisallowed("/", robots)) {
    return {
      status: "BLOCKED",
      httpStatus: null,
      finalUrl: null,
      redirectChainJson: [],
      pagesFetchedJson: [],
      pages: [],
      rawTextHash: null,
      contentHash: null,
      errorCode: "ROBOTS_DISALLOWED",
      errorMessage: "robots.txt disallows fetching the homepage for this user agent.",
    };
  }

  const homepageUrl = buildFetchUrl(input.canonicalDomain, "/");
  const homepage = await fetchSinglePage(homepageUrl, {
    fetchImpl,
    timeoutMs,
    userAgent,
    rateLimitIntervalMs,
    canonicalDomain: input.canonicalDomain,
  });

  if (homepage.kind === "timeout") {
    return {
      status: "TIMEOUT",
      httpStatus: null,
      finalUrl: null,
      redirectChainJson: [],
      pagesFetchedJson: [],
      pages: [],
      rawTextHash: null,
      contentHash: null,
      errorCode: "FETCH_TIMEOUT",
      errorMessage: `Timed out fetching ${homepageUrl} after ${timeoutMs}ms.`,
    };
  }

  if (homepage.kind === "network_error") {
    return {
      status: "OFFLINE",
      httpStatus: null,
      finalUrl: null,
      redirectChainJson: [],
      pagesFetchedJson: [],
      pages: [],
      rawTextHash: null,
      contentHash: null,
      errorCode: "NETWORK_ERROR",
      errorMessage: homepage.message,
    };
  }

  if (homepage.httpStatus === 403) {
    return {
      status: "BLOCKED",
      httpStatus: homepage.httpStatus,
      finalUrl: homepage.finalUrl,
      redirectChainJson: homepage.redirectChain,
      pagesFetchedJson: [
        { url: homepageUrl, path: "/", httpStatus: homepage.httpStatus, bytes: 0 },
      ],
      pages: [],
      rawTextHash: null,
      contentHash: null,
      errorCode: "HTTP_403",
      errorMessage: "Homepage responded with HTTP 403 Forbidden.",
    };
  }

  const pagesFetchedJson: PageFetchRecord[] = [];
  const successfulPages: FetchedPage[] = [];

  if (homepage.httpStatus >= 200 && homepage.httpStatus < 300) {
    pagesFetchedJson.push({
      url: homepageUrl,
      path: "/",
      httpStatus: homepage.httpStatus,
      bytes: byteLength(homepage.text),
    });
    successfulPages.push({ url: homepage.finalUrl, path: "/", text: homepage.text });
  } else {
    pagesFetchedJson.push({
      url: homepageUrl,
      path: "/",
      httpStatus: homepage.httpStatus,
      bytes: 0,
    });
  }

  for (const path of paths) {
    if (path === "/") {
      continue;
    }

    if (isPathDisallowed(path, robots)) {
      continue;
    }

    const pageUrl = buildFetchUrl(input.canonicalDomain, path);
    const page = await fetchSinglePage(pageUrl, {
      fetchImpl,
      timeoutMs,
      userAgent,
      rateLimitIntervalMs,
      canonicalDomain: input.canonicalDomain,
    });

    if (page.kind === "timeout" || page.kind === "network_error") {
      pagesFetchedJson.push({ url: pageUrl, path, httpStatus: null, bytes: 0 });
      continue;
    }

    if (page.httpStatus >= 200 && page.httpStatus < 300) {
      pagesFetchedJson.push({
        url: pageUrl,
        path,
        httpStatus: page.httpStatus,
        bytes: byteLength(page.text),
      });
      successfulPages.push({ url: page.finalUrl, path, text: page.text });
    } else {
      pagesFetchedJson.push({ url: pageUrl, path, httpStatus: page.httpStatus, bytes: 0 });
    }
  }

  const totalBytes = successfulPages.reduce(
    (sum, page) => sum + byteLength(page.text),
    0
  );
  const homepageReachable = homepage.httpStatus >= 200 && homepage.httpStatus < 300;

  if (
    homepageReachable &&
    PARKED_DOMAIN_PATTERNS.some((pattern) => pattern.test(homepage.text))
  ) {
    return {
      status: "PARKED",
      httpStatus: homepage.httpStatus,
      finalUrl: homepage.finalUrl,
      redirectChainJson: homepage.redirectChain,
      pagesFetchedJson,
      pages: [],
      rawTextHash: null,
      contentHash: null,
      errorCode: "PARKED_DOMAIN",
      errorMessage: "Homepage content matches known parked-domain patterns.",
    };
  }

  if (successfulPages.length === 0) {
    return {
      status: "PARTIAL",
      httpStatus: homepage.httpStatus,
      finalUrl: homepage.finalUrl,
      redirectChainJson: homepage.redirectChain,
      pagesFetchedJson,
      pages: [],
      rawTextHash: null,
      contentHash: null,
      errorCode: "NO_REACHABLE_PAGES",
      errorMessage: "No priority pages returned a 2xx response with content.",
    };
  }

  const combinedText = successfulPages.map((page) => page.text).join("\n");
  const rawTextHash = hashText(combinedText);
  const contentHash = hashText(JSON.stringify(pagesFetchedJson));

  if (totalBytes < MIN_VISIBLE_TEXT_BYTES) {
    return {
      status: "JS_RENDER_REQUIRED",
      httpStatus: homepage.httpStatus,
      finalUrl: homepage.finalUrl,
      redirectChainJson: homepage.redirectChain,
      pagesFetchedJson,
      pages: successfulPages,
      rawTextHash,
      contentHash,
      errorCode: "INSUFFICIENT_VISIBLE_TEXT",
      errorMessage: `Visible text was ${totalBytes} bytes, below the ${MIN_VISIBLE_TEXT_BYTES}-byte threshold.`,
    };
  }

  if (!homepageReachable) {
    return {
      status: "PARTIAL",
      httpStatus: homepage.httpStatus,
      finalUrl: homepage.finalUrl,
      redirectChainJson: homepage.redirectChain,
      pagesFetchedJson,
      pages: successfulPages,
      rawTextHash,
      contentHash,
      errorCode: "HOMEPAGE_UNREACHABLE",
      errorMessage: `Homepage responded with HTTP ${homepage.httpStatus}, but other priority pages returned content.`,
    };
  }

  return {
    status: "SUCCESS",
    httpStatus: homepage.httpStatus,
    finalUrl: homepage.finalUrl,
    redirectChainJson: homepage.redirectChain,
    pagesFetchedJson,
    pages: successfulPages,
    rawTextHash,
    contentHash,
    errorCode: null,
    errorMessage: null,
  };
}

type SinglePageFetchResult =
  | {
      kind: "ok";
      httpStatus: number;
      finalUrl: string;
      redirectChain: string[];
      text: string;
    }
  | { kind: "timeout" }
  | { kind: "network_error"; message: string };

async function fetchSinglePage(
  url: string,
  options: {
    fetchImpl: FetchImpl;
    timeoutMs: number;
    userAgent: string;
    rateLimitIntervalMs: number;
    canonicalDomain: string;
    preserveText?: boolean;
  }
): Promise<SinglePageFetchResult> {
  // SSRF structural guard: block non-http(s), credentials, localhost + private/
  // reserved IP literals before the request. (Per-hop DNS-resolved-IP checks live in
  // safeFetch, used by the CINT3 real-link crawler.)
  const preCheck = assertSafePublicUrl(url);
  if (!preCheck.ok) {
    return { kind: "network_error", message: `SSRF_BLOCKED:${preCheck.reason}` };
  }

  await waitForRateLimit(options.canonicalDomain, options.rateLimitIntervalMs);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await options.fetchImpl(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": options.userAgent },
    });

    // A followed redirect may have landed on a private/blocked host.
    if (response.url && response.url !== url && !assertSafePublicUrl(response.url).ok) {
      return { kind: "network_error", message: "SSRF_BLOCKED:redirect_to_blocked_host" };
    }

    const responseText = await response.text();
    const text = options.preserveText
      ? responseText
      : extractVisibleText(responseText);
    const redirectChain = buildRedirectChain(url, response.url);

    return {
      kind: "ok",
      httpStatus: response.status,
      finalUrl: response.url || url,
      redirectChain,
      text,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { kind: "timeout" };
    }

    return {
      kind: "network_error",
      message: error instanceof Error ? error.message : "Unknown network error.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildRedirectChain(requestedUrl: string, finalUrl: string): string[] {
  if (!finalUrl || finalUrl === requestedUrl) {
    return [];
  }

  return [requestedUrl, finalUrl];
}

async function waitForRateLimit(domain: string, intervalMs: number): Promise<void> {
  if (intervalMs <= 0) {
    return;
  }

  const now = Date.now();
  const lastRequestAt = rateLimitState.get(domain) ?? 0;
  const elapsed = now - lastRequestAt;

  if (elapsed < intervalMs) {
    await sleep(intervalMs - elapsed);
  }

  rateLimitState.set(domain, Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type RobotsRules = {
  disallowedPaths: string[];
};

async function fetchRobotsRules(
  canonicalDomain: string,
  options: {
    fetchImpl: FetchImpl;
    timeoutMs: number;
    userAgent: string;
    rateLimitIntervalMs: number;
  }
): Promise<RobotsRules> {
  const robotsUrl = buildFetchUrl(canonicalDomain, "/robots.txt");
  const result = await fetchSinglePage(robotsUrl, {
    ...options,
    canonicalDomain,
    preserveText: true,
  });

  if (result.kind !== "ok" || result.httpStatus >= 400) {
    return { disallowedPaths: [] };
  }

  return { disallowedPaths: parseRobotsDisallowRules(result.text, options.userAgent) };
}

/**
 * Parses robots.txt for the most specific applicable user-agent group
 * (exact match, else "*"), returning its Disallow path prefixes.
 */
export function parseRobotsDisallowRules(robotsText: string, userAgent: string): string[] {
  const lines = robotsText.split(/\r?\n/).map((line) => line.replace(/#.*$/, "").trim());
  const groups: Array<{ agents: string[]; disallow: string[] }> = [];
  let currentGroup: { agents: string[]; disallow: string[] } | null = null;

  for (const line of lines) {
    if (!line) {
      continue;
    }

    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (!currentGroup || currentGroup.disallow.length > 0) {
        currentGroup = { agents: [value], disallow: [] };
        groups.push(currentGroup);
      } else {
        currentGroup.agents.push(value);
      }
    } else if (key === "disallow" && currentGroup) {
      if (value) {
        currentGroup.disallow.push(value);
      }
    }
  }

  const lowerUserAgent = userAgent.toLowerCase();
  const specificGroup = groups.find((group) =>
    group.agents.some(
      (agent) => agent !== "*" && lowerUserAgent.includes(agent.toLowerCase())
    )
  );
  const wildcardGroup = groups.find((group) => group.agents.includes("*"));

  return specificGroup?.disallow ?? wildcardGroup?.disallow ?? [];
}

function isPathDisallowed(path: string, robots: RobotsRules): boolean {
  return robots.disallowedPaths.some(
    (disallowed) => disallowed !== "" && path.startsWith(disallowed)
  );
}

/**
 * Strips <script>/<style> blocks and tags, decodes common HTML entities, and
 * collapses whitespace to produce visible-text-only content.
 */
export function extractVisibleText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
