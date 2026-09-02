import { describe, expect, it } from "vitest";

import { toGoogleSearchHref } from "@/lib/v2/format/url";
import { buildQueriesFromBuilderParams, normalizeResearchBuilderParams } from "@telestar/core-research/buildDiscoveryQueries";

describe("toGoogleSearchHref", () => {
  it("joins non-empty parts into a google search url", () => {
    const href = toGoogleSearchHref(["Jane Doe", "VP Sales", "Acme Inc"]);
    expect(href).toBe(`https://www.google.com/search?q=${encodeURIComponent("Jane Doe VP Sales Acme Inc")}`);
  });
  it("returns null when there is nothing to search", () => {
    expect(toGoogleSearchHref([null, "", undefined])).toBeNull();
  });
});

describe("research builder refinements (P5)", () => {
  function params(extra: Record<string, unknown>) {
    return normalizeResearchBuilderParams({ queryLimit: 50, ...extra })!;
  }

  it("expands seniority into concrete titles for contact queries", () => {
    const p = params({ seniority: "C-level, VP", geos: "Denmark" });
    const queries = buildQueriesFromBuilderParams("CONTACT", p).map((q) => q.query).join(" | ");
    expect(queries).toMatch(/CEO|Chief/);
    expect(queries).toMatch(/VP|Vice President/);
  });

  it("appends exclude domains + keywords as negative operators", () => {
    const p = params({ titles: "SDR", geos: "US", excludeDomains: "indeed.com", excludeKeywords: "recruiter" });
    const queries = buildQueriesFromBuilderParams("CONTACT", p).map((q) => q.query);
    expect(queries.every((q) => q.includes("-site:indeed.com"))).toBe(true);
    expect(queries.every((q) => q.includes('-"recruiter"'))).toBe(true);
  });

  it("adds a company-size term to the queries", () => {
    const p = params({ industries: "fintech", geos: "US", companySize: "51-200 employees" });
    const queries = buildQueriesFromBuilderParams("COMPANY", p).map((q) => q.query);
    expect(queries.every((q) => q.includes("51-200 employees"))).toBe(true);
  });

  it("normalizes exclude domains + drops invalid ones", () => {
    const p = params({ excludeDomains: "indeed.com, not a domain, apollo.io" });
    expect(p.excludeDomains).toEqual(["indeed.com", "apollo.io"]);
  });
});
