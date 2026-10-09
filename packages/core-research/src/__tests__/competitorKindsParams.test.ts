import { describe, expect, it } from "vitest";

import { normalizeResearchBuilderParams } from "../buildDiscoveryQueries";
import { resolveKindPolicy } from "../targetPolicy";
import { COMPANY_KINDS } from "../companyClassification";

describe("competitorKinds in builder params", () => {
  it("round-trips chosen kinds through the normalizer", () => {
    const params = normalizeResearchBuilderParams({ industries: "Banking", competitorKinds: ["services_agency", "software_vendor"] });
    expect(params?.competitorKinds).toEqual(["services_agency", "software_vendor"]);
    expect(normalizeResearchBuilderParams(params)?.competitorKinds).toEqual(["services_agency", "software_vendor"]);
  });

  it("drops unknown kinds and duplicates, and omits the field when none remain", () => {
    expect(normalizeResearchBuilderParams({ competitorKinds: ["bogus", "event", "event"] })?.competitorKinds).toEqual(["event"]);
    expect(normalizeResearchBuilderParams({ competitorKinds: ["bogus"] })).not.toHaveProperty("competitorKinds");
    expect(normalizeResearchBuilderParams({ competitorKinds: [] })).not.toHaveProperty("competitorKinds");
  });

  it("accepts every known kind", () => {
    expect(normalizeResearchBuilderParams({ competitorKinds: [...COMPANY_KINDS] })?.competitorKinds).toEqual([...COMPANY_KINDS]);
  });

  it("feeds the kind policy that verification uses", () => {
    const params = normalizeResearchBuilderParams({ competitorKinds: ["services_agency"] });
    const policy = resolveKindPolicy(params, { industry: { targetIndustries: [] } } as never);
    expect(policy.services_agency).toBe("competitor");
    expect(policy.operator).toBe("accept");
  });
});
