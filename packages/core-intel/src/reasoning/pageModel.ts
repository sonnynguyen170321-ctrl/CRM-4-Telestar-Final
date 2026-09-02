import * as cheerio from "cheerio";

export type PageType =
  | "HOMEPAGE" | "ABOUT" | "PRODUCT" | "PLATFORM" | "SOLUTION" | "SERVICE"
  | "INDUSTRIES" | "CUSTOMERS" | "CASE_STUDY" | "PRICING" | "CAREERS" | "JOBS"
  | "NEWS" | "PRESS" | "BLOG" | "CONTACT" | "LOCATION" | "PARTNERS" | "TEAM"
  | "LEADERSHIP" | "PEOPLE" | "SECURITY" | "UNKNOWN";

// Which pages describe THE COMPANY, and which describe ITS AUDIENCE.
//
// The distinction decides what "what does this company do" may be inferred from. A crawl reaches up
// to 12 pages and deliberately includes INDUSTRIES / CUSTOMERS / CAREERS (see PAGE_PRIORITY in
// crawlCompanySite), all of which talk about other people's businesses. Reading them as self-
// description is what turned a job board into a food producer (its listings name F&B roles), a
// property developer into an HR platform (its careers pages), and a restaurant-marketing SaaS into a
// restaurant.
export const IDENTITY_PAGE_TYPES: ReadonlySet<PageType> = new Set<PageType>([
  "HOMEPAGE", "ABOUT", "PRODUCT", "PLATFORM", "SOLUTION", "SERVICE",
]);

export const AUDIENCE_PAGE_TYPES: ReadonlySet<PageType> = new Set<PageType>([
  "INDUSTRIES", "CUSTOMERS", "CASE_STUDY", "CAREERS", "JOBS", "PARTNERS", "BLOG", "NEWS", "PRESS",
]);

export type PageModel = {
  url: string;
  path: string;
  pageType: PageType;
  title: string | null;
  metaDescription: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  h1: string | null;
  h2s: string[];
  jsonLdDescriptions: string[];
  mainText: string;
  internalLinks: string[];
};

export type RawPageInput = {
  url: string;
  path?: string;
  html?: string | null;
  text?: string | null;
};

export function classifyPageType(path: string, title: string | null, text: string): PageType {
  const normalizedPath = path.toLowerCase();
  if (normalizedPath === "" || normalizedPath === "/") return "HOMEPAGE";
  const probe = `${normalizedPath} ${(title ?? "").toLowerCase()} ${text.slice(0, 120).toLowerCase()}`;
  const has = (pattern: RegExp) => pattern.test(probe);
  if (has(/about|who-we-are|company\b/)) return "ABOUT";
  if (has(/case-stud|case_stud|success-stor/)) return "CASE_STUDY";
  if (has(/customer|client/)) return "CUSTOMERS";
  if (has(/partner|integration|ecosystem/)) return "PARTNERS";
  if (has(/leadership|executive|management/)) return "LEADERSHIP";
  if (has(/team|people|our-people/)) return "TEAM";
  if (has(/security\.txt|security|responsible-disclosure/)) return "SECURITY";
  if (has(/platform/)) return "PLATFORM";
  if (has(/product/)) return "PRODUCT";
  if (has(/solution/)) return "SOLUTION";
  if (has(/service/)) return "SERVICE";
  if (has(/industr|use-case/)) return "INDUSTRIES";
  if (has(/pricing|plans/)) return "PRICING";
  if (has(/career/)) return "CAREERS";
  if (has(/jobs?\b/)) return "JOBS";
  if (has(/press/)) return "PRESS";
  if (has(/news/)) return "NEWS";
  if (has(/blog/)) return "BLOG";
  if (has(/contact/)) return "CONTACT";
  if (has(/location|offices?\b/)) return "LOCATION";
  return "UNKNOWN";
}

export function extractPageModel(raw: RawPageInput): PageModel {
  const path = pathOf(raw.url, raw.path);
  const html = raw.html?.trim() || null;

  if (!html) {
    const mainText = normalizeText(raw.text ?? "");
    return {
      url: raw.url,
      path,
      pageType: classifyPageType(path, null, mainText),
      title: null,
      metaDescription: null,
      ogTitle: null,
      ogDescription: null,
      h1: null,
      h2s: [],
      jsonLdDescriptions: [],
      mainText,
      internalLinks: [],
    };
  }

  const $ = cheerio.load(html);
  $("script:not([type='application/ld+json']), style, noscript, template, svg").remove();
  const title = clean($("title").first().text());
  const metaDescription = clean($("meta[name='description']").first().attr("content"));
  const ogTitle = clean($("meta[property='og:title']").first().attr("content"));
  const ogDescription = clean($("meta[property='og:description']").first().attr("content"));
  const h1 = clean($("h1").first().text());
  const h2s = unique(
    $("h2")
      .slice(0, 8)
      .map((_, element) => clean($(element).text()))
      .get()
      .filter((value): value is string => Boolean(value))
  );
  const descriptions = extractJsonLdDescriptions($);
  $("script[type='application/ld+json']").remove();
  const mainSelection = $("main, article, [role='main']").first();
  const mainText = normalizeText(
    raw.text ?? (mainSelection.length > 0 ? mainSelection.text() : $("body").text())
  );
  const internalLinks = unique(
    $("a[href]")
      .map((_, element) => resolveLink($(element).attr("href"), raw.url))
      .get()
      .filter((value): value is string => Boolean(value))
  );

  return {
    url: raw.url,
    path,
    pageType: classifyPageType(path, title ?? ogTitle, `${h1 ?? ""} ${mainText}`),
    title: title ?? ogTitle,
    metaDescription: metaDescription ?? ogDescription,
    ogTitle,
    ogDescription,
    h1,
    h2s,
    jsonLdDescriptions: descriptions,
    mainText,
    internalLinks,
  };
}

export function identityText(model: PageModel): string {
  return [
    model.metaDescription,
    model.ogDescription,
    model.h1,
    ...model.jsonLdDescriptions,
    ...model.h2s,
    model.mainText.slice(0, 600),
  ]
    .filter(Boolean)
    .join(" | ");
}

function extractJsonLdDescriptions($: cheerio.CheerioAPI): string[] {
  const descriptions: string[] = [];
  $("script[type='application/ld+json']").each((_, element) => {
    try {
      collectDescriptions(JSON.parse($(element).text()), descriptions);
    } catch {
      // Malformed JSON-LD is advisory and must not fail enrichment.
    }
  });
  return unique(descriptions.map(clean).filter((value): value is string => Boolean(value))).slice(0, 5);
}

function collectDescriptions(node: unknown, output: string[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectDescriptions(item, output));
    return;
  }
  const record = node as Record<string, unknown>;
  if (typeof record.description === "string") output.push(record.description);
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") collectDescriptions(value, output);
  }
}

function resolveLink(href: string | undefined, baseUrl: string): string | null {
  if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) return null;
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

function pathOf(url: string, fallback?: string): string {
  if (fallback) return fallback;
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "/";
  }
}

function clean(value: string | null | undefined): string | null {
  const normalized = normalizeText(value ?? "");
  return normalized || null;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
