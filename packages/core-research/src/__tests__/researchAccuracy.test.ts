import { describe, expect, it } from "vitest";

import { isInstitutionalHost, registrableDomain } from "@telestar/core-identity/registrableDomain";

import { buildQueriesFromBuilderParams, type ResearchBuilderParams } from "../buildDiscoveryQueries";
import { parseCompanyHits, parseCompanyHitsDetailed, type RawSearchHit } from "../parseDiscoveryResults";

/**
 * Company research returned the wrong companies (owner report, 2026-10-08). Measured on five live
 * ICPs, about 43% of what it found was on target. These are the parts of that which are plain
 * defects, each pinned to what production actually returned.
 */

const hit = (url: string, title: string, snippet: string | null = "A company description long enough to read."): RawSearchHit => ({
  url,
  title,
  snippet,
  provider: "exa",
});

describe("registrableDomain", () => {
  it.each([
    ["uksoftware.co.uk", "uksoftware.co.uk"],
    ["https://www.centralretail.com.vn/careers", "centralretail.com.vn"],
    ["inspirenet.com.sa", "inspirenet.com.sa"],
    ["shop.acme.co.nz", "acme.co.nz"],
    ["blog.riyadbank.com", "riyadbank.com"],
    ["acme.github.io", "acme.github.io"],
    ["WWW.Example.COM", "example.com"],
  ])("reads %s as %s", (input, expected) => {
    expect(registrableDomain(input)).toBe(expected);
  });

  it.each(["", "not a host", "acme corp.com", "localhost", "co.uk", "192.168.0.1"])("has no company domain for %j", (input) => {
    expect(registrableDomain(input)).toBeNull();
  });
});

describe("isInstitutionalHost", () => {
  it.each(["ictfund.tdra.gov.ae", "moh.gov.vn", "www.harvard.edu", "ox.ac.uk", "usa.gov", "army.mil"])("%s is a government or education body", (host) => {
    expect(isInstitutionalHost(host)).toBe(true);
  });

  it.each(["riyadbank.com", "govtech.com", "education.com.vn", "acme.co.uk", "startup.ac"])("%s is not", (host) => {
    expect(isInstitutionalHost(host)).toBe(false);
  });
});

describe("parseCompanyHits", () => {
  it("keeps two UK companies apart instead of folding every .co.uk site into one", () => {
    const out = parseCompanyHits("q", [hit("https://www.uksoftware.co.uk/", "UK IT Soft Ltd"), hit("https://www.acme.co.uk/about", "Acme Ltd | About")]);
    expect(out.map((c) => c.domain)).toEqual(["uksoftware.co.uk", "acme.co.uk"]);
    expect(out.map((c) => c.dedupeFingerprint)).toEqual(["company:uksoftware.co.uk", "company:acme.co.uk"]);
  });

  it("names a company from its own domain, not the generic second-level label", () => {
    const [candidate] = parseCompanyHits("q", [hit("https://inspirenet.com.sa/", "Home | Inspirenet - Internet services")]);
    expect(candidate.name).toBe("Inspirenet");
  });

  it.each([
    ["https://www.mordorintelligence.com/industry-reports/x", "Middle East DDoS Protection Market"],
    ["https://www.verifiedmarketreports.com/blog/top-mro", "Aviation MRO companies"],
    ["https://www.globaldata.com/companies/", "GlobalData Plc"],
    ["https://www.gulftalent.com/jobs", "Network Engineer jobs in Dubai"],
    ["https://pitchbook.com/profiles/company/1", "Tech USA 2026 Company Profile"],
    ["https://companiesmarketcap.com/tech/", "Largest tech companies by market cap"],
    ["https://ictfund.tdra.gov.ae/", "ICT Fund - TDRA"],
    ["https://www.techtitute.edu/", "TECH Global University"],
  ])("does not take %s for a prospect company", (url, title) => {
    expect(parseCompanyHits("q", [hit(url, title)])).toEqual([]);
  });

  it.each([
    "Aviation MRO Market Size, Share & Forecast 2026-2033",
    "Top Tech Companies in Norway",
    "Best FMCG companies in Vietnam",
    "Largest banks in the UAE",
    "Leading ISPs in Indonesia (2026)",
    "Companies in Singapore: cloud and infrastructure",
  ])("does not harvest a roundup or market report titled %j", (title) => {
    expect(parseCompanyHits("q", [hit("https://www.somesite-unlisted.com/page", title)])).toEqual([]);
  });

  it.each(["Riyad Bank | Personal Banking", "Lufthansa Technik - MRO services", "Central Retail Vietnam", "Top Glove Corporation Bhd"])(
    "still harvests a company page titled %j",
    (title) => {
      expect(parseCompanyHits("q", [hit("https://www.company-x.com/", title)])).toHaveLength(1);
    }
  );

  it("counts what it threw away, by reason, so an empty run can say why it is empty", () => {
    const result = parseCompanyHitsDetailed("q", [
      hit("https://www.linkedin.com/company/acme", "Acme | LinkedIn"),
      hit("https://www.mordorintelligence.com/r", "ISP Market"),
      hit("https://moh.gov.vn/", "Ministry of Health"),
      hit("https://www.blog-x.com/top", "Top 10 ISPs in Vietnam"),
      hit("https://www.acme.com/", "Acme"),
      hit("https://www.acme.com/about", "About Acme"),
    ]);
    expect(result.candidates.map((c) => c.domain)).toEqual(["acme.com"]);
    expect(result.rejected).toEqual({ notACompanySite: 2, institutional: 1, roundup: 1, duplicate: 1, unreadable: 0 });
  });
});

describe("company query plan", () => {
  const params = (over: Partial<ResearchBuilderParams> = {}): ResearchBuilderParams => ({
    queryPlanVersion: 1,
    mode: "BUILDER",
    queryLimit: 50,
    industries: ["ISP", "Telecom", "Banking"],
    keywords: [],
    titles: ["CISO"],
    geos: ["Saudi Arabia", "UAE", "Turkey", "Egypt", "Indonesia", "Vietnam", "India", "Morocco"],
    seniority: [],
    excludeKeywords: [],
    excludeDomains: [],
    ...over,
  });

  it("never puts the company-size band into the query text, where it matched no page at all", () => {
    // Production: `"FMCG" Singapore … "51-200, 201-500, 501-1000"` returned nothing, four times.
    const queries = buildQueriesFromBuilderParams("COMPANY", params({ companySize: "51-200, 201-500, 501-1000" }));
    expect(queries.length).toBeGreaterThan(0);
    for (const q of queries) expect(q.query).not.toContain("51-200");
  });

  it("does not spend queries on roundup pages the parser then throws away", () => {
    for (const q of buildQueriesFromBuilderParams("COMPANY", params())) expect(q.query).not.toMatch(/^top\b/i);
  });

  it("reaches every target country before repeating one", () => {
    const queries = buildQueriesFromBuilderParams("COMPANY", params());
    const firstEight = queries.slice(0, 8).map((q) => q.hints.find((h) => params().geos.includes(h)));
    expect(new Set(firstEight)).toEqual(new Set(params().geos));
  });

  it("still covers every industry", () => {
    const hinted = new Set(buildQueriesFromBuilderParams("COMPANY", params()).flatMap((q) => q.hints));
    for (const industry of params().industries) expect(hinted).toContain(industry);
  });
});
