import { describe, expect, it } from "vitest";

import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import { defaultKindPolicy, resolveKindPolicy } from "../targetPolicy";
import { COMPANY_KINDS } from "../verificationTypes";

/**
 * "Is this the sort of company the ICP wants?" decided on the company's KIND, before any score.
 * Production returned schools, analyst firms, job boards and software vendors for operator ICPs
 * (owner report, 2026-10-08). The kind is a classifier's reading, so a rejection needs the ICP to have
 * said what it wants; otherwise a person looks (review of 2026-10-08: false rejects hide real prospects).
 */

const rulesFor = (targets: string[], over: { disqualifyServices?: boolean; exceptMarkets?: string[] } = {}): IcpVersionRulesV2 => {
  const rules = emptyIcpRulesV2("t", "t");
  return {
    ...rules,
    industry: { ...rules.industry, mode: targets.length ? "allowlist" : "all", targetIndustries: targets },
    companyType: {
      ...rules.companyType,
      servicesConsultingPolicy: { disqualify: over.disqualifyServices ?? false, exceptMarkets: over.exceptMarkets ?? [] },
    },
  };
};

const SECTORLESS = ["association_nonprofit", "government", "education", "media_news", "research_analyst", "event"] as const;

describe("defaultKindPolicy", () => {
  const STORMWALL = rulesFor(["ISP", "Telecom", "Banking", "E-commerce", "Gaming"]);
  const SAIGON = rulesFor(["Banking", "Healthcare", "Financial services"], { disqualifyServices: true });
  const FINGERMIND = rulesFor(["Aviation", "MRO", "CAMO", "Part 145"]);
  const SOFTWARE_ICP = rulesFor(["SaaS", "Cybersecurity"]);

  it("covers every company kind", () => {
    expect(Object.keys(defaultKindPolicy(STORMWALL)).sort()).toEqual([...COMPANY_KINDS].sort());
  });

  it("accepts operators for every ICP", () => {
    for (const rules of [STORMWALL, SAIGON, FINGERMIND, SOFTWARE_ICP, rulesFor([])]) {
      expect(defaultKindPolicy(rules).operator).toBe("accept");
    }
  });

  it("never rejects a software vendor by default: accepted for a software ICP, otherwise reviewed", () => {
    expect(defaultKindPolicy(FINGERMIND).software_vendor).toBe("review");
    expect(defaultKindPolicy(STORMWALL).software_vendor).toBe("review");
    expect(defaultKindPolicy(rulesFor([])).software_vendor).toBe("review");
    expect(defaultKindPolicy(SOFTWARE_ICP).software_vendor).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Cloud hosting"])).software_vendor).toBe("accept");
  });

  it("services agencies: accepted when the ICP targets services, otherwise reviewed, never rejected by default", () => {
    expect(defaultKindPolicy(rulesFor(["IT services"])).services_agency).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Marketing"])).services_agency).toBe("accept");
    expect(defaultKindPolicy(STORMWALL).services_agency).toBe("review");
    // The services gate in the rules judges a disqualifying policy; the kind alone does not.
    expect(defaultKindPolicy(SAIGON).services_agency).toBe("review");
  });

  it("reviews wholesalers, but rejects them for producer-sector ICPs", () => {
    expect(defaultKindPolicy(STORMWALL).reseller_wholesaler).toBe("review");
    expect(defaultKindPolicy(rulesFor(["FMCG"])).reseller_wholesaler).toBe("reject");
    expect(defaultKindPolicy(rulesFor(["Manufacturing"])).reseller_wholesaler).toBe("reject");
    expect(defaultKindPolicy(rulesFor(["FMCG", "Retail"])).reseller_wholesaler).toBe("review");
  });

  it.each(SECTORLESS)("%s: rejected when the ICP names industries without that sector, reviewed when it names none", (kind) => {
    expect(defaultKindPolicy(STORMWALL)[kind]).toBe("reject");
    expect(defaultKindPolicy(FINGERMIND)[kind]).toBe("reject");
    expect(defaultKindPolicy(rulesFor([]))[kind]).toBe("review");
  });

  it("accepts a sector kind when the ICP targets that sector", () => {
    expect(defaultKindPolicy(rulesFor(["Education"])).education).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Government"])).government).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Media"])).media_news).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Education"])).government).toBe("reject");
  });

  it("does not let a gaming ICP accept a gaming EVENT", () => {
    expect(defaultKindPolicy(rulesFor(["Gaming"])).event).toBe("reject");
  });

  it("marketplaces are e-commerce operators: reviewed for an e-commerce or retail ICP, rejected otherwise", () => {
    expect(defaultKindPolicy(STORMWALL).directory_marketplace_jobboard).toBe("review");
    expect(defaultKindPolicy(rulesFor(["Retail"])).directory_marketplace_jobboard).toBe("review");
    expect(defaultKindPolicy(FINGERMIND).directory_marketplace_jobboard).toBe("reject");
  });
});

describe("resolveKindPolicy", () => {
  const rules = rulesFor(["Banking"]);

  it("uses the default when the run stored no override", () => {
    expect(resolveKindPolicy(null, rules)).toEqual(defaultKindPolicy(rules));
    expect(resolveKindPolicy({ industries: ["Banking"] }, rules)).toEqual(defaultKindPolicy(rules));
    expect(resolveKindPolicy("junk", rules)).toEqual(defaultKindPolicy(rules));
  });

  it("treats a stored kind list as the only kinds to accept; this is the only way a vendor is rejected by kind", () => {
    const policy = resolveKindPolicy({ targetCompanyKinds: ["operator", "services_agency"] }, rules);
    expect(policy.operator).toBe("accept");
    expect(policy.services_agency).toBe("accept");
    expect(policy.software_vendor).toBe("reject");
    expect(policy.reseller_wholesaler).toBe("reject");
  });

  it("ignores unknown kind names and falls back to the default when none are valid", () => {
    expect(resolveKindPolicy({ targetCompanyKinds: ["spaceship", 7] }, rules)).toEqual(defaultKindPolicy(rules));
    expect(resolveKindPolicy({ targetCompanyKinds: [] }, rules)).toEqual(defaultKindPolicy(rules));
  });

  it("merges a per-kind decision map over the defaults", () => {
    const policy = resolveKindPolicy({ targetCompanyKinds: { software_vendor: "accept", operator: "bogus" } }, rules);
    expect(policy.software_vendor).toBe("accept");
    expect(policy.operator).toBe("accept");
    expect(policy.education).toBe("reject");
  });

  it("marks competitor kinds, e.g. agencies for Dpoint or MSPs for 1CloudHub", () => {
    const policy = resolveKindPolicy({ competitorKinds: ["services_agency", "bogus"] }, rules);
    expect(policy.services_agency).toBe("competitor");
    expect(policy.operator).toBe("accept");
    expect(resolveKindPolicy({ competitorKinds: "services_agency" }, rules)).toEqual(defaultKindPolicy(rules));
  });
});
