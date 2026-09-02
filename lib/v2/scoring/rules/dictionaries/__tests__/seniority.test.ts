import { describe, expect, it } from "vitest";

import { lookupSeniority, matchesSeniorityKeyword } from "../seniority";

describe("matchesSeniorityKeyword", () => {
  it("matches 2-3 letter acronyms only as whole words", () => {
    // "cco" must NOT fire inside "account"; "coo" not inside "coordinator".
    expect(matchesSeniorityKeyword("account executive", "cco")).toBe(false);
    expect(matchesSeniorityKeyword("coordinator", "coo")).toBe(false);
    expect(matchesSeniorityKeyword("microsoft director", "cro")).toBe(false);
    // Real acronym titles still match.
    expect(matchesSeniorityKeyword("cco", "cco")).toBe(true);
    expect(matchesSeniorityKeyword("ceo, founder", "ceo")).toBe(true);
    expect(matchesSeniorityKeyword("vp of sales", "vp")).toBe(true);
  });

  it("keeps longer keywords as substrings", () => {
    expect(matchesSeniorityKeyword("chief commercial officer", "chief")).toBe(true);
    expect(matchesSeniorityKeyword("head of sales", "head of")).toBe(true);
  });
});

describe("lookupSeniority C_LEVEL no longer over-matches", () => {
  it("classifies account/coordinator titles below C_LEVEL", () => {
    expect(lookupSeniority("Account Executive").tier).not.toBe("C_LEVEL");
    expect(lookupSeniority("Account Manager").tier).toBe("MANAGER");
    expect(lookupSeniority("Key Account Manager").tier).toBe("MANAGER");
    expect(lookupSeniority("Coordinator").tier).not.toBe("C_LEVEL");
  });

  it("still resolves real C-level titles", () => {
    expect(lookupSeniority("CEO").tier).toBe("C_LEVEL");
    expect(lookupSeniority("Chief Marketing Officer").tier).toBe("C_LEVEL");
    expect(lookupSeniority("CCO").tier).toBe("C_LEVEL");
    expect(lookupSeniority("Chief").tier).toBe("C_LEVEL");
  });
});
