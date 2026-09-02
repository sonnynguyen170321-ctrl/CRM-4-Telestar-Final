import { describe, expect, it } from "vitest";

import {
  humanizeEmailLocalPart,
  isEmailDerivedName,
  resolveContactDisplayName,
} from "../resolveContactDisplayName";

describe("humanizeEmailLocalPart", () => {
  it("title-cases dotted/underscored/hyphenated locals and strips digits", () => {
    expect(humanizeEmailLocalPart("john.doe")).toBe("John Doe");
    expect(humanizeEmailLocalPart("sean_watkins2")).toBe("Sean Watkins");
    expect(humanizeEmailLocalPart("mj.lim")).toBe("Mj Lim");
    expect(humanizeEmailLocalPart("andy")).toBe("Andy");
  });
  it("returns empty when nothing usable remains", () => {
    expect(humanizeEmailLocalPart("12345")).toBe("");
    expect(humanizeEmailLocalPart("___")).toBe("");
  });
});

describe("isEmailDerivedName", () => {
  it("flags a fullName that is an email or the raw local-part", () => {
    expect(isEmailDerivedName("john.doe", "john.doe@acme.com")).toBe(true);
    expect(isEmailDerivedName("jane@acme.com", "jane@acme.com")).toBe(true);
  });
  it("does not flag a real name", () => {
    expect(isEmailDerivedName("John Doe", "john.doe@acme.com")).toBe(false);
    expect(isEmailDerivedName("John Doe", null)).toBe(false);
  });
});

describe("resolveContactDisplayName", () => {
  it("prefers explicit first/last name", () => {
    expect(resolveContactDisplayName({ fullName: "j.doe", firstName: "Jane", lastName: "Doe", email: "j.doe@x.com" })).toBe("Jane Doe");
  });
  it("keeps a genuine fullName", () => {
    expect(resolveContactDisplayName({ fullName: "Maria García", email: "mgarcia@x.com" })).toBe("Maria García");
  });
  it("humanizes an email-derived fullName", () => {
    expect(resolveContactDisplayName({ fullName: "richard.johnson", email: "richard.johnson@x.com" })).toBe("Richard Johnson");
  });
  it("humanizes when fullName is literally an email", () => {
    expect(resolveContactDisplayName({ fullName: "aaron.luxmoore@x.com", email: null })).toBe("Aaron Luxmoore");
  });
  it("falls back to company when no name is derivable", () => {
    expect(resolveContactDisplayName({ fullName: "12345", email: "12345@x.com", companyName: "Acme Ltd" })).toBe("Acme Ltd (no contact name)");
  });
});
