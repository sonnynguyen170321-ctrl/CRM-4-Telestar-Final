import type { EvidenceSufficiency, NormalizedSearchResult } from "./types";

// CINT1: deterministic "usable evidence" scoring + sufficiency. Decides when the
// provider chain has enough to stop (no "double-check" fallback) vs must fall back.
// Pure. Scoring (Codex contract):
//   official-domain result            +4
//   about/product/service/customer    +2
//   meaningful snippet/highlight      +1
//   social / directory / noise        reject (not usable)
//   sufficient = >=2 unique usable results AND total score >= 5

const SOCIAL_NOISE_DOMAINS = [
  "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
  "pinterest.com", "tiktok.com", "reddit.com", "medium.com",
];
const DIRECTORY_NOISE_DOMAINS = [
  "yelp.com", "yellowpages.com", "glassdoor.com", "indeed.com",
  "zoominfo.com", "dnb.com", "bloomberg.com/profile", "wikipedia.org",
];

export type SearchResultPageType =
  | "HOMEPAGE" | "ABOUT" | "PRODUCT" | "SERVICE" | "CUSTOMERS"
  | "PRICING" | "CAREERS" | "NEWS" | "OTHER";

export type ScoredSearchResult = {
  result: NormalizedSearchResult;
  usable: boolean;
  score: number;
  pageType: SearchResultPageType;
  isOfficialDomain: boolean;
  rejectReason: string | null;
};

export type UsabilityContext = { canonicalDomain?: string | null };

function domainOf(result: NormalizedSearchResult): string | null {
  if (result.sourceDomain) return result.sourceDomain.toLowerCase().replace(/^www\./, "");
  try {
    return new URL(result.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function classifyPageType(url: string): SearchResultPageType {
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return "OTHER";
  }
  if (path === "" || path === "/") return "HOMEPAGE";
  if (/\/(about|company|who-we-are)/.test(path)) return "ABOUT";
  if (/\/(product|products|platform|solution|solutions)/.test(path)) return "PRODUCT";
  if (/\/(service|services)/.test(path)) return "SERVICE";
  if (/\/(customer|customers|clients|case-stud|case_stud|success)/.test(path)) return "CUSTOMERS";
  if (/\/(pricing|plans)/.test(path)) return "PRICING";
  if (/\/(careers|jobs)/.test(path)) return "CAREERS";
  if (/\/(news|press|blog)/.test(path)) return "NEWS";
  return "OTHER";
}

function isNoiseDomain(domain: string | null): boolean {
  if (!domain) return true;
  return (
    SOCIAL_NOISE_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`)) ||
    DIRECTORY_NOISE_DOMAINS.some((d) => domain.includes(d))
  );
}

export function scoreSearchResult(
  result: NormalizedSearchResult,
  ctx: UsabilityContext = {}
): ScoredSearchResult {
  const domain = domainOf(result);
  const pageType = classifyPageType(result.url);

  if (!result.url || !result.title?.trim()) {
    return { result, usable: false, score: 0, pageType, isOfficialDomain: false, rejectReason: "empty_url_or_title" };
  }
  if (isNoiseDomain(domain)) {
    return { result, usable: false, score: 0, pageType, isOfficialDomain: false, rejectReason: "social_or_directory_noise" };
  }

  const canonical = ctx.canonicalDomain?.toLowerCase().replace(/^www\./, "") ?? null;
  const isOfficialDomain = Boolean(canonical && domain && (domain === canonical || domain.endsWith(`.${canonical}`)));

  let score = 0;
  if (isOfficialDomain) score += 4;
  if (pageType === "ABOUT" || pageType === "PRODUCT" || pageType === "SERVICE" || pageType === "CUSTOMERS") score += 2;
  const text = (result.highlight ?? result.snippet ?? "").trim();
  if (text.length >= 40) score += 1;

  // A result with no official-domain bonus, no informative pageType, and no
  // meaningful text carries no evidence value.
  const usable = score > 0;
  return {
    result,
    usable,
    score,
    pageType,
    isOfficialDomain,
    rejectReason: usable ? null : "no_evidence_value",
  };
}

export function scoreSearchResults(
  results: NormalizedSearchResult[],
  ctx: UsabilityContext = {}
): ScoredSearchResult[] {
  const seenUrls = new Set<string>();
  const out: ScoredSearchResult[] = [];
  for (const result of results) {
    const key = result.url.trim().toLowerCase().replace(/\/+$/, "");
    if (seenUrls.has(key)) continue; // dedupe identical URLs
    seenUrls.add(key);
    out.push(scoreSearchResult(result, ctx));
  }
  return out;
}

export function computeSufficiency(
  scored: ScoredSearchResult[],
  minUsableResults = 2
): EvidenceSufficiency {
  const usable = scored.filter((s) => s.usable);
  const totalScore = usable.reduce((sum, s) => sum + s.score, 0);
  const uniqueDomains = new Set(
    usable.map((s) => s.result.sourceDomain ?? safeDomain(s.result.url)).filter(Boolean)
  ).size;
  const sufficient = usable.length >= minUsableResults && totalScore >= 5;
  return { sufficient, usableCount: usable.length, totalScore, uniqueDomains };
}

function safeDomain(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
