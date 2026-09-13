import "server-only";

import type {
  CompanyIntelSearchProvider,
  NormalizedSearchResult,
  SingleProviderOutcome,
} from "../types";
import { domainFromUrl, executeProviderSearchText } from "./shared";

// OSS/free provider: DuckDuckGo. No official JSON web-results API, so we hit the HTML
// endpoint and parse result rows. Keyless (gated by DDG_SEARCH_ENABLED). Unofficial +
// rate-limited — meant as a free fallback in the chain, never the sole engine. Supports
// `site:` dorks (passed straight through to DDG). `category` is ignored (SERP, not neural).
const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class DdgSearchProvider implements CompanyIntelSearchProvider {
  readonly provider = "ddg" as const;
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  search(input: { query: string; resultsPerQuery: number; timeoutMs: number }): Promise<SingleProviderOutcome> {
    return executeProviderSearchText({
      provider: "ddg",
      fetchImpl: this.fetchImpl,
      timeoutMs: input.timeoutMs,
      buildRequest: () => {
        const url = new URL(DDG_ENDPOINT);
        url.searchParams.set("q", input.query);
        url.searchParams.set("kl", "us-en");
        return {
          url: url.toString(),
          method: "GET",
          headers: { "User-Agent": UA, Accept: "text/html" },
        };
      },
      parse: (html) => parseDdg(html, input.resultsPerQuery),
    });
  }
}

const RESULT_LINK_RE = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const SNIPPET_RE = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;

function parseDdg(html: string, limit: number): NormalizedSearchResult[] {
  const snippets: string[] = [];
  for (const m of html.matchAll(SNIPPET_RE)) snippets.push(cleanText(m[1]));

  const out: NormalizedSearchResult[] = [];
  let index = 0;
  for (const m of html.matchAll(RESULT_LINK_RE)) {
    const url = resolveDdgHref(m[1]);
    const title = cleanText(m[2]);
    if (!url || !title) {
      index += 1;
      continue;
    }
    out.push({
      provider: "ddg",
      title,
      url,
      snippet: snippets[index] ?? null,
      highlight: null,
      publishedDate: null,
      position: out.length + 1,
      sourceDomain: domainFromUrl(url),
    });
    index += 1;
    if (out.length >= limit) break;
  }
  return out;
}

// DDG wraps result URLs in a redirect: //duckduckgo.com/l/?uddg=<encoded-target>. Unwrap it;
// pass through already-absolute http(s) links.
function resolveDdgHref(href: string): string | null {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
    return null;
  } catch {
    return null;
  }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#x27": "'",
  "#39": "'",
  nbsp: " ",
};

/**
 * SERP markup → plain text. The markup is the provider's, so it is treated as hostile:
 * tags are removed with an index scan (`/<[^>]+>/g` is quadratic on markup full of `<` with
 * no `>`), and entities are decoded in a single pass so `&amp;lt;` yields the literal `&lt;`
 * instead of being unescaped twice (CodeQL js/polynomial-redos, js/double-escaping,
 * js/incomplete-multi-character-sanitization).
 */
function cleanText(raw: string): string {
  let text = "";
  let cursor = 0;
  for (;;) {
    const lt = raw.indexOf("<", cursor);
    if (lt === -1) break;
    const gt = raw.indexOf(">", lt + 1);
    if (gt === -1) break;
    text += raw.slice(cursor, lt);
    cursor = gt + 1;
  }
  text += raw.slice(cursor);
  return text
    .replace(/&(amp|lt|gt|quot|#x27|#39|nbsp);/g, (whole, name: string) => HTML_ENTITIES[name] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}
