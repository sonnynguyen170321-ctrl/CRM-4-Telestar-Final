import { describe, expect, it } from "vitest";

import { ICP_TEMPLATES_V2, getIcpTemplateV2 } from "../icpTemplatesV2";
import { validateIcpVersionRulesV2 } from "../schema-v2";

// Every prebuilt template must be a structurally valid v2 rule set the scorer can run.

describe("ICP_TEMPLATES_V2", () => {
  it("has unique ids and non-empty names/descriptions", () => {
    const ids = ICP_TEMPLATES_V2.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of ICP_TEMPLATES_V2) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });

  it("every template builds a schema-v2-valid rule set with real targets", () => {
    for (const t of ICP_TEMPLATES_V2) {
      const rules = t.build(`icp_${t.id}`);
      expect(() => validateIcpVersionRulesV2(rules)).not.toThrow();
      expect(rules.industry.targetIndustries.length).toBeGreaterThan(0);
      expect(rules.persona.titleTiers.length).toBeGreaterThan(0);
      expect(rules.size.sizeBands.length).toBeGreaterThan(0);
    }
  });

  it("getIcpTemplateV2 resolves by id", () => {
    expect(getIcpTemplateV2("cybersecurity")?.name).toBe("Cybersecurity");
    expect(getIcpTemplateV2("nope")).toBeNull();
  });
});
