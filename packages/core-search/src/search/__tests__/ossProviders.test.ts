import { describe, expect, it } from "vitest";

import { DdgSearchProvider } from "../providers/ddgSearchProvider";
import { SearxngSearchProvider } from "../providers/searxngSearchProvider";
import { ExaSearchProvider } from "../providers/exaSearchProvider";
import { resolveUsableProviderChain } from "../env";
import { rerankResults } from "../rerankResults";
import type { NormalizedSearchResult } from "../types";

function jsonFetch(status: number, body: unknown): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

function textFetch(status: number, text: string): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(text),
    text: async () => text,
  })) as unknown as typeof fetch;
}

const CALL = { purpose: "company_profile" as const, resultsPerQuery: 5, timeoutMs: 1000 };

describe("SearXNG provider", () => {
  it("parses the JSON results shape into normalized results", async () => {
    const body = {
      results: [
        { url: "https://acme.com", title: "Acme", content: "Acme makes widgets" },
        { url: "https://beta.io/team", title: "Beta team", content: "People at Beta" },
      ],
    };
    const provider = new SearxngSearchProvider("http://searx.internal:8080/", jsonFetch(200, body));
    const { results, attempt } = await provider.search({ query: "widgets", ...CALL });
    expect(attempt.status).toBe("ok");
    expect(results.map((r) => r.url)).toEqual(["https://acme.com", "https://beta.io/team"]);
    expect(results[0]).toMatchObject({ provider: "searxng", title: "Acme", snippet: "Acme makes widgets", sourceDomain: "acme.com" });
  });

  it("reports http_error/unauthorized on a rejected key/instance", async () => {
    const provider = new SearxngSearchProvider("http://searx.internal:8080", jsonFetch(403, {}));
    const { results, attempt } = await provider.search({ query: "x", ...CALL });
    expect(results).toHaveLength(0);
    expect(attempt.status).toBe("http_error");
    expect(attempt.rejectionReason).toBe("unauthorized");
  });
});

describe("DuckDuckGo provider", () => {
  it("parses HTML rows and unwraps the uddg redirect", async () => {
    const html = `
      <div class="result">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fceo&rut=abc">Jane &amp; CEO</a>
        <a class="result__snippet" href="//x">Jane is CEO of Example Corp</a>
      </div>
      <div class="result">
        <a rel="nofollow" class="result__a" href="https://direct.example.org">Direct</a>
        <a class="result__snippet" href="//y">A direct link</a>
      </div>`;
    const provider = new DdgSearchProvider(textFetch(200, html));
    const { results } = await provider.search({ query: "ceo", ...CALL });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      provider: "ddg",
      url: "https://example.com/ceo",
      title: "Jane & CEO",
      snippet: "Jane is CEO of Example Corp",
      sourceDomain: "example.com",
    });
    expect(results[1].url).toBe("https://direct.example.org/");
  });
});

describe("Exa provider — category", () => {
  it("sends the category param when provided (people/company routing)", async () => {
    let capturedBody: Record<string, unknown> = {};
    const spy: typeof fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ results: [{ url: "https://p.com", title: "P" }] }), text: async () => "" };
    }) as unknown as typeof fetch;
    const provider = new ExaSearchProvider("secret-key", spy);
    await provider.search({ query: "ceo software denmark", ...CALL, category: "people" });
    expect(capturedBody.category).toBe("people");
    expect(capturedBody.type).toBe("auto");
  });

  it("omits category when not provided", async () => {
    let capturedBody: Record<string, unknown> = {};
    const spy: typeof fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return { ok: true, status: 200, json: async () => ({ results: [] }), text: async () => "" };
    }) as unknown as typeof fetch;
    await new ExaSearchProvider("k", spy).search({ query: "x", ...CALL });
    expect("category" in capturedBody).toBe(false);
  });
});

describe("env — OSS providers join the usable chain", () => {
  it("treats SEARXNG_URL as configured and DDG_SEARCH_ENABLED as a flag", () => {
    const chain = resolveUsableProviderChain({
      COMPANY_INTEL_SEARCH_ENABLED: "true",
      COMPANY_INTEL_SEARCH_PROVIDER_CHAIN: "exa,searxng,ddg",
      SEARXNG_URL: "http://searx.internal:8080",
      DDG_SEARCH_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(chain).toEqual(["searxng", "ddg"]); // exa dropped (no key), OSS both usable
  });

  it("ddg stays out unless explicitly enabled", () => {
    const chain = resolveUsableProviderChain({
      COMPANY_INTEL_SEARCH_ENABLED: "true",
      COMPANY_INTEL_SEARCH_PROVIDER_CHAIN: "ddg,searxng",
      SEARXNG_URL: "http://searx:8080",
    } as unknown as NodeJS.ProcessEnv);
    expect(chain).toEqual(["searxng"]);
  });

  it("auto-appends enabled OSS providers even when a legacy chain omits them", () => {
    // The exact bug: user's chain is exa,brave,serper but DDG_SEARCH_ENABLED=true.
    const chain = resolveUsableProviderChain({
      COMPANY_INTEL_SEARCH_ENABLED: "true",
      COMPANY_INTEL_SEARCH_PROVIDER_CHAIN: "exa,brave,serper",
      EXA_API_KEY: "k", BRAVE_SEARCH_API_KEY: "k", SERPER_API_KEY: "k",
      DDG_SEARCH_ENABLED: "true",
    } as unknown as NodeJS.ProcessEnv);
    expect(chain).toContain("ddg");
    expect(chain).toEqual(["exa", "brave", "serper", "ddg"]);
  });
});

describe("rerank — off by default", () => {
  it("returns the input order unchanged when SEARCH_RERANK_ENABLED is unset", async () => {
    const results: NormalizedSearchResult[] = [
      { provider: "ddg", title: "A", url: "https://a.com", snippet: "a", highlight: null, publishedDate: null, position: 1, sourceDomain: "a.com" },
      { provider: "ddg", title: "B", url: "https://b.com", snippet: "b", highlight: null, publishedDate: null, position: 2, sourceDomain: "b.com" },
    ];
    const out = await rerankResults("query", results, {} as NodeJS.ProcessEnv);
    expect(out).toBe(results);
  });
});
