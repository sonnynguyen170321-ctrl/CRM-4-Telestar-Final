import { describe, expect, it } from "vitest";
import { assessIcpRulesV2 } from "@telestar/core-scoring/rules/deriveQualification";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";

import { calculateEngagement } from "@/lib/leads/scoring";
import {
  canManageScoring,
  canManageScoringRequest,
} from "@/lib/leads/scoringAccess";
import { deriveIcpMatch } from "@/lib/leadgen/icpMatch";
import { deriveSimpleIcpQualification } from "@/lib/leadgen/scorePoolItem";

describe("simple engagement contract", () => {
  it("uses meeting, reply, opens, then cold as an explicit precedence ladder", () => {
    expect(
      calculateEngagement({
        meetingCount: 1,
        emailReplyCount: 2,
        emailOpenCount: 4,
      }),
    ).toMatchObject({
      score: 100,
      priority: "hot",
      reason: "meeting_booked",
    });
    expect(
      calculateEngagement({ emailReplyCount: 1, emailOpenCount: 4 }),
    ).toMatchObject({
      score: 80,
      priority: "hot",
      reason: "reply_received",
    });
    expect(calculateEngagement({ emailOpenCount: 9 })).toMatchObject({
      score: 40,
      priority: "warm",
      reason: "email_opened",
    });
    expect(calculateEngagement({ emailOpenCount: 0 })).toMatchObject({
      score: 0,
      priority: "cold",
      reason: "no_engagement",
    });
  });

  it("does not treat title or contact quality as engagement", () => {
    expect(
      calculateEngagement({
        title: "Chief Executive Officer",
        phone: "+84 900 000 000",
        emailValidation: "valid",
        emailOpenCount: 0,
        emailReplyCount: 0,
        meetingCount: 0,
      }),
    ).toEqual({
      score: 0,
      priority: "cold",
      reason: "no_engagement",
      breakdown: [],
    });
  });
});

describe("simple campaign ICP Match contract", () => {
  it("maps the immutable assessment verdict to three manager-facing labels", () => {
    expect(
      deriveIcpMatch({
        qualification: "qualified",
        assessedIcpVersionId: "v1",
        currentIcpVersionId: "v1",
      }),
    ).toEqual({ label: "fit", reason: "qualified" });
    expect(
      deriveIcpMatch({
        qualification: "needs_review",
        assessedIcpVersionId: "v1",
        currentIcpVersionId: "v1",
      }),
    ).toEqual({ label: "review", reason: "needs_review" });
    expect(
      deriveIcpMatch({
        qualification: "unqualified",
        assessedIcpVersionId: "v1",
        currentIcpVersionId: "v1",
      }),
    ).toEqual({ label: "no_fit", reason: "unqualified" });
  });

  it("fails safely to Review when evidence is absent or the campaign ICP changed", () => {
    expect(
      deriveIcpMatch({
        qualification: null,
        assessedIcpVersionId: null,
        currentIcpVersionId: "v1",
      }),
    ).toEqual({ label: "review", reason: "not_scored" });
    expect(
      deriveIcpMatch({
        qualification: "qualified",
        assessedIcpVersionId: "v1",
        currentIcpVersionId: "v2",
      }),
    ).toEqual({ label: "review", reason: "stale_assessment" });
    expect(
      deriveIcpMatch({
        qualification: "qualified",
        assessedIcpVersionId: "v1",
        currentIcpVersionId: null,
      }),
    ).toEqual({ label: "review", reason: "no_campaign_icp" });
  });
});

