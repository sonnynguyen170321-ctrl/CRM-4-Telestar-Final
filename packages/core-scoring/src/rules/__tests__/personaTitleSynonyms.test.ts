import { describe, expect, it } from "vitest";

import { assessIcpRulesV2 } from "../deriveQualification";
import { emptyIcpRulesV2 } from "../emptyIcpRulesV2";
import { expandTitleSynonyms } from "../dimensions/personaScore";
import type { RawScoringEvidence } from "../evidence";

// Uploaded lists and authored ICPs mix "CEO" with "Chief Executive Officer". titleMatches treats a
// 2-4 char entry as an exact token, so "ceo" used to miss every spelled-out C-level title (and a
// spelled-out entry could not match "CEO"). Persona is weighted 30/100, so each miss cost ~13 fit
// points — enough to drop a lead below the qualified cutoff.

function icpWith(titleKeywords: string[]) {
  const base = emptyIcpRulesV2("t-icp", "Test ICP");
  return { ...base, persona: { ...base.persona, titleKeywords } };
}

const company: RawScoringEvidence["company"] = {
  companyName: "Acme Foods",
  country: "Vietnam",
  industry: "Food & Beverages",
  employeeCount: 500,
  websiteStatus: "reachable",
};

const fit = (rawTitle: string, keywords: string[]) =>
  assessIcpRulesV2({ company, contact: { rawTitle } }, icpWith(keywords)).fitScore;

describe("persona title synonyms", () => {
  it("expands an abbreviation into its spelled-out form and vice versa", () => {
    expect(expandTitleSynonyms("chief executive officer")).toContain("ceo");
    expect(expandTitleSynonyms("ceo")).toContain("chief executive officer");
    // additive — the original text is never lost
    expect(expandTitleSynonyms("ceo")).toContain("ceo");
  });

  it("an abbreviated ICP keyword matches a spelled-out title", () => {
    expect(fit("Chief Executive Officer", ["ceo"])).toBe(fit("CEO", ["ceo"]));
  });

  it("a spelled-out ICP keyword matches an abbreviated title", () => {
    expect(fit("CEO", ["chief executive officer"])).toBe(
      fit("Chief Executive Officer", ["chief executive officer"])
    );
  });

  it("covers the other C-level + seniority abbreviations", () => {
    for (const [abbr, phrase] of [
      ["cto", "Chief Technology Officer"],
      ["cfo", "Chief Financial Officer"],
      ["coo", "Chief Operating Officer"],
      ["cio", "Chief Information Officer"],
      ["cmo", "Chief Marketing Officer"],
      ["md", "Managing Director"],
      ["vp", "Vice President"],
    ] as const) {
      expect(fit(phrase, [abbr])).toBe(fit(abbr.toUpperCase(), [abbr]));
    }
  });

  it("does not make unrelated titles match", () => {
    expect(fit("Warehouse Operative", ["ceo"])).toBeLessThan(fit("CEO", ["ceo"]));
    expect(expandTitleSynonyms("warehouse operative")).toBe("warehouse operative");
  });
});
