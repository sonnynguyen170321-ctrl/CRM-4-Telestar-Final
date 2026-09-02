import { describe, expect, it } from "vitest";

import {
  buildFetchUrl,
  domainsBelongToSameCompany,
  normalizeCanonicalDomain,
} from "../canonicalDomain";

describe("normalizeCanonicalDomain", () => {
  it.each([
    ["HTTPS://WWW.Example.COM/about?x=1", "example.com"],
    ["http://example.com/", "example.com"],
    ["www.example.com/contact", "example.com"],
    ["example.com", "example.com"],
    ["https://sub.example.com/path?a=1#frag", "sub.example.com"],
    ["HTTP://WWW.ACME.CO/", "acme.co"],
  ])("normalizes %s -> %s", (input, expected) => {
    const result = normalizeCanonicalDomain(input);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.canonicalDomain).toBe(expected);
    }
  });

  it.each([
    [""],
    ["   "],
    ["not a url"],
    ["ftp://example.com"],
    ["https://"],
    ["https://localhost"],
    [null],
    [undefined],
  ])("returns INVALID_URL for %s", (input) => {
    const result = normalizeCanonicalDomain(input as string | null | undefined);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("INVALID_URL");
    }
  });
});

describe("domainsBelongToSameCompany", () => {
  it("matches identical domains", () => {
    expect(domainsBelongToSameCompany("example.com", "example.com")).toBe(true);
  });

  it("matches subdomain relationships", () => {
    expect(domainsBelongToSameCompany("example.com", "www.app.example.com")).toBe(true);
    expect(domainsBelongToSameCompany("app.example.com", "example.com")).toBe(true);
  });

  it("rejects unrelated domains", () => {
    expect(domainsBelongToSameCompany("example.com", "other.com")).toBe(false);
  });

  it("rejects when either domain is missing", () => {
    expect(domainsBelongToSameCompany(null, "example.com")).toBe(false);
    expect(domainsBelongToSameCompany("example.com", undefined)).toBe(false);
  });
});

describe("buildFetchUrl", () => {
  it("builds https urls with the given path", () => {
    expect(buildFetchUrl("example.com", "/about")).toBe("https://example.com/about");
  });

  it("defaults to the root path", () => {
    expect(buildFetchUrl("example.com")).toBe("https://example.com/");
  });

  it("normalizes a path missing the leading slash", () => {
    expect(buildFetchUrl("example.com", "about")).toBe("https://example.com/about");
  });
});