describe("scoring management access", () => {
  it("allows the four manager roles and keeps individual contributors read-only", () => {
    expect(
      ["team_lead", "floor_manager", "director", "leadgen_manager"].every(
        (role) => canManageScoring(role as never),
      ),
    ).toBe(true);
    expect(canManageScoring("sdr")).toBe(false);
    expect(canManageScoring("leadgen")).toBe(false);
  });

  it("requires API keys to carry the explicit scoring write scope", () => {
    const manager = {
      id: "manager",
      email: "manager@example.test",
      firstName: "Test",
      lastName: "Manager",
      role: "floor_manager" as const,
      tenantId: "tenant-a",
    };

    expect(canManageScoringRequest(manager)).toBe(true);
    expect(
      canManageScoringRequest({
        ...manager,
        apiKey: { id: "low", name: "Read only", scopes: ["leads:read"] },
      }),
    ).toBe(false);
    expect(
      canManageScoringRequest({
        ...manager,
        apiKey: {
          id: "write",
          name: "Scoring automation",
          scopes: ["scoring:write"],
        },
      }),
    ).toBe(true);
    expect(
      canManageScoringRequest({
        ...manager,
        apiKey: { id: "wildcard", name: "Admin", scopes: ["*"] },
      }),
    ).toBe(true);
    expect(
      canManageScoringRequest({
        ...manager,
        role: "sdr",
        apiKey: { id: "sdr", name: "Wrong role", scopes: ["scoring:write"] },
      }),
    ).toBe(false);
  });
});
describe("simple must-have ICP qualification", () => {
  const rules = (() => {
    const value = emptyIcpRulesV2("simple-contract", "Simple contract");
    value.industry = {
      ...value.industry,
      mode: "allowlist",
      targetIndustries: ["software"],
    };
    return value;
  })();

  const evidence = (industry?: string, rawTitle: string | null = "CEO") => ({
    company: {
      companyName: "Acme",
      industry,
      websiteStatus: "reachable" as const,
    },
    contact: rawTitle
      ? { rawTitle, email: "ceo@acme.test" }
      : { email: "ceo@acme.test" },
  });

  it("uses known mismatch -> No fit, missing evidence -> Review, all pass -> Fit", () => {
    for (const [industry, expected] of [
      ["Mining", "unqualified"],
      [undefined, "needs_review"],
      ["Software", "qualified"],
    ] as const) {
      const input = evidence(industry);
      expect(
        deriveSimpleIcpQualification(
          assessIcpRulesV2(input, rules),
          rules,
          input,
        ),
      ).toBe(expected);
    }
  });

  it("does not let a soft industry keyword override a hard allowlist mismatch", () => {
    const keywordRules = {
      ...rules,
      industry: {
        ...rules.industry,
        industryKeywords: ["automation"],
      },
    };
    const input = {
      ...evidence("Mining"),
      company: {
        ...evidence("Mining").company,
        description: "Workflow automation platform",
      },
    };
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(input, keywordRules),
        keywordRules,
        input,
      ),
    ).toBe("unqualified");
  });
  it("requires evidence for configured persona must-haves", () => {
    const personaRules = {
      ...rules,
      persona: {
        ...rules.persona,
        titleAllowlist: ["CEO"],
        departmentAllowlist: ["SALES" as const],
      },
    };

    const missingTitle = evidence("Software", null);
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(missingTitle, personaRules),
        personaRules,
        missingTitle,
      ),
    ).toBe("needs_review");

    const departmentRules = {
      ...rules,
      persona: {
        ...rules.persona,
        departmentAllowlist: ["SALES" as const],
      },
    };
    const unknownDepartment = evidence("Software", "Manager");
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(unknownDepartment, departmentRules),
        departmentRules,
        unknownDepartment,
      ),
    ).toBe("needs_review");
  });

  it("treats unknown seniority as Review and a known lower title as No fit", () => {
    const seniorityRules = {
      ...rules,
      persona: {
        ...rules.persona,
        seniorityFloor: "MANAGER" as const,
      },
    };
    const unknownSeniority = evidence("Software", "Strategic Wizard");
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(unknownSeniority, seniorityRules),
        seniorityRules,
        unknownSeniority,
      ),
    ).toBe("needs_review");

    const knownLowerSeniority = evidence("Software", "Software Engineer");
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(knownLowerSeniority, seniorityRules),
        seniorityRules,
        knownLowerSeniority,
      ),
    ).toBe("unqualified");
  });

  it("requires title evidence even when persona only defines exclusions", () => {
    const exclusionRules = emptyIcpRulesV2(
      "negative-persona-contract",
      "Negative persona contract",
    );
    exclusionRules.persona.titleDenylist = ["intern"];

    const missingTitle = evidence("Software", null);
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(missingTitle, exclusionRules),
        exclusionRules,
        missingTitle,
      ),
    ).toBe("needs_review");

    const knownSafeTitle = evidence("Software", "CEO");
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(knownSafeTitle, exclusionRules),
        exclusionRules,
        knownSafeTitle,
      ),
    ).toBe("qualified");
  });

  it("requires industry evidence even when industry only defines exclusions", () => {
    const exclusionRules = emptyIcpRulesV2(
      "negative-industry-contract",
      "Negative industry contract",
    );
    exclusionRules.industry.excludedIndustries = ["gambling"];

    const missingIndustry = evidence(undefined);
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(missingIndustry, exclusionRules),
        exclusionRules,
        missingIndustry,
      ),
    ).toBe("needs_review");

    const knownSafeIndustry = evidence("Software");
    expect(
      deriveSimpleIcpQualification(
        assessIcpRulesV2(knownSafeIndustry, exclusionRules),
        exclusionRules,
        knownSafeIndustry,
      ),
    ).toBe("qualified");
  });
  it("does not let weighted thresholds override passed must-haves", () => {
    const extremeThresholds = {
      ...rules,
      scorePolicy: { ...rules.scorePolicy, qualifiedMinFitScore: 100 },
      confidencePolicy: {
        ...rules.confidencePolicy,
        highConfidenceThreshold: 100,
      },
    };
    const input = evidence("Software");
    const assessed = assessIcpRulesV2(input, extremeThresholds);
    expect(assessed.qualification).not.toBe("QUALIFIED");
    expect(
      deriveSimpleIcpQualification(assessed, extremeThresholds, input),
    ).toBe("qualified");
  });
});
