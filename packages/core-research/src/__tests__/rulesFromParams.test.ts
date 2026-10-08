import { describe, expect, it } from "vitest";

import { assessIcpRulesV2 } from "@telestar/core-scoring/rules/deriveQualification";
import { validateIcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import type { ResearchBuilderParams } from "../buildDiscoveryQueries";
import { builderParamsToRulesV2, classificationToEvidence, toAccountRules } from "../rulesFromParams";
import type { CompanyClassificationInput } from "../verificationTypes";

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

// The owner's three live ICPs (2026-10-08).
const STORMWALL = params({
  industries: ["ISP/Telecom", "Banking", "E-commerce", "Gaming"],
  geos: ["Saudi Arabia", "UAE", "Turkey", "Egypt", "Indonesia", "Vietnam", "India", "Morocco", "Germany"],
  titles: ["CISO", "Head of Security"],
  seniority: ["director", "c-level"],
  companySize: "exclude very small",
});
const FINGERMIND = params({
  industries: ["Aviation", "MRO", "CAMO", "Part 145"],
  geos: ["Europe", "Middle East"],
  titles: ["Head of Maintenance"],
});
const SAIGON = params({
  industries: ["Banking", "Healthcare", "Financial services"],
  geos: ["New Zealand", "Germany", "Australia"],
  companySize: "2-500",
  excludeDomains: ["https://www.rival-outsourcing.com/about"],
});

describe("builderParamsToRulesV2", () => {
  it.each([
    ["Stormwall", STORMWALL],
    ["FingerMind", FINGERMIND],
    ["Saigon Technology", SAIGON],
    ["a blank builder", params()],
  ])("builds rules that pass schema validation for %s", (_name, p) => {
    const { rules } = builderParamsToRulesV2(p, "run-1");
    expect(() => validateIcpVersionRulesV2(rules)).not.toThrow();
    expect(rules.ruleSetId).toBe("research:run-1");
  });

  it("turns industries into an allowlist, splitting 'ISP/Telecom' and adding the canonical keys", () => {
    const { rules } = builderParamsToRulesV2(STORMWALL, "r");
    expect(rules.industry.mode).toBe("allowlist");
    expect(rules.industry.targetIndustries).toEqual(
      expect.arrayContaining(["ISP", "Telecom", "Banking", "E-commerce", "Gaming", "ECOMMERCE"]),
    );
  });

  it("leaves industry open when the builder named none", () => {
    expect(builderParamsToRulesV2(params(), "r").rules.industry.mode).toBe("all");
  });

  it("resolves countries and aliases, and reports geos it cannot place instead of dropping them silently", () => {
    const { rules, warnings } = builderParamsToRulesV2(STORMWALL, "r");
    expect(rules.geography.targetCountries).toEqual(
      expect.arrayContaining(["Saudi Arabia", "United Arab Emirates", "Turkey", "Egypt", "Indonesia", "Vietnam", "India", "Morocco", "Germany"]),
    );
    expect(warnings).toEqual([]);

    const odd = builderParamsToRulesV2(params({ geos: ["Europe", "Middle East", "Türkiye", "Atlantis"] }), "r");
    expect(odd.rules.geography.targetRegions).toEqual(expect.arrayContaining(["EUROPE", "MENA"]));
    expect(odd.rules.geography.targetCountries).toContain("Turkey");
    expect(odd.warnings).toEqual([expect.stringContaining("Atlantis")]);
  });

  it("reads company size as a headcount range", () => {
    expect(builderParamsToRulesV2(SAIGON, "r").rules.size).toMatchObject({ minEmployees: 2, maxEmployees: 500 });
    expect(builderParamsToRulesV2(params({ companySize: "51-200, 201-500, 501-1000" }), "r").rules.size).toMatchObject({
      minEmployees: 51,
      maxEmployees: 1000,
    });
    const open = builderParamsToRulesV2(params({ companySize: "1,001+" }), "r").rules.size;
    expect(open.minEmployees).toBe(1001);
    expect(open.maxEmployees).toBeUndefined();
    // "exclude very small" is Stormwall's wording: nothing at or below the micro band.
    const small = builderParamsToRulesV2(STORMWALL, "r").rules.size;
    expect(small.minEmployees).toBe(11);
    expect(small.excludeTooSmall).toBe(true);
    // ...and fatal below that floor (the engine's headcount gate), not merely a lower size score.
    expect(builderParamsToRulesV2(STORMWALL, "r").rules.disqualifiers.onePersonCompany).toEqual({ disqualify: true, threshold: 11 });
    expect(builderParamsToRulesV2(SAIGON, "r").rules.disqualifiers.onePersonCompany.disqualify).toBe(false);
  });

  it("maps exclude keywords to excluded industries and exclude domains to the competitor denylist", () => {
    const { rules } = builderParamsToRulesV2(
      params({ excludeKeywords: ["gambling"], excludeDomains: ["https://www.rival.com/x"] }),
      "r",
    );
    expect(rules.industry.excludedIndustries).toEqual([]);
    expect(rules.disqualifiers.competitorDenylist).toEqual(["rival.com"]);
  });

  it("keeps persona rules from titles and seniority (toAccountRules removes them later)", () => {
    const { rules } = builderParamsToRulesV2(STORMWALL, "r");
    expect(rules.persona.titleAllowlist).toEqual(["CISO", "Head of Security"]);
    expect(rules.persona.seniorityFloor).toBe("DIRECTOR");
  });

  it("never puts keywords into the rules: a keyword may rank a candidate but must not move its band", () => {
    const withKeywords = builderParamsToRulesV2(params({ ...SAIGON, keywords: ["fintech", "core banking"] }), "r").rules;
    const without = builderParamsToRulesV2(SAIGON, "r").rules;
    expect(withKeywords).toEqual(without);
    expect(withKeywords.industry.industryKeywords).toEqual([]);
  });
});

describe("toAccountRules", () => {
  const company = {
    company: {
      companyName: "Riyad Bank",
      country: "Saudi Arabia",
      industry: "banking",
      industryTags: ["Banking"],
      employeeCount: 25498,
      domain: "riyadbank.com",
      websiteStatus: "reachable" as const,
    },
  };

  it("clears every persona rule and the persona requirements", () => {
    const account = toAccountRules(builderParamsToRulesV2(STORMWALL, "r").rules);
    expect(account.persona).toMatchObject({
      titleAllowlist: [],
      titleDenylist: [],
      titleTiers: [],
      seniorityExclusions: [],
      departmentAllowlist: [],
      titleKeywords: [],
      requirePersonaForFinalQualification: false,
    });
    expect(account.persona.seniorityFloor).toBeUndefined();
    expect(account.requiredEvidenceForFinalQualification.personaTitle).toBe(false);
    expect(account.blocksFinalQualificationFromCompanyOnlyEvidence).toBe(false);
    expect(() => validateIcpVersionRulesV2(account)).not.toThrow();
  });

  it("does not mutate the rules it was given", () => {
    const rules = builderParamsToRulesV2(STORMWALL, "r").rules;
    const before = JSON.stringify(rules);
    toAccountRules(rules);
    expect(JSON.stringify(rules)).toBe(before);
  });

  it("stops the engine asking for a persona title that a company-only candidate can never have", () => {
    const { rules } = builderParamsToRulesV2(STORMWALL, "r");
    const personaRules = validateIcpVersionRulesV2({
      ...rules,
      persona: { ...rules.persona, requirePersonaForFinalQualification: true },
      requiredEvidenceForFinalQualification: { ...rules.requiredEvidenceForFinalQualification, personaTitle: true },
    });
    expect(assessIcpRulesV2(company, personaRules).requiredEvidenceMissing).toContain("required_persona_title_missing");
    // The verdict that follows from this (company reaches qualified) is asserted in
    // tests/research-verify-scoring.test.ts, where the lead verdict rule lives.
    expect(assessIcpRulesV2(company, toAccountRules(personaRules)).requiredEvidenceMissing).toEqual([]);
  });

  it("points mode: drops title rows and shifts both thresholds, keeping fitAt above reviewAt", () => {
    const { rules } = builderParamsToRulesV2(STORMWALL, "r");
    const pointed = {
      ...rules,
      pointRules: {
        enabled: true,
        rules: [
          { id: "t1", group: "title" as const, values: ["CISO"], points: 30 },
          { id: "t2", group: "title" as const, values: ["Head of Security"], points: 25 },
          { id: "t3", group: "title" as const, values: ["intern"], points: -40 },
          { id: "c1", group: "country" as const, values: ["Saudi Arabia"], points: 20 },
          { id: "i1", group: "industry" as const, values: ["Banking"], points: 10 },
        ],
        fitAt: 60,
        reviewAt: 30,
      },
    };
    const account = toAccountRules(validateIcpVersionRulesV2(pointed));
    expect(account.pointRules?.rules.map((r) => r.id)).toEqual(["c1", "i1"]);
    // Largest positive title row was 30.
    expect(account.pointRules).toMatchObject({ fitAt: 30, reviewAt: 1 });
    expect(account.pointRules!.fitAt).toBeGreaterThan(account.pointRules!.reviewAt);
  });

  it("points mode: a large title row cannot push fitAt to zero or reverse the order", () => {
    const { rules } = builderParamsToRulesV2(params({ geos: ["Germany"] }), "r");
    const pointed = validateIcpVersionRulesV2({
      ...rules,
      pointRules: {
        enabled: true,
        rules: [
          { id: "t1", group: "title", values: ["CEO"], points: 90 },
          { id: "c1", group: "country", values: ["Germany"], points: 20 },
        ],
        fitAt: 50,
        reviewAt: 40,
      },
    });
    const account = toAccountRules(pointed);
    expect(account.pointRules!.fitAt).toBeGreaterThanOrEqual(1);
    expect(account.pointRules!.fitAt).toBeGreaterThan(account.pointRules!.reviewAt);
    expect(() => validateIcpVersionRulesV2(account)).not.toThrow();
  });

  it("points mode without a title row leaves the thresholds alone", () => {
    const { rules } = builderParamsToRulesV2(SAIGON, "r");
    const pointed = validateIcpVersionRulesV2({
      ...rules,
      pointRules: { enabled: true, rules: [{ id: "c1", group: "country", values: ["Germany"], points: 20 }], fitAt: 20, reviewAt: 10 },
    });
    expect(toAccountRules(pointed).pointRules).toMatchObject({ fitAt: 20, reviewAt: 10 });
  });
});

describe("classificationToEvidence", () => {
  const classification = (over: Partial<CompanyClassificationInput> = {}): CompanyClassificationInput => ({
    isCompanySite: true,
    notCompanyReason: null,
    companyKind: "operator",
    industryText: "Banking",
    industryKey: "BANKING",
    whatTheySell: "Retail and corporate banking",
    hqCountry: "Saudi Arabia",
    employeeCount: 25498,
    employeeBand: null,
    confidence: "high",
    evidence: [],
    ...over,
  });
  const candidate = { name: "Riyad Bank", domain: "riyadbank.com" };

  it("hands the engine the safe alias for the industry key, with the classifier's own words as a tag", () => {
    const { company } = classificationToEvidence(classification({ industryKey: "FNB", industryText: "Restaurant group" }), candidate);
    expect(company.industry).toBe("f&b");
    expect(company.industryTags).toEqual(["Restaurant group"]);
  });

  it("keeps free text as a tag only (never the raw industry), and omits industry when there is neither", () => {
    const ot = classificationToEvidence(classification({ industryKey: "OTHER", industryText: "Aircraft MRO" }), candidate).company;
    expect(ot.industry).toBeUndefined();
    expect(ot.industryTags).toEqual(["Aircraft MRO"]);
    const none = classificationToEvidence(classification({ industryKey: null, industryText: null }), candidate).company;
    expect(none.industry).toBeUndefined();
    expect(none.industryTags).toBeUndefined();
  });

  it("carries country, headcount, domain and the product description", () => {
    const { company } = classificationToEvidence(classification(), candidate, { reachable: true });
    expect(company).toMatchObject({
      companyName: "Riyad Bank",
      domain: "riyadbank.com",
      country: "Saudi Arabia",
      employeeCount: 25498,
      description: "Retail and corporate banking",
      websiteStatus: "reachable",
    });
  });

  it("reads a band when there is no headcount, and never calls an unfetched site offline", () => {
    const { company } = classificationToEvidence(classification({ employeeCount: null, employeeBand: "MID_MARKET" }), candidate);
    expect(company.employeeCount).toBeUndefined();
    expect(company.employeeRange).toBe("mid market");
    expect(company.websiteStatus).toBe("unknown");
    expect(classificationToEvidence(classification(), candidate, { reachable: false }).company.websiteStatus).toBe("unknown");
  });

  it.each([
    ["software_vendor", "PRODUCT_SAAS"],
    ["services_agency", "SERVICE_ONLY"],
    ["directory_marketplace_jobboard", "MARKETPLACE"],
    ["operator", "UNKNOWN"],
    ["government", "UNKNOWN"],
    [null, "UNKNOWN"],
  ] as const)("maps kind %s to company type %s", (kind, type) => {
    expect(classificationToEvidence(classification({ companyKind: kind }), candidate).company.companyType).toBe(type);
  });

  it("builds evidence text from the industry and what they sell, never from the company name", () => {
    const { company } = classificationToEvidence(classification(), { name: "Consulting Bank", domain: "x.com" });
    expect(company.evidenceText).toBe("Banking Retail and corporate banking");
  });

  it("has no contact: a candidate is a company", () => {
    expect(classificationToEvidence(classification(), candidate).contact).toBeUndefined();
  });
});
