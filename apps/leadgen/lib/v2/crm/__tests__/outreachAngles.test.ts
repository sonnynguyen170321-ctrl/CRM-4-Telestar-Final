import { describe, expect, it } from "vitest";

import { deriveOutreachAngles } from "../outreachAngles";
import type { IntelligenceView } from "@telestar/core-intel/presentIntelligence";

function view(overrides: Partial<IntelligenceView>): IntelligenceView {
  return {
    available: true, companySummary: null, offeringType: null, vertical: null, category: null,
    industryDetail: null, servedVerticals: [],
    confidence: null, whatTheySell: [], businessModel: null, channels: [], likelyBuyers: [],
    companySize: null, targetMarket: [], growth: { hiringReal: false, signals: [] }, partnerships: [],
    maturity: { customers: false, partnerships: false, funding: false, hiring: false }, evidence: [],
    claims: [], growthSignalsCited: [], partnershipsCited: [],
    footprint: { hqCountries: [], officeCountries: [], factoryCountries: [], marketCountries: [], revenueUsd: null, locationCount: null, multiLocation: false, recentNews: false },
    risks: [], quality: null, confidenceReasons: [], providerAttempts: [],
    debug: { engine: null, llmUsed: false, providerUsed: null, pagesFetched: null, searchSufficient: null, fetchStatus: null },
    profileStatus: null, staleAt: null, ...overrides,
  };
}

describe("deriveOutreachAngles", () => {
  it("returns nothing when intelligence is unavailable", () => {
    expect(deriveOutreachAngles(view({ available: false }), { companyName: "Acme" })).toEqual([]);
  });

  it("derives a hiring angle when hiring is real", () => {
    const angles = deriveOutreachAngles(view({ growth: { hiringReal: true, signals: [] } }), { companyName: "Acme" });
    expect(angles.some((a) => /hiring/i.test(a.title))).toBe(true);
  });

  it("derives a who-they-sell-to angle from likely buyers / target market", () => {
    const angles = deriveOutreachAngles(view({ likelyBuyers: ["Marketing"], targetMarket: ["SMB"] }), { companyName: "Acme" });
    expect(angles.some((a) => /sells? to/i.test(a.title))).toBe(true);
  });

  it("caps at 4 angles", () => {
    const angles = deriveOutreachAngles(
      view({
        growth: { hiringReal: true, signals: [{ kind: "funding", detail: "raised $10M" }, { kind: "new_market", detail: "expanding into Japan" }] },
        likelyBuyers: ["Sales"], whatTheySell: ["CRM"], partnerships: [{ name: "Shopify", kind: "integration" }], category: "CRM / martech",
      }),
      { companyName: "Acme", contactTitle: "VP Sales" }
    );
    expect(angles.length).toBeLessThanOrEqual(4);
  });

  it("filters out generic expansion boilerplate", () => {
    const angles = deriveOutreachAngles(
      view({ growth: { hiringReal: false, signals: [{ kind: "new_market", detail: "Keep up to date with the latest announcements" }] } }),
      { companyName: "Acme" }
    );
    expect(angles.some((a) => a.title === "Expanding")).toBe(false);
  });

  it("filters out marketing slogans from what they sell", () => {
    const angles = deriveOutreachAngles(
      view({ whatTheySell: ["Your trusted partner for all things shipping", "Freight logistics"] }),
      { companyName: "Acme" }
    );
    expect(angles.find((a) => a.title.startsWith("Anchor to"))?.title).toBe('Anchor to "Freight logistics"');
  });

  it("filters out self-partnerships", () => {
    const angles = deriveOutreachAngles(
      view({ partnerships: [{ name: "Acme, Global", kind: "partner" }, { name: "Shopify", kind: "integration" }] }),
      { companyName: "Acme" }
    );
    expect(angles.find((a) => a.title.startsWith("Works with"))?.title).toBe("Works with Shopify");
  });
});
