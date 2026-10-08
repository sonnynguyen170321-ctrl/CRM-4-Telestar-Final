import { describe, expect, it } from "vitest";

import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import { defaultKindPolicy, resolveKindPolicy } from "../targetPolicy";
import { COMPANY_KINDS } from "../verificationTypes";

/**
 * "Is this the sort of company the ICP wants?" decided on the company's KIND, before any score.
 * Production returned schools, analyst firms, job boards and software vendors for operator ICPs
 * (owner report, 2026-10-08); a score cannot tell a bank from the association of banks.
 */

const rulesFor = (
  targets: string[],
  over: { disqualifyServices?: boolean; exceptMarkets?: string[] } = {},
): IcpVersionRulesV2 => {
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

  it("rejects software vendors unless the ICP targets software-side industries", () => {
    expect(defaultKindPolicy(FINGERMIND).software_vendor).toBe("reject");
    expect(defaultKindPolicy(STORMWALL).software_vendor).toBe("reject");
    expect(defaultKindPolicy(SOFTWARE_ICP).software_vendor).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Cloud hosting"])).software_vendor).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["IT services"])).software_vendor).toBe("accept");
  });

  it("sends vendors to review, not rejection, when the ICP names no industry at all", () => {
    // Nothing says whether a vendor is wanted; a person decides rather than the engine guessing.
    expect(defaultKindPolicy(rulesFor([])).software_vendor).toBe("review");
  });

  it("rejects services agencies when the ICP disqualifies them, accepts them when it targets services", () => {
    expect(defaultKindPolicy(SAIGON).services_agency).toBe("reject");
    expect(defaultKindPolicy(rulesFor(["IT services"])).services_agency).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Marketing"])).services_agency).toBe("accept");
    expect(defaultKindPolicy(STORMWALL).services_agency).toBe("review");
  });

  it("only reviews a disqualified services agency when an exception market exists", () => {
    expect(defaultKindPolicy(rulesFor(["Banking"], { disqualifyServices: true, exceptMarkets: ["Vietnam"] })).services_agency).toBe(
      "review",
    );
  });

  it("reviews wholesalers, but rejects them for producer-sector ICPs", () => {
    expect(defaultKindPolicy(STORMWALL).reseller_wholesaler).toBe("review");
    expect(defaultKindPolicy(rulesFor(["FMCG"])).reseller_wholesaler).toBe("reject");
    expect(defaultKindPolicy(rulesFor(["Manufacturing"])).reseller_wholesaler).toBe("reject");
    expect(defaultKindPolicy(rulesFor(["FMCG", "Retail"])).reseller_wholesaler).toBe("review");
  });

  it.each(["association_nonprofit", "government", "education", "media_news", "directory_marketplace_jobboard", "research_analyst", "event"] as const)(
    "rejects %s for an operator ICP",
    (kind) => {
      expect(defaultKindPolicy(STORMWALL)[kind]).toBe("reject");
      expect(defaultKindPolicy(FINGERMIND)[kind]).toBe("reject");
    },
  );

  it("accepts a sector kind only when the ICP targets that sector", () => {
    expect(defaultKindPolicy(rulesFor(["Education"])).education).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Government"])).government).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Media"])).media_news).toBe("accept");
    expect(defaultKindPolicy(rulesFor(["Education"])).government).toBe("reject");
  });

  it("does not let a gaming ICP accept a gaming EVENT", () => {
    // 'Kingdom of Gaming' is a conference. Its industry text says gaming; its kind says event.
    expect(defaultKindPolicy(rulesFor(["Gaming"])).event).toBe("reject");
  });
});

describe("resolveKindPolicy", () => {
  const rules = rulesFor(["Banking"]);

  it("uses the default when the run stored no override", () => {
    expect(resolveKindPolicy(null, rules)).toEqual(defaultKindPolicy(rules));
    expect(resolveKindPolicy({ industries: ["Banking"] }, rules)).toEqual(defaultKindPolicy(rules));
    expect(resolveKindPolicy("junk", rules)).toEqual(defaultKindPolicy(rules));
  });

  it("treats a stored kind list as the only kinds to accept", () => {
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
});
