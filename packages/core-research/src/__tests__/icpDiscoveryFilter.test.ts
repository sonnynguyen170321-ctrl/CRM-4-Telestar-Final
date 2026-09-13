import { describe, expect, it } from "vitest";

import { isCandidateExcludedByIcp } from "../icpDiscoveryFilter";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import type { ParsedCandidate } from "../parseDiscoveryResults";

function company(over: Partial<ParsedCandidate> = {}): ParsedCandidate {
  return {
    kind: "COMPANY", name: "Co", domain: "co.com", linkedinUrl: null, title: null, companyName: null,
    location: null, source: { query: "q", url: "https://co.com", snippet: null, provider: "exa" },
    dedupeFingerprint: "company:co.com", ...over,
  };
}

function icp(over: (r: ReturnType<typeof emptyIcpRulesV2>) => void) {
  const r = emptyIcpRulesV2("t", "t");
  over(r);
  return r;
}

describe("isCandidateExcludedByIcp", () => {
  it("excludes a services/consulting company when the ICP opts in", () => {
    const rules = icp((r) => { r.companyType.servicesConsultingPolicy.disqualify = true; });
    const c = company({ name: "BrightConsulting", source: { query: "q", url: "https://x.com", snippet: "outsourced managed services agency", provider: "exa" } });
    expect(isCandidateExcludedByIcp(c, rules)).toEqual({ excluded: true, reason: "services_consulting_based" });
  });

  it("does NOT exclude a real SaaS company", () => {
    const rules = icp((r) => { r.companyType.servicesConsultingPolicy.disqualify = true; });
    const c = company({ name: "Rippling", source: { query: "q", url: "https://rippling.com", snippet: "B2B SaaS cloud platform", provider: "exa" } });
    expect(isCandidateExcludedByIcp(c, rules).excluded).toBe(false);
  });

  it("respects opt-in: services company passes when the policy is off", () => {
    const rules = emptyIcpRulesV2("t", "t"); // servicesConsultingPolicy.disqualify defaults false
    const c = company({ source: { query: "q", url: "https://x.com", snippet: "management consulting firm", provider: "exa" } });
    expect(isCandidateExcludedByIcp(c, rules).excluded).toBe(false);
  });

  it("honours exceptMarkets", () => {
    const rules = icp((r) => { r.companyType.servicesConsultingPolicy = { disqualify: true, exceptMarkets: ["healthcare"] }; });
    const c = company({ source: { query: "q", url: "https://x.com", snippet: "healthcare consulting services", provider: "exa" } });
    expect(isCandidateExcludedByIcp(c, rules).excluded).toBe(false);
  });

  it("excludes an explicitly excluded industry", () => {
    const rules = icp((r) => { r.industry.excludedIndustries = ["gambling"]; });
    const c = company({ source: { query: "q", url: "https://x.com", snippet: "online gambling platform", provider: "exa" } });
    expect(isCandidateExcludedByIcp(c, rules)).toEqual({ excluded: true, reason: "excluded_industry" });
  });

  it("excludes a competitor by domain or name", () => {
    const rules = icp((r) => { r.disqualifiers.competitorDenylist = ["hubspot"]; });
    expect(isCandidateExcludedByIcp(company({ domain: "hubspot.com" }), rules).reason).toBe("competitor_denylist");
  });

  it("does not exclude on empty rules / empty text", () => {
    expect(isCandidateExcludedByIcp(company(), emptyIcpRulesV2("t", "t")).excluded).toBe(false);
  });

  it("word-boundary: does not fire inside an unrelated word", () => {
    const rules = icp((r) => { r.industry.excludedIndustries = ["art"]; });
    const c = company({ name: "Smart Analytics", source: { query: "q", url: "https://x.com", snippet: "smart data platform", provider: "exa" } });
    expect(isCandidateExcludedByIcp(c, rules).excluded).toBe(false); // "art" not matched inside "smart"
  });
});
