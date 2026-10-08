import { describe, expect, it } from "vitest";

import { INDUSTRY_KEYS, canonicalizeIndustry } from "@telestar/core-scoring/rules/dictionaries/industry";

import { COMPANY_KINDS, safeAlias } from "../verificationTypes";

/**
 * The classifier names an industry from the closed `INDUSTRY_KEYS` list, and the scoring engine reads
 * a free-text industry through `canonicalizeIndustry`'s substring match (owner report, 2026-10-08).
 * Handing the engine the key itself ("FNB", "ECOMMERCE", "REAL_ESTATE") is not safe: `FNB` matches no
 * alias, so a correctly classified restaurant group scored as "industry unknown". `safeAlias` is the
 * phrase that survives the engine's matcher and lands on the same key.
 */
describe("safeAlias", () => {
  it("round-trips through canonicalizeIndustry for every industry key that has an alias", () => {
    const withoutAlias: string[] = [];
    for (const key of INDUSTRY_KEYS) {
      const alias = safeAlias(key);
      if (alias === null) {
        withoutAlias.push(key);
        continue;
      }
      expect(canonicalizeIndustry(alias), `${key} -> ${alias}`).toBe(key);
    }
    // OTHER is the catch-all and has no dictionary alias; the caller falls back to the free text.
    expect(withoutAlias).toEqual(["OTHER"]);
  });

  it("is null for a key it does not know", () => {
    expect(safeAlias(null)).toBeNull();
    expect(safeAlias("NOT_A_KEY" as never)).toBeNull();
  });
});

describe("COMPANY_KINDS", () => {
  it("lists the eleven kinds the classification contract allows", () => {
    expect([...COMPANY_KINDS]).toEqual([
      "operator",
      "software_vendor",
      "services_agency",
      "reseller_wholesaler",
      "association_nonprofit",
      "government",
      "education",
      "media_news",
      "directory_marketplace_jobboard",
      "research_analyst",
      "event",
    ]);
  });
});
