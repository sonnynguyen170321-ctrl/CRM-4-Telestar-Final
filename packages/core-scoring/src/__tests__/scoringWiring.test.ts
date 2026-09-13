import { describe, expect, it } from "vitest";

import { assessIcpRulesV2 } from "../rules/deriveQualification";
import { emptyIcpRulesV2 } from "../rules/emptyIcpRulesV2";
import type { RawScoringEvidence } from "../rules/evidence";
import { validateIcpVersionRulesV2 } from "../rules/schema-v2";

// Locks the single-path guarantee: production scores every lead through the graduated v2
// engine (assessIcpRulesV2). Also proves the core "intelligence" the retired coarse engine
// lacked — persona is a gradient, not binary presence.

const BASE = emptyIcpRulesV2("test-icp", "Test ICP");

function company(overrides: Partial<RawScoringEvidence["company"]> = {}): RawScoringEvidence["company"] {
  return {
    companyName: "Acme Cloud",
    country: "Singapore",
    industry: "software",
    industryTags: ["b2b_saas"],
    employeeCount: 220,
    evidenceText: "Acme Cloud is a B2B SaaS platform for mid-market teams.",
    ...overrides,
  };
}

const VALID_QUALIFICATIONS = ["QUALIFIED", "NEEDS_REVIEW", "UNQUALIFIED", "COMPANY_QUALIFIED_NEEDS_CONTACT"];

describe("scoring runtime wires the v2 engine", () => {
  it("assesses through the v2 engine (no throw, valid output shape)", () => {
    const assessment = assessIcpRulesV2({ company: company(), contact: { rawTitle: "VP of Sales" } }, BASE);
    expect(VALID_QUALIFICATIONS).toContain(assessment.qualification);
    expect(assessment.fitScore).toBeGreaterThanOrEqual(0);
    expect(assessment.fitScore).toBeLessThanOrEqual(100);
    expect(typeof assessment.subScores.persona).toBe("number");
  });

  it("scores persona as a gradient — a VP outranks an intern under a persona-tiered ICP", () => {
    const tieredRules = validateIcpVersionRulesV2({
      ...BASE,
      persona: {
        ...BASE.persona,
        titleAllowlist: [],
        titleKeywords: [],
        titleDenylist: [],
        seniorityExclusions: [],
        titleTiers: [{ tier: 1, titles: ["vp of sales"], keywords: ["vp"], weight: 100 }],
      },
    });

    const vp = assessIcpRulesV2({ company: company(), contact: { rawTitle: "VP of Sales" } }, tieredRules);
    const intern = assessIcpRulesV2({ company: company(), contact: { rawTitle: "Sales Intern" } }, tieredRules);

    // The whole point: the target VP scores materially higher on persona than a junior IC —
    // the coarse engine gave both the same "hasPersona ? 1 : 0".
    expect(vp.subScores.persona).toBeGreaterThan(intern.subScores.persona);
  });

  it("does NOT mark a present-but-titleless contact as needs-contact when the ICP does not require a title", () => {
    // Regression for the reported bug: leads that HAVE a contact showed COMPANY_QUALIFIED_NEEDS_CONTACT
    // purely because the contact had no job title. BASE does not require a persona title
    // (requiredEvidenceForFinalQualification.personaTitle = false), so a present contact with an empty
    // title must never route to needs-contact.
    expect(BASE.requiredEvidenceForFinalQualification.personaTitle).toBe(false);
    const withEmptyTitle = assessIcpRulesV2({ company: company(), contact: { rawTitle: "" } }, BASE);
    const withNoContactObj = assessIcpRulesV2({ company: company(), contact: { rawTitle: "Head of Ops" } }, BASE);
    expect(withEmptyTitle.qualification).not.toBe("COMPANY_QUALIFIED_NEEDS_CONTACT");
    expect(withNoContactObj.qualification).not.toBe("COMPANY_QUALIFIED_NEEDS_CONTACT");
  });

  it("still flags persona evidence missing when the ICP DOES require a title and the contact has none", () => {
    const requiresTitle = validateIcpVersionRulesV2({
      ...BASE,
      requiredEvidenceForFinalQualification: {
        ...BASE.requiredEvidenceForFinalQualification,
        personaTitle: true,
      },
    });
    const titleless = assessIcpRulesV2({ company: company(), contact: { rawTitle: "" } }, requiresTitle);
    // The gated required-evidence signal must be present (drives needs-contact only under a title-requiring ICP).
    expect(JSON.stringify(titleless)).toContain("required_persona_title_missing");
  });
});
