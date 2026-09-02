import { describe, expect, it } from "vitest";

import { mapIntelligenceProfileToScoring } from "../mapIntelligenceProfileToScoring";

const FACTS = ["category.cybersecurity", "offering.saas", "size.employee_count_31", "geo.hq_country_israel"];

function run(pagesWithContent: number | undefined) {
  return mapIntelligenceProfileToScoring({
    profileId: "p1",
    researchVersion: 3,
    profileStatus: "PARTIAL",
    factsJson: FACTS,
    sourceCoverageJson: pagesWithContent === undefined ? {} : { pagesWithContent },
    confidenceJson: { band: "MEDIUM", evidenceConfidence: 0.6, hasUsableEvidence: true },
  });
}

describe("mapIntelligenceProfileToScoring — SERP-only gate (W2)", () => {
  it("scores the classification facts when the website had content", () => {
    const { trace, companyEvidence } = run(3);
    expect(trace.controlledTokens).toContain("category.cybersecurity");
    expect(trace.controlledTokens).toContain("offering.saas");
    // the identity claim reaches the scored evidence text (what the industry dimension matches on)
    expect((companyEvidence.evidenceText ?? "").toLowerCase()).toContain("cybersecurity");
  });

  it("DROPS identity/classification facts from scoring when pagesWithContent === 0", () => {
    const { trace, companyEvidence } = run(0);
    // the SERP-guessed identity claims must not be scored...
    expect(trace.controlledTokens).not.toContain("category.cybersecurity");
    expect(trace.controlledTokens).not.toContain("offering.saas");
    expect((companyEvidence.evidenceText ?? "").toLowerCase()).not.toContain("cybersecurity");
    // ...but non-identity facts (size, geo) are kept
    expect(trace.controlledTokens).toContain("size.employee_count_31");
    expect(trace.controlledTokens).toContain("geo.hq_country_israel");
  });

  it("does NOT gate when pagesWithContent is absent (unknown, not an explicit 0)", () => {
    const { trace } = run(undefined);
    expect(trace.controlledTokens).toContain("category.cybersecurity");
  });
});
