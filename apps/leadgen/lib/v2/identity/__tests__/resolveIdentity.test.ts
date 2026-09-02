import { describe, expect, it } from "vitest";

import { SAMPLE_IDENTITY_RESOLVER_FIXTURES } from "../__fixtures__/sampleIdentityResolverFixtures";
import {
  isGenericEmail,
  isPublicEmailDomain,
  normalizeCompanyName,
  normalizeIdentityDomain,
  resolveIdentity,
} from "../resolveIdentity";

function fixtureByName(name: string) {
  const fixture = SAMPLE_IDENTITY_RESOLVER_FIXTURES.find(
    (candidate) => candidate.name === name
  );

  if (!fixture) {
    throw new Error(`Missing identity resolver fixture: ${name}`);
  }

  return fixture;
}

describe("resolveIdentity", () => {
  it.each(SAMPLE_IDENTITY_RESOLVER_FIXTURES)("$name", (fixture) => {
    const result = resolveIdentity(fixture.input);

    expect(result.kind).toBe(fixture.expected.kind);
    expect(result.confidence).toBe(fixture.expected.confidence);
    expect(result.companyId).toBe(fixture.expected.companyId);
    expect(result.contactId).toBe(fixture.expected.contactId);

    for (const reason of fixture.expected.reasons) {
      expect(result.reasons).toContain(reason);
    }
  });

  it("exact-matches canonical company domain to exact_company", () => {
    const result = resolveIdentity(
      fixtureByName("exact canonical company domain").input
    );

    expect(result).toMatchObject({
      kind: "exact_company",
      confidence: 0.95,
      companyId: "company-acme",
    });
    expect(result.reasons).toContain("company_domain_exact");
  });

  it("exact-matches contact identifiers only inside a context-valid company", () => {
    const result = resolveIdentity(
      fixtureByName("exact contact email only after resolved company domain").input
    );

    expect(result).toMatchObject({
      kind: "exact_contact",
      confidence: 0.98,
      companyId: "company-acme",
      contactId: "contact-ada",
    });
    expect(result.reasons).toEqual(
      expect.arrayContaining(["company_domain_exact", "contact_email_exact"])
    );
  });

  it("exact-matches normalized company names inside account/project context", () => {
    const result = resolveIdentity(
      fixtureByName("normalized company name within account project context").input
    );

    expect(result).toMatchObject({
      kind: "exact_company",
      confidence: 0.88,
      companyId: "company-acme",
    });
    expect(result.reasons).toContain("company_name_exact_in_context");
  });

  it("keeps fuzzy company/name evidence as candidate only", () => {
    const result = resolveIdentity(
      fixtureByName("fuzzy company name returns candidate only").input
    );

    expect(result).toMatchObject({
      kind: "candidate",
      confidence: 0.62,
      companyId: "company-acme",
    });
    expect(result.kind).not.toBe("exact_company");
    expect(result.reasons).toContain("fuzzy_company_name_candidate_only");
  });

  it("returns none when no usable identity evidence exists", () => {
    const result = resolveIdentity(
      fixtureByName("no usable identity evidence returns none").input
    );

    expect(result).toMatchObject({
      kind: "none",
      confidence: 0,
    });
    expect(result.reasons).toContain("no_usable_identity_evidence");
  });

  it("blocks public email domains from company-domain identity", () => {
    const result = resolveIdentity(
      fixtureByName("public email domain blocked from company identity").input
    );

    expect(result.kind).toBe("none");
    expect(result.companyId).toBeUndefined();
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "blocked_public_email_domain",
        "no_usable_identity_evidence",
      ])
    );
  });

  it("blocks generic inboxes from exact contact matching but retains the reason", () => {
    const result = resolveIdentity(
      fixtureByName("generic email cannot exact contact").input
    );

    expect(result.kind).toBe("exact_company");
    expect(result.contactId).toBeUndefined();
    expect(result.reasons).toEqual(
      expect.arrayContaining(["blocked_generic_contact_email", "company_domain_exact"])
    );
  });

  it("never returns a candidate from another tenant", () => {
    const result = resolveIdentity(
      fixtureByName("cross tenant exact domain ignored").input
    );

    expect(result).toMatchObject({
      kind: "none",
      confidence: 0,
    });
    expect(result.companyId).toBeUndefined();
    expect(result.reasons).toEqual(
      expect.arrayContaining(["tenant_mismatch_ignored", "no_usable_identity_evidence"])
    );
  });
});

describe("Vietnamese identity normalization", () => {
  it("normalizes domains, generic inboxes, public email domains, and Vietnamese names", () => {
    expect(normalizeIdentityDomain("https://www.Example.com/path?q=1")).toBe(
      "example.com"
    );
    expect(normalizeCompanyName("Công Ty TNHH Dữ Liệu Sao Bắc")).toBe(
      "du lieu sao bac"
    );
    expect(normalizeCompanyName("Công ty CP Sao Bắc")).toBe("sao bac");
    expect(normalizeCompanyName("Công ty Cổ Phần Dữ Liệu Sao Bắc")).toBe(
      "du lieu sao bac"
    );
    expect(normalizeCompanyName("Công ty Cổ Phần Dữ Liệu Sao Bắc".normalize("NFD"))).toBe(
      normalizeCompanyName("Công ty Cổ Phần Dữ Liệu Sao Bắc")
    );
    expect(isGenericEmail("info@example.com")).toBe(true);
    expect(isGenericEmail("ada@example.com")).toBe(false);
    expect(isPublicEmailDomain("founder@gmail.com")).toBe(true);
    expect(isPublicEmailDomain("acme.example")).toBe(false);
  });

  it("strips legal forms as a SUFFIX and matches the prefix form (Invariant 11 — no split)", () => {
    // Prefix and suffix forms of the same company must normalize identically so they don't duplicate.
    expect(normalizeCompanyName("Sao Bắc TNHH")).toBe("sao bac");
    expect(normalizeCompanyName("Công ty TNHH Sao Bắc")).toBe(normalizeCompanyName("Sao Bắc TNHH"));
    expect(normalizeCompanyName("Dữ Liệu Sao Bắc CP")).toBe("du lieu sao bac");
    expect(normalizeCompanyName("Sao Bắc Co phan")).toBe("sao bac");
  });

  it("handles Vietnamese short-forms (MTV / DNTN / CTCP / Cty)", () => {
    expect(normalizeCompanyName("Công ty TNHH MTV Sao Bắc")).toBe("sao bac");
    expect(normalizeCompanyName("Công ty TNHH Một Thành Viên Sao Bắc")).toBe("sao bac");
    expect(normalizeCompanyName("DNTN Sao Bắc")).toBe("sao bac");
    expect(normalizeCompanyName("CTCP Sao Bắc")).toBe("sao bac");
    expect(normalizeCompanyName("Cty Sao Bắc")).toBe("sao bac");
    // A name that is nothing but a legal form normalizes to empty (null).
    expect(normalizeCompanyName("Công ty TNHH")).toBeNull();
  });
});
