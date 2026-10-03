import { describe, expect, it } from "vitest";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";

import {
  managerSimplificationNotes,
  normalizeManagerRules,
  validateManagerRules,
} from "@/lib/leadgen/icpAuthoring";

describe("manager ICP authoring validation", () => {
  it("allows an incomplete but structurally valid draft", () => {
    const rules = emptyIcpRulesV2("draft", "Draft ICP");
    expect(validateManagerRules(rules)).toEqual(rules);
  });

  it("blocks publishing an ICP with no usable condition", () => {
    const rules = emptyIcpRulesV2("empty", "Empty ICP");
    expect(() => validateManagerRules(rules, true)).toThrowError(/must-have or exclusion/);
  });

  it("accepts a publishable must-have without exposing scoring weights", () => {
    const rules = emptyIcpRulesV2("industry", "Software ICP");
    rules.industry.mode = "allowlist";
    rules.industry.targetIndustries = ["software"];

    expect(validateManagerRules(rules, true)).toEqual(rules);
  });

  it("rejects an impossible employee range", () => {
    const rules = emptyIcpRulesV2("size", "Bad size");
    rules.size.minEmployees = 500;
    rules.size.maxEmployees = 50;

    expect(() => validateManagerRules(rules)).toThrowError(/Minimum employees/);
  });
  it("converts hidden template criteria into the simple visible fields", () => {
    const rules = emptyIcpRulesV2("template", "Template");
    rules.persona.titleTiers = [
      { tier: 1, titles: ["CEO"], keywords: ["founder"], weight: 100 },
    ];
    rules.persona.titleKeywords = ["operations"];
    rules.persona.departmentAllowlist = ["SALES"];
    rules.size.sizeBands = ["MEDIUM", "MID_MARKET"];
    rules.requiredEvidenceForFinalQualification.personaTitle = true;

    const normalized = normalizeManagerRules(rules);
    expect(normalized.persona.titleAllowlist).toEqual([
      "operations",
      "CEO",
      "founder",
    ]);
    expect(normalized.persona.titleTiers).toEqual([]);
    expect(normalized.persona.titleKeywords).toEqual([]);
    expect(normalized.persona.departmentAllowlist).toEqual([]);
    expect(normalized.size).toMatchObject({
      minEmployees: 51,
      maxEmployees: 1000,
      sizeBands: [],
    });
    expect(normalized.requiredEvidenceForFinalQualification.personaTitle).toBe(false);
  });
  it("uses the shared detector for server-only legacy exclusions", () => {
    const rules = emptyIcpRulesV2("legacy", "Legacy");
    rules.disqualifiers.competitorDenylist = ["competitor.example"];

    expect(managerSimplificationNotes(rules)).toContain(
      "Project-based and competitor exclusions will be removed",
    );
  });

  it("keeps the points, thresholds and disqualifiers through a save", () => {
    // They used to be reset to defaults on every save, silently — which is why the TeleStar ICP
    // could enforce one of its five disqualifiers, and why its weights could never be tuned.
    const rules = emptyIcpRulesV2("kept", "Kept");
    rules.geography.targetCountries = ["United Kingdom"];
    rules.scoringWeights = { geo: 40, industry: 10, companyType: 0, size: 10, persona: 40, signals: 0 };
    rules.scorePolicy = { ...rules.scorePolicy, qualifiedMinFitScore: 70, needsReviewMinFitScore: 40 };
    rules.disqualifiers.genericEmailContact = { disqualify: true };
    rules.disqualifiers.websiteOffline = { disqualify: true };
    rules.disqualifiers.onePersonCompany = { disqualify: true };
    rules.companyType.servicesConsultingPolicy = { disqualify: true, exceptMarkets: ["Vietnam"] };

    expect(managerSimplificationNotes(rules)).toEqual([]);

    const saved = normalizeManagerRules(rules);
    expect(saved.scoringWeights).toEqual(rules.scoringWeights);
    expect(saved.scorePolicy.qualifiedMinFitScore).toBe(70);
    expect(saved.scorePolicy.needsReviewMinFitScore).toBe(40);
    expect(saved.disqualifiers.genericEmailContact.disqualify).toBe(true);
    expect(saved.disqualifiers.websiteOffline.disqualify).toBe(true);
    expect(saved.disqualifiers.onePersonCompany.disqualify).toBe(true);
    expect(saved.companyType.servicesConsultingPolicy).toEqual({ disqualify: true, exceptMarkets: ["Vietnam"] });
  });
});