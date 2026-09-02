import { describe, expect, it } from "vitest";

import { presentCompanyIntelligence } from "../presentIntelligence";
import type { CompanyIntelligenceProfileSummary } from "../readModel";

// Locks the depth unlock: per-claim citations + confidence, footprint facts, risks, and
// evidence quality now surface from the persisted JSON instead of being dropped.

function profile(overrides: Partial<CompanyIntelligenceProfileSummary>): CompanyIntelligenceProfileSummary {
  return {
    id: "p1",
    companySummary: "Acme builds payment APIs.",
    facts: [],
    factsByFamily: [],
    evidenceItems: [],
    evidenceByFamily: [],
    classification: null,
    sourceCoverage: null,
    riskSignals: null,
    confidence: null,
    profileStatus: "EXTRACTED",
    staleAt: null,
    researchVersion: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const ref = (url: string) => ({ url, text: "We provide payment APIs for platforms.", pageType: "PRODUCT" as const });

describe("presentCompanyIntelligence depth unlock", () => {
  it("surfaces cited claims with per-field confidence", () => {
    const view = presentCompanyIntelligence(
      profile({
        classification: {
          reasoning: {
            offering: { value: { type: "saas", vertical: "payments", primaryOffering: "Payment APIs" }, confidence: "HIGH", evidence: [ref("https://acme.io/product")] },
            businessModel: { value: { model: "B2B", pricingModel: "subscription" }, confidence: "MEDIUM", evidence: [ref("https://acme.io/pricing")] },
            channels: { value: ["direct"], confidence: "LOW", evidence: [ref("https://acme.io")] },
            growth: { hiring: { value: { real: true }, confidence: "HIGH", evidence: [ref("https://acme.io/careers")] }, signals: [] },
            partnerships: [{ name: "Shopify", kind: "integration", confidence: "MEDIUM", evidence: [ref("https://acme.io/partners")] }],
            overallConfidence: "HIGH",
            evidenceQuality: { pagesFetched: 8, usefulPages: 6, uniqueSources: 3, score: 72, conflicts: ["b2b_vs_b2c_ambiguous"] },
            controlledTokens: [],
            engineTrace: { engine: "rules", llmUsed: false, pipelineVersion: 1, notes: [] },
          },
        },
      })
    );
    const offering = view.claims.find((c) => c.label === "What they sell");
    expect(offering?.value).toBe("Payment APIs");
    expect(offering?.confidence).toBe("HIGH");
    expect(offering?.citations[0]?.url).toContain("acme.io/product");
    expect(view.partnershipsCited[0]).toEqual({ name: "Shopify", kind: "integration", confidence: "MEDIUM" });
    expect(view.quality?.score).toBe(72);
    expect(view.quality?.conflicts).toContain("b2b_vs_b2c_ambiguous");
  });

  it("derives footprint from geo/revenue/location/news fact tokens", () => {
    const view = presentCompanyIntelligence(
      profile({
        facts: [
          "geo.hq_country_vietnam",
          "geo.office_country_singapore",
          "geo.market_united_states",
          "revenue.usd_5000000",
          "location.count_12",
          "news.recent",
        ],
      })
    );
    expect(view.footprint.hqCountries).toEqual(["vietnam"]);
    expect(view.footprint.officeCountries).toEqual(["singapore"]);
    expect(view.footprint.marketCountries).toEqual(["united states"]);
    expect(view.footprint.revenueUsd).toBe(5000000);
    expect(view.footprint.locationCount).toBe(12);
    expect(view.footprint.recentNews).toBe(true);
  });

  it("surfaces risk signals from riskSignalsJson + risk.* facts", () => {
    const view = presentCompanyIntelligence(
      profile({ riskSignals: ["parked_domain"], facts: ["risk.service_product_ambiguity"] })
    );
    expect(view.risks).toContain("parked_domain");
    expect(view.risks.some((r) => r.includes("service product ambiguity"))).toBe(true);
  });
});
