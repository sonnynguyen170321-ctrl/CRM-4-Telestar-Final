import { describe, expect, it } from "vitest";

import { mapNeutralFactsToCompanyEvidence } from "../mapIntelligenceToCompanyEvidence";

describe("mapNeutralFactsToCompanyEvidence", () => {
  it("returns an empty mapping for no facts", () => {
    const evidence = mapNeutralFactsToCompanyEvidence([]);

    expect(evidence.description).toBeUndefined();
    expect(evidence.industryTags).toBeUndefined();
    expect(evidence.productSignals).toBeUndefined();
    expect(evidence.serviceSignals).toBeUndefined();
    expect(evidence.platformSignals).toBeUndefined();
    expect(evidence.pricingSignals).toBeUndefined();
    expect(evidence.notes).toBeUndefined();
    expect(evidence.pipelineInferredCountry).toBeUndefined();
    expect(evidence.websiteStatus).toBe("reachable");
  });

  it("maps cybersecurity offering and banking industry into product/industry signals", () => {
    const evidence = mapNeutralFactsToCompanyEvidence([
      "offering.cybersecurity",
      "industry.banking",
    ]);

    expect(evidence.productSignals).toContain("cybersecurity");
    expect(evidence.industryTags).toContain("CYBERSECURITY");
    expect(evidence.industryTags).toContain("BANKING");
    expect(evidence.description).toContain("cybersecurity offering");
    expect(evidence.description).toContain("banking industry");
  });

  it("maps ERP and manufacturing facts into product/industry signals", () => {
    const evidence = mapNeutralFactsToCompanyEvidence([
      "offering.erp",
      "industry.manufacturing",
    ]);

    expect(evidence.productSignals).toContain("ERP");
    expect(evidence.industryTags).toContain("ERP_MANUFACTURING");
    expect(evidence.industryTags).toContain("MANUFACTURING");
  });

  it("maps cloud infrastructure facts into platform signals", () => {
    const evidence = mapNeutralFactsToCompanyEvidence(["offering.cloud_infrastructure"]);

    expect(evidence.platformSignals).toContain("cloud infrastructure");
    expect(evidence.industryTags).toContain("CLOUD_INFRA");
  });

  it("maps geo.hq_country tokens to pipelineInferredCountry with display-cased names", () => {
    const singapore = mapNeutralFactsToCompanyEvidence(["geo.hq_country_singapore"]);
    expect(singapore.pipelineInferredCountry).toBe("Singapore");
    expect(singapore.description).toContain("headquartered in Singapore");

    const unitedStates = mapNeutralFactsToCompanyEvidence(["geo.hq_country_united_states"]);
    expect(unitedStates.pipelineInferredCountry).toBe("United States");
  });

  it("maps geo.factory_country tokens into description without affecting pipelineInferredCountry", () => {
    const evidence = mapNeutralFactsToCompanyEvidence(["geo.factory_country_vietnam"]);

    expect(evidence.description).toContain("factory in Vietnam");
    expect(evidence.pipelineInferredCountry).toBeUndefined();
  });

  it("maps pricing, hiring, and proof tokens into pricing signals and notes", () => {
    const evidence = mapNeutralFactsToCompanyEvidence([
      "maturity.has_pricing_page",
      "maturity.hiring",
      "proof.case_study",
      "growth.funding",
    ]);

    expect(evidence.pricingSignals).toContain("pricing page");
    expect(evidence.notes).toContain("actively hiring");
    expect(evidence.notes).toContain("case study evidence");
    expect(evidence.notes).toContain("recent funding");
  });

  it("never sets qualification, fitScore, confidenceScore, or persona fields", () => {
    const evidence = mapNeutralFactsToCompanyEvidence([
      "offering.cybersecurity",
      "industry.banking",
      "geo.hq_country_singapore",
    ]);

    expect(evidence).not.toHaveProperty("qualification");
    expect(evidence).not.toHaveProperty("fitScore");
    expect(evidence).not.toHaveProperty("confidenceScore");
    expect(evidence).not.toHaveProperty("personaEvidence");
  });
});
