import { describe, expect, it } from "vitest";

import {
  buildCompanyDiscoveryQueries,
  buildContactDiscoveryQueries,
  buildQueriesFromBuilderParams,
  normalizeResearchBuilderParams,
} from "../buildDiscoveryQueries";
import { parseCompanyHits, parseContactHits } from "../parseDiscoveryResults";
import { emptyIcpRulesV2 } from "@/lib/v2/scoring/rules/emptyIcpRulesV2";

function rules() {
  const r = emptyIcpRulesV2("icp-test", "Test ICP");
  r.geography.targetCountries = ["Vietnam", "Singapore"];
  r.industry.targetIndustries = ["fintech", "payments"];
  r.industry.industryKeywords = ["payment gateway", "checkout", "billing"];
  r.persona.titleTiers = [
    { tier: 1, titles: ["ceo"], keywords: [], weight: 100 },
    { tier: 3, titles: ["vp sales", "head of sales"], keywords: [], weight: 80 },
  ];
  return r;
}

describe("buildDiscoveryQueries (adaptive planner)", () => {
  it("derives company queries from industries x geo with hints + aggregator exclusions", () => {
    const qs = buildCompanyDiscoveryQueries(rules());
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(50);
    expect(qs.some((q) => q.query.includes("fintech"))).toBe(true);
    expect(qs.some((q) => q.query.includes("Vietnam"))).toBe(true);
    expect(qs[0].hints).toContain("fintech");
    // negative operators keep aggregators out of the harvest
    expect(qs.some((q) => q.query.includes("-site:linkedin.com"))).toBe(true);
    expect(qs.some((q) => q.query.includes("-site:zoominfo.com"))).toBe(true);
    // no duplicate queries
    expect(new Set(qs.map((q) => q.query.toLowerCase())).size).toBe(qs.length);
  });

  it("derives contact queries as focused LinkedIn people searches (single operator, no noise)", () => {
    const qs = buildContactDiscoveryQueries(rules());
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.every((q) => q.query.startsWith("site:linkedin.com/in"))).toBe(true);
    expect(qs.some((q) => q.query.includes("ceo"))).toBe(true);
    // the old noisy modifiers ("employees"/"leadership"/"team") must be gone
    expect(qs.some((q) => /employees|leadership|\bteam\b/i.test(q.query))).toBe(false);
  });

  it("returns NO queries for a blank ICP instead of junk", () => {
    const r = emptyIcpRulesV2("icp-blank", "Blank");
    expect(buildCompanyDiscoveryQueries(r)).toEqual([]);
    expect(buildContactDiscoveryQueries(r)).toEqual([]);
  });

  it("builds ATTRIBUTE-based lookalike queries (not brand strings) and negates the seed domain", () => {
    // Comprehension supplies the seed's real industries/keywords; the planner must search THOSE,
    // and every query must exclude the seed's own domain so it can't return itself.
    const params = normalizeResearchBuilderParams({
      industries: "payment gateway, fintech",
      geos: "Vietnam",
      seed: { name: "Acme Payments", domain: "acme.io" },
    });
    expect(params?.mode).toBe("LOOKALIKE");
    const qs = buildQueriesFromBuilderParams("COMPANY", params!);
    // searches the seed's category, not "companies like acme.io"
    expect(qs.some((q) => q.query.includes("payment gateway") || q.query.includes("fintech"))).toBe(true);
    // seed domain negated on attribute queries
    expect(qs.some((q) => q.query.includes("-site:acme.io"))).toBe(true);
    // no pure "companies like <brand>" query anymore
    expect(qs.some((q) => q.query.startsWith("companies like"))).toBe(false);
  });

  it("lookalike without comprehended attributes still avoids returning only the seed", () => {
    const params = normalizeResearchBuilderParams({ seed: { name: "Acme", domain: "acme.io" } });
    const qs = buildQueriesFromBuilderParams("COMPANY", params!);
    // only the single brand 'alternatives' probe, seed negated
    expect(qs.every((q) => q.query.includes("-site:acme.io"))).toBe(true);
  });

  it("builds people-at-company queries when a scope is set", () => {
    const params = normalizeResearchBuilderParams({
      titles: "VP Sales, Head of Growth",
      scope: { companyName: "Globex", domain: "globex.com" },
    });
    expect(params?.mode).toBe("COMPANY_CONTACTS");
    const qs = buildQueriesFromBuilderParams("CONTACT", params!);
    expect(qs.every((q) => q.query.startsWith("site:linkedin.com/in"))).toBe(true);
    expect(qs.some((q) => q.query.includes("Globex"))).toBe(true);
  });
});

describe("parseDiscoveryResults", () => {
  it("harvests company domains, excluding aggregators/socials, deduped by root domain", () => {
    const out = parseCompanyHits("q", [
      { title: "Acme Corp — Payments for platforms", url: "https://www.acme.io/product", snippet: "s", provider: "brave" },
      { title: "Acme blog", url: "https://blog.acme.io/post", snippet: null, provider: "brave" },
      { title: "Acme Corp | LinkedIn", url: "https://www.linkedin.com/company/acme", snippet: null, provider: "brave" },
      { title: "Top 10 payment companies", url: "https://www.forbes.com/list", snippet: null, provider: "brave" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].domain).toBe("acme.io");
    expect(out[0].name).toBe("Acme Corp");
    expect(out[0].dedupeFingerprint).toBe("company:acme.io");
  });

  it("excludes the seed / caller-provided domains from company hits", () => {
    const out = parseCompanyHits("q", [
      { title: "Acme Corp", url: "https://www.acme.io/", snippet: null, provider: "brave" },
      { title: "Globex", url: "https://globex.com/", snippet: null, provider: "brave" },
    ], ["https://www.acme.io"]);
    expect(out.map((c) => c.domain)).toEqual(["globex.com"]);
  });

  it("parses LinkedIn person results into name/title/company", () => {
    const out = parseContactHits("q", [
      { title: "Anna Tran - VP Sales - Acme Corp | LinkedIn", url: "https://vn.linkedin.com/in/anna-tran-123", snippet: "s", provider: "serper" },
      { title: "Duy Le – Head of Sales at Globex | LinkedIn", url: "https://www.linkedin.com/in/duyle", snippet: null, provider: "serper" },
      { title: "Acme Corp | LinkedIn", url: "https://www.linkedin.com/company/acme", snippet: null, provider: "serper" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ name: "Anna Tran", title: "VP Sales", companyName: "Acme Corp" });
    expect(out[0].linkedinUrl).toBe("https://www.linkedin.com/in/anna-tran-123");
    expect(out[1]).toMatchObject({ name: "Duy Le", title: "Head of Sales", companyName: "Globex" });
  });
});
