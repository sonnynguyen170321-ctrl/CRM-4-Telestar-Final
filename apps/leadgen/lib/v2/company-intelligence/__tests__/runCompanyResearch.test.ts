import { describe, expect, it } from "vitest";

import { runCompanyResearch } from "../runCompanyResearch";
import type { FetchImpl } from "../fetchWebsite";
import type { SearchProvider, SearchResult } from "../searchProvider";

type RouteResponse = { status: number; body: string } | "network_error";

function createMockFetch(routes: Record<string, RouteResponse>): FetchImpl {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    const route = routes[path];

    if (route === "network_error") {
      throw new TypeError("network error");
    }

    const resolved = route ?? { status: 404, body: "" };

    return {
      status: resolved.status,
      url,
      text: async () => resolved.body,
    } as unknown as Response;
  }) as unknown as FetchImpl;
}

class StaticSearchProvider implements SearchProvider {
  constructor(private readonly results: SearchResult[]) {}

  async search(query: string): Promise<SearchResult[]> {
    return this.results.map((result) => ({ ...result, sourceQuery: query }));
  }
}

const LONG_TEXT = `<html><body><p>${"Acme provides a SaaS cybersecurity platform for banking customers. ".repeat(10)}</p></body></html>`;
const SHORT_TEXT = `<html><body><p>Hi.</p></body></html>`;

describe("runCompanyResearch", () => {
  it("returns NO_WEBSITE when there is no website URL or canonical domain", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: null,
      websiteUrl: null,
    });

    expect(result.status).toBe("NO_WEBSITE");
    expect(result.canonicalDomain).toBeNull();
    expect(result.profile.profileStatus).toBe("FAILED");
    expect(result.profile.factsJson).toEqual([]);
    expect(result.errorCode).toBe("NO_WEBSITE");
  });

  it("returns INVALID_URL for an unparseable website value", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "not a url",
      websiteUrl: null,
    });

    expect(result.status).toBe("INVALID_URL");
    expect(result.profile.profileStatus).toBe("FAILED");
    expect(result.profile.factsJson).toEqual([]);
  });

  it("returns SUCCESS with extracted neutral facts when the homepage has enough content", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://WWW.Acme.com/",
      websiteUrl: "https://WWW.Acme.com/",
      fetchOptions: {
        fetchImpl: createMockFetch({ "/": { status: 200, body: LONG_TEXT } }),
        rateLimitIntervalMs: 0,
      },
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.canonicalDomain).toBe("acme.com");
    expect(result.websiteUrl).toBe("https://WWW.Acme.com/");
    expect(result.profile.profileStatus).toBe("EXTRACTED");
    expect(result.profile.factsJson).toContain("offering.saas");
    expect(result.profile.factsJson).toContain("offering.cybersecurity");
    expect(result.profile.factsJson).toContain("industry.banking");
    expect(result.profile.classificationJson.offerings).toContain("offering.saas");
    expect(result.profile.classificationJson.industries).toContain("industry.banking");
    expect(result.profile.evidenceItemsJson.length).toBeGreaterThan(0);
    expect(result.profile.sourceCoverageJson.fetchStatus).toBe("SUCCESS");
    expect(result.profile.sourceCoverageJson.playwrightFallbackUsed).toBe(false);
  });

  it("routes JS_RENDER_REQUIRED through the Playwright fallback when enabled", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://acme.com",
      websiteUrl: "https://acme.com",
      fetchOptions: {
        fetchImpl: createMockFetch({ "/": { status: 200, body: SHORT_TEXT } }),
        rateLimitIntervalMs: 0,
      },
      playwrightOptions: {
        isEnabled: () => true,
        renderer: async () => ({ html: LONG_TEXT }),
      },
    });

    expect(result.profile.sourceCoverageJson.playwrightFallbackUsed).toBe(true);
    expect(result.status).toBe("SUCCESS");
    expect(result.profile.profileStatus).toBe("EXTRACTED");
    expect(result.profile.factsJson).toContain("offering.saas");
  });

  it("degrades to JS_RENDER_REQUIRED and still produces a usable profile when Playwright is disabled", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://acme.com",
      websiteUrl: "https://acme.com",
      fetchOptions: {
        fetchImpl: createMockFetch({ "/": { status: 200, body: SHORT_TEXT } }),
        rateLimitIntervalMs: 0,
      },
      playwrightOptions: {
        isEnabled: () => false,
      },
    });

    expect(result.status).toBe("JS_RENDER_REQUIRED");
    expect(result.profile.sourceCoverageJson.playwrightFallbackUsed).toBe(false);
    expect(["PARTIAL", "FAILED"]).toContain(result.profile.profileStatus);
    expect(result.profile.factsJson).toEqual([]);
  });

  it("does not call live search and includes stub search coverage by default", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://acme.com",
      websiteUrl: "https://acme.com",
      fetchOptions: {
        fetchImpl: createMockFetch({ "/": { status: 200, body: LONG_TEXT } }),
        rateLimitIntervalMs: 0,
      },
    });

    expect(result.searchResultsJson).toEqual([]);
    expect(result.profile.sourceCoverageJson.searchQueriesRun).toBe(0);
    expect(result.profile.sourceCoverageJson.searchResultsCount).toBe(0);
    expect(result.profile.confidenceJson.hasSearchResults).toBe(false);
  });

  it("incorporates injected search provider results into evidence", async () => {
    const searchProvider = new StaticSearchProvider([
      { title: "Acme raises Series B", url: "https://news.example/acme", snippet: "Acme raised $30M in Series B funding.", sourceQuery: "" },
    ]);

    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://acme.com",
      websiteUrl: "https://acme.com",
      fetchOptions: {
        fetchImpl: createMockFetch({ "/": { status: 200, body: LONG_TEXT } }),
        rateLimitIntervalMs: 0,
      },
      searchProvider,
    });

    expect(result.searchResultsJson.length).toBeGreaterThan(0);
    expect(result.profile.factsJson).toContain("growth.funding");
    expect(result.profile.confidenceJson.hasSearchResults).toBe(true);
  });

  it("never includes qualification, fitScore, confidenceScore, or final status fields on evidence items", () => {
    return runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://acme.com",
      websiteUrl: "https://acme.com",
      fetchOptions: {
        fetchImpl: createMockFetch({ "/": { status: 200, body: LONG_TEXT } }),
        rateLimitIntervalMs: 0,
      },
    }).then((result) => {
      for (const item of result.profile.evidenceItemsJson) {
        expect(item).not.toHaveProperty("qualification");
        expect(item).not.toHaveProperty("fitScore");
        expect(item).not.toHaveProperty("confidenceScore");
        expect(item).not.toHaveProperty("status");
        expect(item).not.toHaveProperty("verdict");
      }
    });
  });
});

