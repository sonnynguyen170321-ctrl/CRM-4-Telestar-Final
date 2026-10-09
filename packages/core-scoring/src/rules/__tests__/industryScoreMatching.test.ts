import { describe, expect, it } from "vitest";

import { industryScore } from "../dimensions/industryScore";
import { emptyIcpRulesV2 } from "../emptyIcpRulesV2";
import type { RawScoringEvidence } from "../evidence";
import { normalizeEvidence } from "../normalize/index";
import type { IcpVersionRulesV2 } from "../schema-v2";

// industry-v2 (2026-10-10): ICP industry entries match whole words, and an entry that names a
// canonical industry matches companies of that industry. v1 compared by substring, so an ICP
// targeting "ISP" matched any company whose description said "display", and an excluded "bet"
// zeroed every company that mentioned "alphabet".

type Industry = IcpVersionRulesV2["industry"];

function rules(industry: Partial<Industry>): IcpVersionRulesV2 {
  const base = emptyIcpRulesV2("t-icp", "Industry matching");
  return { ...base, industry: { ...base.industry, mode: "allowlist", ...industry } };
}

function score(company: Partial<RawScoringEvidence["company"]>, industry: Partial<Industry>) {
  const evidence = normalizeEvidence({ company: { companyName: "Acme", ...company } });
  return industryScore(evidence, rules(industry));
}

describe("industry allow/deny lists match whole words", () => {
  it("a target does not match inside another word in the evidence", () => {
    const result = score(
      { industry: "Advertising Services", description: "We sell display ads on digital signage." },
      { targetIndustries: ["ISP"] }
    );
    expect(result.hits.map((h) => h.id)).not.toContain("industry_allowlist_match");
  });

  it("a target still matches as a word, including its plural", () => {
    const result = score(
      { industry: "Telecommunications", description: "Wholesale capacity for regional ISPs." },
      { targetIndustries: ["ISP"] }
    );
    expect(result.hits.map((h) => h.id)).toContain("industry_allowlist_match");
  });

  it("an exclusion does not fire inside another word", () => {
    const result = score(
      { industry: "Software Development", description: "Alphabetical indexing for better search." },
      { targetIndustries: ["Software"], excludedIndustries: ["bet"] }
    );
    expect(result.hits.map((h) => h.id)).not.toContain("industry_excluded");
    expect(result.score).toBeGreaterThan(0);
  });

  it("an exclusion still fires on the word itself", () => {
    const result = score(
      { industry: "Entertainment", description: "Sports bet exchange." },
      { excludedIndustries: ["bet"] }
    );
    expect(result.hits.map((h) => h.id)).toContain("industry_excluded");
    expect(result.score).toBe(0);
  });

  it("an industry keyword is a word, not a substring ('AI' is not in 'email')", () => {
    const withoutAi = score({ industry: "Marketing Services", description: "Email campaigns to maintain retention." }, {
      mode: "all",
      industryKeywords: ["AI"],
    });
    const withAi = score({ industry: "Marketing Services", description: "AI copywriting for email campaigns." }, {
      mode: "all",
      industryKeywords: ["AI"],
    });
    expect(withoutAi.score).toBe(80);
    expect(withAi.score).toBe(90);
  });
});

describe("industry lists understand canonical industries", () => {
  it("a target naming a key matches a company of that key ('Bank' → BANKING)", () => {
    const result = score({ industry: "Banking" }, { targetIndustries: ["Bank"] });
    expect(result.hits.map((h) => h.id)).toContain("industry_allowlist_match");
  });

  it("a target naming a parent matches the child ('IT services' admits a cybersecurity vendor)", () => {
    const result = score({ industry: "Computer and Network Security" }, { targetIndustries: ["IT services"] });
    expect(result.hits.map((h) => h.id)).toContain("industry_allowlist_match");
  });

  it("an exclusion naming a parent does NOT exclude the child", () => {
    // Excluding IT services (outsourcers) must not zero every cybersecurity product company.
    const result = score({ industry: "Computer and Network Security" }, { excludedIndustries: ["IT services"] });
    expect(result.hits.map((h) => h.id)).not.toContain("industry_excluded");
  });

  it("an exclusion naming the company's own key does exclude it", () => {
    // "Clinics" is not in the text; it canonicalises to HEALTHCARE, the company's own key.
    const result = score({ industry: "Hospitals and Health Care" }, { excludedIndustries: ["Clinics"] });
    expect(result.hits.map((h) => h.id)).toContain("industry_excluded");
  });
});
