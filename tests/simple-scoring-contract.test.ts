import { describe, expect, it } from "vitest";
import { assessIcpRulesV2 } from "@telestar/core-scoring/rules/deriveQualification";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";

import { calculateEngagement } from "@/lib/leads/scoring";
import {
  canManageScoring,
  canManageScoringRequest,
} from "@/lib/leads/scoringAccess";
import { deriveIcpMatch } from "@/lib/leadgen/icpMatch";
import { deriveWeightedIcpQualification } from "@/lib/leadgen/weightedQualification";

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
describe("weighted ICP qualification", () => {
  // Replaced the "simple must-have" contract, whose rule was that any single mismatch is No fit.
  // The owner's report (2026-10-02): "mất 1 element là unqualify luôn" — and their decision was
  // weighted points with only the disqualifiers fatal. Cases whose expected verdict changed say so.
  const verdictOf = (
    input: Parameters<typeof assessIcpRulesV2>[0],
    ruleSet: Parameters<typeof assessIcpRulesV2>[1],
  ) => deriveWeightedIcpQualification(assessIcpRulesV2(input, ruleSet), ruleSet, input);

  const rules = (() => {
    const value = emptyIcpRulesV2("weighted-contract", "Weighted contract");
    value.industry = {
      ...value.industry,
      mode: "allowlist",
      targetIndustries: ["software"],
    };
    return value;
  })();

  const evidence = (industry?: string, rawTitle: string | null = "CEO", email = "ceo@acme.test") => ({
    company: {
      companyName: "Acme",
      industry,
      websiteStatus: "reachable" as const,
    },
    contact: rawTitle ? { rawTitle, email } : { email },
  });

  it("scores a clear miss No fit, missing data Review, and a match Fit", () => {
    for (const [industry, expected] of [
      ["Mining", "unqualified"],
      [undefined, "needs_review"],
      ["Software", "qualified"],
    ] as const) {
      expect(verdictOf(evidence(industry), rules).qualification).toBe(expected);
    }
  });

  it("averages only the dimensions the ICP constrains — a perfect lead is not dragged under the bar", () => {
    // The engine's own fitScore counts unconstrained dimensions at a neutral 60-70; under an ICP
    // that only names an industry a perfect lead came out at 69, below the 75 the policy asks for.
    const verdict = verdictOf(evidence("Software"), rules);
    expect(verdict.scoredDimensions).toEqual(["industry"]);
    expect(verdict.fitScore).toBeGreaterThanOrEqual(95);
  });

  it("CHANGED: a soft keyword hit on an allowlist miss is Review, not No fit", () => {
    const keywordRules = {
      ...rules,
      industry: { ...rules.industry, industryKeywords: ["automation"] },
    };
    const input = {
      ...evidence("Mining"),
      company: { ...evidence("Mining").company, description: "Workflow automation platform" },
    };
    expect(verdictOf(input, keywordRules).qualification).toBe("needs_review");
  });

  it("sends a missing title to Review when the ICP names buyer titles", () => {
    const personaRules = {
      ...rules,
      persona: { ...rules.persona, titleAllowlist: ["CEO"] },
    };
    const verdict = verdictOf(evidence("Software", null), personaRules);
    expect(verdict.qualification).toBe("needs_review");
    expect(verdict.missingCoreEvidence).toEqual(["persona"]);
  });

  it("CHANGED: one off-target title is Review, not No fit — the points decide", () => {
    const seniorityRules = {
      ...rules,
      persona: { ...rules.persona, seniorityFloor: "MANAGER" as const },
    };
    expect(verdictOf(evidence("Software", "Software Engineer"), seniorityRules).qualification).toBe("needs_review");
  });

  it("keeps an explicit exclusion fatal: a denied title is No fit however good the rest is", () => {
    const exclusionRules = emptyIcpRulesV2("negative-persona-contract", "Negative persona contract");
    exclusionRules.persona.titleDenylist = ["intern"];

    expect(verdictOf(evidence("Software", "Marketing Intern"), exclusionRules).qualification).toBe("unqualified");
    expect(verdictOf(evidence("Software", null), exclusionRules).qualification).toBe("needs_review");
    // Nothing positive to score and every exclusion passed.
    const pass = verdictOf(evidence("Software", "CEO"), exclusionRules);
    expect(pass.qualification).toBe("qualified");
    expect(pass.reason).toBe("exclusions_only_passed");
  });

  it("keeps an excluded industry fatal, and asks for industry data before passing it", () => {
    const exclusionRules = emptyIcpRulesV2("negative-industry-contract", "Negative industry contract");
    exclusionRules.industry.excludedIndustries = ["gambling"];

    expect(verdictOf(evidence("Gambling"), exclusionRules).qualification).toBe("unqualified");
    expect(verdictOf(evidence(undefined), exclusionRules).qualification).toBe("needs_review");
    expect(verdictOf(evidence("Software"), exclusionRules).qualification).toBe("qualified");
  });

  it("CHANGED: the score-policy thresholds decide — they used to be stored and ignored", () => {
    const strict = { ...rules, scorePolicy: { ...rules.scorePolicy, qualifiedMinFitScore: 100 } };
    expect(verdictOf(evidence("Software"), strict).qualification).toBe("needs_review");

    const lenient = { ...rules, scorePolicy: { ...rules.scorePolicy, qualifiedMinFitScore: 15, needsReviewMinFitScore: 10 } };
    expect(verdictOf(evidence("Mining"), lenient).qualification).toBe("qualified");
  });

  describe("the TeleStar ICP shape", () => {
    const telestar = (() => {
      const value = emptyIcpRulesV2("telestar-shape", "TeleStar shape");
      value.geography.targetCountries = ["United States", "United Kingdom", "Denmark"];
      value.geography.excludedCountries = ["India"];
      value.persona.titleAllowlist = ["CEO", "Founder", "VP Sales"];
      value.size.minEmployees = 3;
      value.disqualifiers.genericEmailContact = { disqualify: true };
      return value;
    })();
    const lead = (country: string, rawTitle: string | null, email = "jane@acme.io", employeeCount?: number) => ({
      company: { companyName: "Acme", country, websiteStatus: "reachable" as const, employeeCount },
      contact: rawTitle ? { rawTitle, email } : { email },
    });

    it("qualifies a buyer in a target country even with no headcount on file", () => {
      // Size is configured (min 3) and almost never known; it used to hold every lead in Review.
      const verdict = verdictOf(lead("United Kingdom", "CEO"), telestar);
      expect(verdict.qualification).toBe("qualified");
      expect(verdict.scoredDimensions).not.toContain("size");
    });

    it("does not reject a right buyer for one wrong country — Review instead", () => {
      expect(verdictOf(lead("Germany", "CEO"), telestar).qualification).toBe("needs_review");
    });

    it("still rejects a free-mail contact and an excluded HQ country outright", () => {
      expect(verdictOf(lead("United Kingdom", "CEO", "jane@gmail.com"), telestar).qualification).toBe("unqualified");
      expect(verdictOf(lead("India", "CEO"), telestar).qualification).toBe("unqualified");
    });

    it("rejects a company too small when the headcount is known", () => {
      const verdict = verdictOf(lead("United Kingdom", "Software Engineer", "jane@acme.io", 1), telestar);
      expect(verdict.qualification).not.toBe("qualified");
    });
  });
});
