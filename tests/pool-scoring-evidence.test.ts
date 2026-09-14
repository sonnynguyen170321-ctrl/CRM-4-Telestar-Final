import { describe, expect, it } from "vitest";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import { mapNeutralFactsToCompanyEvidence } from "@telestar/core-intel/mapIntelligenceToCompanyEvidence";

import {
  auditIndustryEvidence,
  summarizeIcpIndustryEvidence,
} from "@/lib/leadgen/icpIndustryEvidenceAudit";
import { buildScoringEvidence } from "@/lib/leadgen/scorePoolItem";

// Pure contract tests: no database. What is under test is the SHAPE of the evidence a pool record
// is scored on, and the read-only audit that recomputes verdicts from persisted snapshots.

const ITEM = {
  id: "pool-1",
  company: "Acme Payments",
  title: "Head of Finance",
  email: "cfo@acme.example",
  country: "Vietnam",
  industry: null,
  website: "https://acme.example",
  accountId: null,
};

const allowlistRules = (targetIndustries: string[]) => {
  const rules = emptyIcpRulesV2("test-rules", "Test ICP");
  rules.industry = { ...rules.industry, mode: "allowlist", targetIndustries };
  return rules;
};

describe("buildScoringEvidence", () => {
  it("scores an uploaded record on its own fields alone when no intelligence exists", () => {
    const evidence = buildScoringEvidence(ITEM);

    expect(evidence.company.description).toBeUndefined();
    expect(evidence.company.industryTags).toBeUndefined();
    expect(evidence.company.industryCategory).toBeUndefined();
    // The serialized form — keys AND their order — is the fingerprint input. An existing
    // assessment is only reused if an unchanged record still serializes to exactly this.
    expect(JSON.stringify(evidence)).toBe(
      '{"company":{"companyName":"Acme Payments","country":"Vietnam","domain":"acme.example","websiteStatus":"reachable"},' +
        '"contact":{"rawTitle":"Head of Finance","email":"cfo@acme.example","contactCountry":"Vietnam"}}',
    );
  });

  it("takes intelligence only as controlled-token evidence, never as generated prose", () => {
    const intelligence = mapNeutralFactsToCompanyEvidence([
      "category.fintech_payments",
      "offering.erp",
      "industry.banking",
    ]);
    const evidence = buildScoringEvidence(ITEM, intelligence);

    expect(evidence.company.industryCategory).toBe("fintech_payments");
    expect(evidence.company.industryTags).toEqual(
      expect.arrayContaining(["ERP_MANUFACTURING", "BANKING"]),
    );
    expect(evidence.company.description).toBe("ERP offering; banking industry");

    // A free-text company summary is not an evidence field: the classifier that wrote it
    // would be grading its own homework on the next run.
    // @ts-expect-error summary is not part of IntelligenceCompanyEvidence
    buildScoringEvidence(ITEM, { summary: "Acme is a fintech company" });
  });

  it("keeps V1-only intelligence fields out of the fingerprinted evidence", () => {
    // `IntelligenceCompanyEvidence` picks from the V1 schema; these four exist there but the V2
    // engine never reads them. If they reached `inputSnapshot`, a rerun that changed only a note
    // would hash differently and mint a new immutable assessment for no scoring reason.
    const evidence = buildScoringEvidence(ITEM, {
      industryCategory: "fintech_payments",
      pricingSignals: ["pricing page"],
      platformSignals: ["cloud infrastructure"],
      notes: "crawled 2026-09-14",
      pipelineInferredCountry: "Singapore",
    });

    const fingerprintedKeys = Object.keys(JSON.parse(JSON.stringify(evidence.company)));
    expect(fingerprintedKeys.sort()).toEqual(
      ["companyName", "country", "domain", "industryCategory", "websiteStatus"].sort(),
    );
  });
});

describe("ICP industry-evidence audit", () => {
  const row = (
    overrides: Partial<{ industry: string | null; title: string | null }>,
    rules = allowlistRules(["fintech"]),
    persistedQualification: "qualified" | "needs_review" | "unqualified" = "needs_review",
  ) => ({
    assessmentId: `a-${overrides.industry ?? "none"}`,
    poolItemId: `p-${overrides.industry ?? "none"}`,
    icpVersionId: "icp-v1",
    persistedQualification,
    inputSnapshot: buildScoringEvidence({ ...ITEM, ...overrides }),
    rulesSnapshot: rules,
  });

  it("names industry as the sole blocker only when a matching industry would qualify", () => {
    const finding = auditIndustryEvidence(row({ industry: null }));

    expect(finding.bucket).toBe("allowlist_industry_unknown");
    expect(finding.recomputedQualification).toBe("needs_review");
    expect(finding.industrySoleBlocker).toBe(true);
  });

  it("does not blame industry when persona evidence is also missing", () => {
    const rules = allowlistRules(["fintech"]);
    rules.persona = { ...rules.persona, requirePersonaForFinalQualification: true };
    const finding = auditIndustryEvidence(row({ industry: null, title: null }, rules));

    expect(finding.bucket).toBe("allowlist_industry_unknown");
    expect(finding.industrySoleBlocker).toBe(false);
  });

  it("flags an allowlist miss that rests on nothing but the uploaded label", () => {
    const finding = auditIndustryEvidence(row({ industry: "Mining" }));

    expect(finding.bucket).toBe("allowlist_miss");
    expect(finding.recomputedQualification).toBe("unqualified");
    expect(finding.uploadedLabelOnly).toBe(true);
    expect(finding.drifted).toBe(true);
  });

  it("recognises a match and a non-allowlist ICP without touching the verdict", () => {
    expect(auditIndustryEvidence(row({ industry: "Fintech" })).bucket).toBe("allowlist_match");

    const rules = emptyIcpRulesV2("open", "Open ICP");
    expect(auditIndustryEvidence(row({ industry: null }, rules)).bucket).toBe("not_allowlist");
  });

  it("summarises counts per bucket and per ICP version with capped samples", () => {
    // Persisted verdicts match what the engine says today for two rows; the Mining row was
    // stored as Review and now recomputes to Unqualified, so it is the one drifted row.
    const summary = summarizeIcpIndustryEvidence(
      [
        row({ industry: null }),
        row({ industry: "Mining" }),
        row({ industry: "Fintech" }, undefined, "qualified"),
      ],
      { sampleSize: 1 },
    );

    expect(summary.total).toBe(3);
    expect(summary.byBucket).toEqual({
      not_allowlist: 0,
      allowlist_industry_unknown: 1,
      allowlist_match: 1,
      allowlist_miss: 1,
    });
    expect(summary.industrySoleBlocker).toBe(1);
    expect(summary.allowlistMissUploadedLabelOnly).toBe(1);
    expect(summary.drifted).toBe(1);
    expect(summary.byIcpVersion["icp-v1"]?.total).toBe(3);
    expect(summary.samples.allowlist_miss).toEqual(["p-Mining"]);
    expect(summary.samples.allowlist_match).toHaveLength(1);
  });
});
