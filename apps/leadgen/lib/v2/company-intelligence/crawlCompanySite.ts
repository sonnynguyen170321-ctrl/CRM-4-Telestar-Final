import { createHash } from "node:crypto";

import { buildFetchUrl } from "./canonicalDomain";
import {
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT_INTERVAL_MS,
  ENRICHMENT_USER_AGENT,
  MIN_VISIBLE_TEXT_BYTES,
  parseRobotsDisallowRules,
  type FetchStatus,
  type PageFetchRecord,
} from "./fetchWebsite";
import { extractPageModel, type PageModel, type PageType } from "./reasoning/pageModel";
import { safeFetch, type DnsLookup } from "./safeFetch";

const DEFAULT_MAX_PAGES = 12;
const DEFAULT_MAX_ATTEMPTS = 20;
const DEFAULT_MAX_PAGE_BYTES = 1_000_000;
const DEFAULT_MAX_TOTAL_BYTES = 6_000_000;
const ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];
const PAGE_PRIORITY: PageType[] = [
  "ABOUT", "TEAM", "LEADERSHIP", "PEOPLE", "PRODUCT", "PLATFORM", "SOLUTION", "SERVICE", "INDUSTRIES",
  "CUSTOMERS", "CASE_STUDY", "PARTNERS", "PRICING", "CAREERS", "JOBS",
  "NEWS", "PRESS", "BLOG", "CONTACT", "LOCATION", "SECURITY", "UNKNOWN",
];

export type CrawlCompanySiteInput = {
  canonicalDomain: string;
  fetchImpl?: typeof fetch;
  lookup?: DnsLookup;
  timeoutMs?: number;
  rateLimitIntervalMs?: number;
  maxPages?: number;
  maxAttempts?: number;
  maxPageBytes?: number;
  maxTotalBytes?: number;
  userAgent?: string;
};

export type CrawlCompanySiteResult = {
  status: FetchStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  redirectChainJson: string[];
  pagesFetchedJson: PageFetchRecord[];
  pages: PageModel[];
  rawTextHash: string | null;
  contentHash: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export async function crawlCompanySite(input: CrawlCompanySiteInput): Promise<CrawlCompanySiteResult> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const intervalMs = input.rateLimitIntervalMs ?? DEFAULT_RATE_LIMIT_INTERVAL_MS;
  const maxPages = input.maxPages ?? DEFAULT_MAX_PAGES;
  const maxAttempts = input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const maxPageBytes = input.maxPageBytes ?? DEFAULT_MAX_PAGE_BYTES;
  const maxTotalBytes = input.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const userAgent = input.userAgent ?? ENRICHMENT_USER_AGENT;
  const originUrl = buildFetchUrl(input.canonicalDomain, "/");
  const originHost = new URL(originUrl).hostname.toLowerCase();
  const records: PageFetchRecord[] = [];
  const pages: PageModel[] = [];
  const visited = new Set<string>();
  const seededUrls = seedCompanyCrawlUrls(input.canonicalDomain);
  const queued = new Set<string>(seededUrls.map(canonicalUrl));
  const queue = [...seededUrls];
  let attempts = 0;
  let totalBytes = 0;
  let homepageStatus: number | null = null;
  let homepageFinalUrl: string | null = null;
  let redirectChain: string[] = [];
  let robotsDisallowed: string[] = [];

  const robots = await requestText(buildFetchUrl(input.canonicalDomain, "/robots.txt"), {
    timeoutMs, maxBytes: 100_000, fetchImpl: input.fetchImpl,
    lookup: input.lookup ?? (input.fetchImpl ? async () => "93.184.216.34" : undefined), userAgent,
  });
  if (robots.ok && robots.status < 400) robotsDisallowed = parseRobotsDisallowRules(robots.text, userAgent);

  while (queue.length > 0 && pages.length < maxPages && attempts < maxAttempts && totalBytes < maxTotalBytes) {
    queue.sort((left, right) => rankLink(left) - rankLink(right) || left.localeCompare(right));
    const requestedUrl = queue.shift()!;
    const key = canonicalUrl(requestedUrl);
    if (visited.has(key)) continue;
    visited.add(key);
    attempts += 1;

    const requestedPath = new URL(requestedUrl).pathname;
    if (robotsDisallowed.some((rule) => rule && requestedPath.startsWith(rule))) continue;
    if (attempts > 1 && intervalMs > 0) await sleep(intervalMs);

    const remaining = Math.min(maxPageBytes, maxTotalBytes - totalBytes);
    const fetched = await requestText(requestedUrl, {
      timeoutMs, maxBytes: remaining, fetchImpl: input.fetchImpl,
      lookup: input.lookup ?? (input.fetchImpl ? async () => "93.184.216.34" : undefined), userAgent,
    });

    if (attempts === 1) {
      homepageStatus = fetched.ok ? fetched.status : null;
      homepageFinalUrl = fetched.ok ? fetched.finalUrl : null;
      redirectChain = fetched.ok ? fetched.redirectChain : [];
      if (!fetched.ok) return emptyResult(mapFailure(fetched.reason), fetched.reason, fetched.reason);
      if (fetched.status >= 400) return emptyResult(fetched.status === 403 ? "BLOCKED" : "OFFLINE", `HTTP_${fetched.status}`, `Homepage returned HTTP ${fetched.status}.`);
    }
    if (!fetched.ok || fetched.status >= 400) continue;

    const bytes = Buffer.byteLength(fetched.text, "utf8");
    totalBytes += bytes;
    records.push({ url: fetched.finalUrl, path: new URL(fetched.finalUrl).pathname, httpStatus: fetched.status, bytes });
    const model = extractPageModel({ url: fetched.finalUrl, html: fetched.text });
    pages.push(model);

    for (const link of model.internalLinks) {
      if (!sameCompanyHost(link, originHost)) continue;
      const normalized = canonicalUrl(link);
      if (visited.has(normalized) || queued.has(normalized) || !isCrawlable(link)) continue;
      queued.add(normalized);
      queue.push(link);
    }
  }

  const usefulBytes = pages.reduce((sum, page) => sum + Buffer.byteLength(page.mainText, "utf8"), 0);
  const joined = pages.map((page) => `${page.url}\n${page.mainText}`).join("\n");
  const status: FetchStatus = usefulBytes >= MIN_VISIBLE_TEXT_BYTES ? "SUCCESS" : pages.length > 0 ? "JS_RENDER_REQUIRED" : "OFFLINE";
  return {
    status,
    httpStatus: homepageStatus,
    finalUrl: homepageFinalUrl,
    redirectChainJson: redirectChain,
    pagesFetchedJson: records,
    pages,
    rawTextHash: joined ? hash(joined) : null,
    contentHash: joined ? hash(joined) : null,
    errorCode: status === "SUCCESS" ? null : status,
    errorMessage: status === "SUCCESS" ? null : "Website returned insufficient usable text.",
  };

  function emptyResult(status: FetchStatus, code: string, message: string): CrawlCompanySiteResult {
    return { status, httpStatus: homepageStatus, finalUrl: homepageFinalUrl, redirectChainJson: redirectChain,
      pagesFetchedJson: records, pages, rawTextHash: null, contentHash: null, errorCode: code, errorMessage: message };
  }
}

