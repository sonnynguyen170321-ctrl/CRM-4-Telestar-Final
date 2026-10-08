import { describe, expect, it } from "vitest";

import type { ResearchBuilderParams } from "../buildDiscoveryQueries";
import { builderParamsToRulesV2, classificationToEvidence, resolveCountry } from "../rulesFromParams";
import type { CompanyClassificationInput } from "../verificationTypes";

/**
 * Review of the research scoring branch (2026-10-08) found ways a REAL prospect could be rejected by
 * deterministic code: a geography the builder could not place, a country spelled differently on the two
 * sides, an industry split on the wrong characters, a size list read as a thousands number. Each test here
 * pins one of them. The principle: deterministic code rejects only on unambiguous facts.
 */

const params = (over: Partial<ResearchBuilderParams> = {}): ResearchBuilderParams => ({
  queryPlanVersion: 1,
  mode: "BUILDER",
  queryLimit: 50,
  industries: [],
  keywords: [],
  titles: [],
  geos: [],
  seniority: [],
  excludeKeywords: [],
  excludeDomains: [],
  ...over,
});

const build = (over: Partial<ResearchBuilderParams>) => builderParamsToRulesV2(params(over), "r");

describe("geography the builder could not place never gates", () => {
  it("is gated when every geo resolved", () => {
    expect(build({ geos: ["Saudi Arabia", "Germany"] }).geoGate).toBe(true);
  });

  it("is not gated when any geo was unrecognised, even though the others resolved", () => {
    const result = build({ geos: ["Saudi Arabia", "Atlantis"] });
    expect(result.geoGate).toBe(false);
    expect(result.warnings).toHaveLength(1);
  });

  it("treats Worldwide / Global as no geography constraint at all", () => {
    for (const geo of ["Worldwide", "Global"]) {
      const result = build({ geos: [geo] });
      expect(result.geoGate).toBe(false);
      expect(result.warnings).toEqual([]);
      expect(result.rules.geography.targetCountries).toEqual([]);
      expect(result.rules.geography.targetRegions).toEqual([]);
    }
    // 'Global' beside a country widens, it does not narrow.
    expect(build({ geos: ["Global", "Germany"] }).rules.geography.targetCountries).toEqual([]);
  });

  it.each([
    ["Asia", ["India", "Pakistan", "Kazakhstan", "Vietnam"]],
    ["Africa", ["Egypt", "Nigeria", "South Africa", "Kenya"]],
    ["GCC", ["Saudi Arabia", "Qatar"]],
    ["Gulf", ["United Arab Emirates", "Kuwait"]],
    ["CIS", ["Russia", "Kazakhstan"]],
    ["Western Europe", ["France", "Germany"]],
    ["Eastern Europe", ["Poland", "Ukraine"]],
    ["Middle East", ["Iraq", "Iran", "Yemen", "Egypt"]],
    ["Europe", ["Serbia", "Ukraine", "Albania", "Bosnia and Herzegovina"]],
  ])("expands the region %s to the countries it contains", async (geo, countries) => {
    const { rules, warnings } = build({ geos: [geo] });
    expect(warnings).toEqual([]);
    const { expandRegionsToCountries } = await import("@telestar/core-scoring/rules/dictionaries/regions");
    const covered = new Set([...rules.geography.targetCountries, ...expandRegionsToCountries(rules.geography.targetRegions)]);
    for (const country of countries) expect(covered, `${geo} -> ${country}`).toContain(country);
  });

  it.each([
    ["NZ", "New Zealand"],
    ["de", "Germany"],
    ["AU", "Australia"],
    ["SG", "Singapore"],
    ["VN", "Vietnam"],
    ["AE", "United Arab Emirates"],
    ["SA", "Saudi Arabia"],
    ["TR", "Turkey"],
  ])("reads the ISO code %s as %s", (code, country) => {
    const { rules, warnings } = build({ geos: [code] });
    expect(warnings).toEqual([]);
    expect(rules.geography.targetCountries).toEqual([country]);
  });
});

