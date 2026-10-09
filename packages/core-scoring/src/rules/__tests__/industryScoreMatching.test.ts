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

// The live "Telestar v2" ICP targets ["Tech", "Software", "SaaS"] and excludes ["service", "bpo",
// "consultant"]. v1 matched "Tech" by substring; whole-word matching needs the shorthand family.
describe("ICP shorthand: 'Tech' / 'Technology' / 'IT' name a family of industries", () => {
  const telestarV2 = { targetIndustries: ["Tech", "Software", "SaaS"], excludedIndustries: ["service", "bpo", "consultant"] };
  const ids = (industry: string, rulesIn: Partial<Industry> = telestarV2) =>
    score({ industry }, rulesIn).hits.map((h) => h.id);

  it.each(["Computer Software", "Software Development", "Computer & Network Security", "Data Security Software Products", "Cloud hosting"])(
    "'Tech' admits %s",
    (industry) => {
      expect(ids(industry, { targetIndustries: ["Tech"] })).toContain("industry_allowlist_match");
    }
  );

  it.each(["Biotechnology", "Financial Services", "Retail", "Hospital & Health Care"])("'Tech' does not admit %s", (industry) => {
    expect(ids(industry, { targetIndustries: ["Tech"] })).not.toContain("industry_allowlist_match");
  });

  it("'IT' and 'Technology' work the same way; a longer phrase is not shorthand", () => {
    expect(ids("Computer and Network Security", { targetIndustries: ["IT"] })).toContain("industry_allowlist_match");
    expect(ids("Computer Software", { targetIndustries: ["Technology"] })).toContain("industry_allowlist_match");
    expect(ids("Computer Software", { targetIndustries: ["Tech consulting"] })).not.toContain("industry_allowlist_match");
  });

  it("the live ICP keeps its v1 exclusions: '…& services' labels are still excluded", () => {
    expect(ids("Information Technology & Services")).toContain("industry_excluded");
    expect(ids("Financial Services")).toContain("industry_excluded");
    expect(ids("Computer Software")).not.toContain("industry_excluded");
  });

  it("an excluded 'Tech' excludes the family by the company's own key", () => {
    expect(ids("Computer Software", { excludedIndustries: ["Tech"] })).toContain("industry_excluded");
    expect(ids("Retail", { excludedIndustries: ["Tech"] })).not.toContain("industry_excluded");
  });
});

// Reviewer finding M1: stems an operator types ("tech", "health", "finance", "educat", "security")
// must keep reaching the words they abbreviate, in lists and in keywords.
describe("stems in ICP lists and keywords", () => {
  const allow = (description: string, targetIndustries: string[], industry = "Other") =>
    score({ industry, description }, { targetIndustries }).hits.map((h) => h.id);

  it.each([
    ["Technology consulting for retailers", "tech"],
    ["A healthcare staffing platform", "health"],
    ["Financial planning for families", "finance"],
    ["Educational content for schools", "educat"],
  ])("'%s' is admitted by target %s", (description, target) => {
    expect(allow(description, [target])).toContain("industry_allowlist_match");
  });

  it("'security' reaches a cybersecurity company through its key, not mid-word text", () => {
    expect(allow("", ["security"], "Computer & Network Security")).toContain("industry_allowlist_match");
    expect(allow("Cybersecurity awareness posters", ["security"], "Printing Services")).not.toContain("industry_allowlist_match");
  });

  it("keywords get the same rules plus the canonical rescue", () => {
    const kw = (industry: string, description: string, industryKeywords: string[]) =>
      score({ industry, description }, { mode: "all", industryKeywords }).score;
    expect(kw("Marketing Services", "Healthcare brands", ["health"])).toBe(90);
    expect(kw("SaaS", "Billing platform", ["Tech"])).toBe(90);
    expect(kw("Marketing Services", "Email for airlines", ["AI"])).toBe(80);
  });
});