type TextResult =
  | { ok: true; status: number; finalUrl: string; redirectChain: string[]; text: string }
  | { ok: false; reason: string };

async function requestText(url: string, options: {
  timeoutMs: number; maxBytes: number; fetchImpl?: typeof fetch; lookup?: DnsLookup; userAgent: string;
}): Promise<TextResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const result = await safeFetch(url, { signal: controller.signal, headers: { "User-Agent": options.userAgent, Accept: "text/html,application/xhtml+xml,text/plain;q=0.5" } },
      { fetchImpl: options.fetchImpl, lookup: options.lookup });
    if (!result.ok) return { ok: false, reason: result.reason };
    const contentType = (result.response.headers?.get?.("content-type") ?? "").toLowerCase();
    if (contentType && !ALLOWED_CONTENT_TYPES.some((allowed) => contentType.includes(allowed)) && !contentType.includes("text/plain")) {
      return { ok: false, reason: "UNSUPPORTED_CONTENT_TYPE" };
    }
    const declared = Number(result.response.headers?.get?.("content-length") ?? 0);
    if (declared > options.maxBytes) return { ok: false, reason: "RESPONSE_TOO_LARGE" };
    const text = await readBoundedText(result.response, options.maxBytes);
    return { ok: true, status: result.status, finalUrl: result.finalUrl, redirectChain: result.redirectChain, text };
  } catch (error) {
    return { ok: false, reason: error instanceof Error && error.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("RESPONSE_TOO_LARGE");
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function seedCompanyCrawlUrls(canonicalDomain: string): string[] {
  return [
    "/",
    "/about",
    "/about-us",
    "/contact",
    "/team",
    "/leadership",
    "/people",
    "/security.txt",
    "/.well-known/security.txt",
  ].map((path) => buildFetchUrl(canonicalDomain, path));
}

function sameCompanyHost(rawUrl: string, originHost: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === originHost || host.endsWith(`.${originHost}`) || originHost.endsWith(`.${host}`);
  } catch { return false; }
}

function isCrawlable(rawUrl: string): boolean {
  const path = new URL(rawUrl).pathname.toLowerCase();
  return !/\.(pdf|zip|png|jpe?g|gif|svg|webp|mp4|mp3|docx?|xlsx?|pptx?)$/.test(path);
}

function canonicalUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return url.toString().toLowerCase();
}

function rankLink(rawUrl: string): number {
  const url = new URL(rawUrl);
  if (url.pathname === "/" || url.pathname === "") return -100;
  const type = extractPageModel({ url: rawUrl, text: "" }).pageType;
  const index = PAGE_PRIORITY.indexOf(type);
  return (index < 0 ? PAGE_PRIORITY.length : index) * 100 + url.pathname.split("/").filter(Boolean).length;
}

function mapFailure(reason: string): FetchStatus {
  if (reason === "TIMEOUT") return "TIMEOUT";
  if (reason.includes("PRIVATE") || reason.includes("LOCAL") || reason.includes("BLOCK")) return "BLOCKED";
  return "OFFLINE";
}

function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
