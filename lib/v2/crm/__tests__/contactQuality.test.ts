import { describe, expect, it } from "vitest";

import { assessLinkedInAccess, assessContactQuality, linkedInAccessBucket } from "../contactQuality";

describe("assessLinkedInAccess", () => {
  it("classifies a person profile as OK", () => {
    expect(assessLinkedInAccess({ url: "https://www.linkedin.com/in/anna-tran" })).toBe("OK");
    expect(assessLinkedInAccess({ url: "linkedin.com/in/anna" })).toBe("OK");
  });
  it("treats a company page as malformed (not a person)", () => {
    expect(assessLinkedInAccess({ url: "https://linkedin.com/company/acme" })).toBe("MALFORMED");
  });
  it("treats a non-linkedin host as malformed", () => {
    expect(assessLinkedInAccess({ url: "https://example.com/in/anna" })).toBe("MALFORMED");
  });
  it("honors persisted negative validity over shape", () => {
    expect(assessLinkedInAccess({ url: "https://linkedin.com/in/anna", validityStatus: "NOT_FOUND" })).toBe("NOT_FOUND");
    expect(assessLinkedInAccess({ url: "https://linkedin.com/in/anna", validityStatus: "PRIVATE" })).toBe("PRIVATE");
  });
  it("returns NONE when absent", () => {
    expect(assessLinkedInAccess({ url: null })).toBe("NONE");
    expect(assessLinkedInAccess({ url: "" })).toBe("NONE");
  });
});

describe("assessContactQuality", () => {
  it("a clean contact is outreach + persona ready with no reasons", () => {
    const q = assessContactQuality({ email: "anna@acme.com", title: "VP Sales", linkedInUrl: "https://linkedin.com/in/anna" });
    expect(q.reasons).toEqual([]);
    expect(q.outreachReady).toBe(true);
    expect(q.personaReady).toBe(true);
  });
  it("flags a 404 LinkedIn contact with only a generic email as not outreach-ready", () => {
    const q = assessContactQuality({ email: "info@acme.com", title: null, linkedInUrl: "https://linkedin.com/in/x", linkedInValidityStatus: "NOT_FOUND" });
    expect(q.reasons).toContain("GENERIC_EMAIL");
    expect(q.reasons).toContain("LINKEDIN_NOT_FOUND");
    expect(q.reasons).toContain("MISSING_TITLE");
    expect(q.outreachReady).toBe(false);
    expect(q.personaReady).toBe(false);
  });
  it("a real email keeps outreach-ready even with no linkedin", () => {
    const q = assessContactQuality({ email: "anna@acme.com", title: "CTO", linkedInUrl: null });
    expect(q.reasons).toContain("NO_LINKEDIN");
    expect(q.outreachReady).toBe(true);
  });
});

describe("linkedInAccessBucket", () => {
  it("maps classes to filter buckets", () => {
    expect(linkedInAccessBucket("OK")).toBe("accessible");
    expect(linkedInAccessBucket("NOT_FOUND")).toBe("blocked");
    expect(linkedInAccessBucket("PRIVATE")).toBe("blocked");
    expect(linkedInAccessBucket("MALFORMED")).toBe("blocked");
    expect(linkedInAccessBucket("NONE")).toBe("missing");
  });
});