describe("a country is spelled the same way on both sides", () => {
  it.each([
    ["KSA", "Saudi Arabia"],
    ["Kingdom of Saudi Arabia", "Saudi Arabia"],
    ["Türkiye", "Turkey"],
    ["Turkiye", "Turkey"],
    ["Republic of Türkiye", "Turkey"],
    ["UAE", "United Arab Emirates"],
    ["U.A.E.", "United Arab Emirates"],
    ["Riyadh, Saudi Arabia", "Saudi Arabia"],
    ["Dubai, UAE", "United Arab Emirates"],
    ["Istanbul, Türkiye", "Turkey"],
    ["DE", "Germany"],
  ])("resolves %s to %s", (raw, expected) => {
    expect(resolveCountry(raw)).toBe(expected);
  });

  it("is null for a place it cannot name, rather than a guess", () => {
    expect(resolveCountry("Atlantis")).toBeNull();
    expect(resolveCountry("")).toBeNull();
    expect(resolveCountry(null)).toBeNull();
  });

  it("evidence carries the resolved country, and the raw text when it cannot resolve one", () => {
    const base: CompanyClassificationInput = {
      isCompanySite: true,
      notCompanyReason: null,
      companyKind: "operator",
      industryText: "Telecom",
      industryKey: "TELECOM",
      whatTheySell: null,
      hqCountry: "Kingdom of Saudi Arabia",
      employeeCount: null,
      employeeBand: null,
      confidence: "high",
      evidence: [],
    };
    const cand = { name: "STC", domain: "stc.com.sa" };
    expect(classificationToEvidence(base, cand).company.country).toBe("Saudi Arabia");
    expect(classificationToEvidence({ ...base, hqCountry: "Narnia" }, cand).company.country).toBe("Narnia");
  });
});

describe("industry targets", () => {
  it.each([
    [["Banking & Finance"], ["Banking", "Finance"]],
    [["Telecom and Hosting"], ["Telecom", "Hosting"]],
    [["ISP, Telecom; Gaming"], ["ISP", "Telecom", "Gaming"]],
    [["ISP/Telecom"], ["ISP", "Telecom"]],
  ])("splits %j into %j", (industries, parts) => {
    expect(build({ industries }).rules.industry.targetIndustries).toEqual(expect.arrayContaining(parts));
  });

  it("does not turn exclude keywords into engine industry exclusions (a substring there is terminal)", () => {
    const result = build({ excludeKeywords: ["bank", "gambling"] });
    expect(result.rules.industry.excludedIndustries).toEqual([]);
    expect(result.excludeKeywords).toEqual(["bank", "gambling"]);
  });
});

describe("company size", () => {
  const size = (companySize: string) => build({ companySize }).rules.size;

  it("reads a comma list of ranges as a list, not a thousands number", () => {
    expect(size("51-200,201-500")).toMatchObject({ minEmployees: 51, maxEmployees: 500 });
    expect(size("51-200, 201-500, 501-1000")).toMatchObject({ minEmployees: 51, maxEmployees: 1000 });
  });

  it("still reads real thousands grouping", () => {
    expect(size("1,001-5,000")).toMatchObject({ minEmployees: 1001, maxEmployees: 5000 });
    expect(size("10-1,000")).toMatchObject({ minEmployees: 10, maxEmployees: 1000 });
    expect(size("10,001+").minEmployees).toBe(10001);
    expect(size("10,001+").maxEmployees).toBeUndefined();
  });

  it("reads 'exclude 1-10' and 'not 1-10' as a floor of 11", () => {
    expect(size("exclude 1-10")).toMatchObject({ minEmployees: 11, excludeTooSmall: true });
    expect(size("not 1-10").minEmployees).toBe(11);
  });

  it("reads an exclusion beside a range: both apply", () => {
    const rules = build({ companySize: "exclude very small, 51-200" }).rules;
    expect(rules.size).toMatchObject({ minEmployees: 51, maxEmployees: 200, excludeTooSmall: true });
    // Only the very small are barred outright; 11-50 is merely off the range.
    expect(rules.disqualifiers.onePersonCompany).toEqual({ disqualify: true, threshold: 11 });
  });
});

describe("free text is a tag, not the raw industry", () => {
  it("passes industryText as a tag only when the key is OTHER or missing", () => {
    // 'display' contains 'isp' and 'lead generation' contains 'ads': substring canonicalisation would
    // file those companies under ISP and ADVERTISING.
    const c: CompanyClassificationInput = {
      isCompanySite: true,
      notCompanyReason: null,
      companyKind: "operator",
      industryText: "LED display manufacturing",
      industryKey: "OTHER",
      whatTheySell: null,
      hqCountry: null,
      employeeCount: null,
      employeeBand: null,
      confidence: "high",
      evidence: [],
    };
    const { company } = classificationToEvidence(c, { name: "X", domain: null });
    expect(company.industry).toBeUndefined();
    expect(company.industryTags).toEqual(["LED display manufacturing"]);
    expect(classificationToEvidence({ ...c, industryKey: null }, { name: "X", domain: null }).company.industry).toBeUndefined();
  });
});