describe("company depth signals", () => {
  it("extracts contact signals, team hints, and learned email patterns from seeded pages", async () => {
    const result = await runCompanyResearch({
      companyName: "Acme",
      canonicalDomainInput: "https://acme.com",
      websiteUrl: "https://acme.com",
      fetchOptions: {
        fetchImpl: createMockFetch({
          "/": { status: 200, body: LONG_TEXT },
          "/contact": { status: 200, body: "Contact jane.doe@acme.com, sales@acme.com or +1 415 555 0100 at 123 Market Street Suite 400." },
          "/team": { status: 200, body: "Jane Doe - Chief Revenue Officer" },
        }),
        rateLimitIntervalMs: 0,
      },
    });

    expect(result.profile.sourceCoverageJson.depthTerminalState).toBe("ENRICHED");
    expect(result.profile.sourceCoverageJson.publicEmailCount).toBeGreaterThanOrEqual(2);
    expect(result.profile.sourceCoverageJson.personalEmailCount).toBeGreaterThanOrEqual(1);
    expect(result.profile.sourceCoverageJson.roleEmailCount).toBeGreaterThanOrEqual(1);
    expect(result.profile.sourceCoverageJson.phoneCount).toBeGreaterThanOrEqual(1);
    expect(result.profile.sourceCoverageJson.teamHintCount).toBeGreaterThanOrEqual(1);
    expect(result.profile.sourceCoverageJson.learnedEmailPatterns).toEqual(
      expect.arrayContaining([expect.objectContaining({ pattern: "first.last" })])
    );
  });

  it("sets explicit depth terminal state when no website exists", async () => {
    const result = await runCompanyResearch({ companyName: "No Site", canonicalDomainInput: null, websiteUrl: null });
    expect(result.profile.sourceCoverageJson.depthTerminalState).toBe("NO_DOMAIN");
  });
});
