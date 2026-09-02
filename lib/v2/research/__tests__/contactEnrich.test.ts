import { describe, expect, it } from "vitest";

import { extractEmails, extractPhones, pickBestEmail } from "../contactExtract";
import { canPersistContactDecision, classifyVerify, decideEmailChannel, decidePhoneChannel, isRoleEmail } from "../enrichContact";

describe("contact extractor", () => {
  const html = `
    <a href="mailto:anna.tran@acme.io">Email Anna</a>
    <p>Reach sales@acme.io or noreply@acme.io</p>
    <img src="logo@2x.png" />
    <span>partner@othersite.com</span>
    <a href="tel:+84 28 3821 9999">Call us</a>
    <p>example@example.com</p>
  `;

  it("harvests same-domain emails first and drops junk/assets/placeholders", () => {
    const emails = extractEmails(html, "acme.io");
    expect(emails).toContain("anna.tran@acme.io");
    expect(emails).toContain("sales@acme.io");
    expect(emails).not.toContain("noreply@acme.io");
    expect(emails.some((e) => e.includes("logo@2x"))).toBe(false);
    expect(emails.some((e) => e === "example@example.com")).toBe(false);
    expect(emails[0].endsWith("@acme.io")).toBe(true);
  });

  it("validates + E.164-normalizes phones", () => {
    const phones = extractPhones(html);
    expect(phones).toContain("+842838219999");
  });

  it("prefers the name-matching same-domain email", () => {
    const best = pickBestEmail(["sales@acme.io", "anna.tran@acme.io", "x@other.com"], "Anna Tran", "acme.io");
    expect(best).toBe("anna.tran@acme.io");
  });

  it("keeps role emails out of person email assignment", () => {
    expect(isRoleEmail("sales@acme.io")).toBe(true);
    expect(isRoleEmail("support@acme.io")).toBe(true);
    expect(isRoleEmail("anna.tran@acme.io")).toBe(false);
  });
});

describe("classifyVerify", () => {
  it("maps verifier results to the expanded contact email tiers", () => {
    expect(classifyVerify({ validFormat: false, validMx: null, validSmtp: null }, "public_exact_email")).toBe("INVALID");
    expect(classifyVerify({ validFormat: true, validMx: false, validSmtp: null }, "public_exact_email")).toBe("INVALID");
    expect(classifyVerify({ validFormat: true, validMx: true, validSmtp: true }, "common_pattern")).toBe("VERIFIED");
    expect(classifyVerify({ validFormat: true, validMx: true, validSmtp: null }, "common_pattern")).toBe("GUESSED");
    expect(classifyVerify({ validFormat: true, validMx: null, validSmtp: null }, "public_exact_email")).toBe("LIKELY");
    expect(classifyVerify({ validFormat: true, validMx: null, validSmtp: null }, "learned_pattern")).toBe("GUESSED");
  });
});

describe("contact channel decisions", () => {
  it("auto-persists only verified person emails", () => {
    const verified = decideEmailChannel("anna.tran@acme.io", "VERIFIED", "public_exact_email");
    expect(verified.scope).toBe("PERSON");
    expect(verified.verification).toBe("VERIFIED");
    expect(verified.usageDecision).toBe("AUTO_USABLE");
    expect(canPersistContactDecision(verified)).toBe(true);

    const likely = decideEmailChannel("anna.tran@acme.io", "LIKELY", "public_exact_email");
    expect(likely.verification).toBe("CORROBORATED");
    expect(likely.usageDecision).toBe("REVIEW_REQUIRED");
    expect(canPersistContactDecision(likely)).toBe(false);
  });

  it("blocks role emails and keeps website phones out of person identifiers", () => {
    const role = decideEmailChannel("sales@acme.io", "VERIFIED", "public_exact_email");
    expect(role.scope).toBe("COMPANY");
    expect(role.usageDecision).toBe("BLOCKED");
    expect(canPersistContactDecision(role)).toBe(false);

    const phone = decidePhoneChannel("+842838219999");
    expect(phone.scope).toBe("COMPANY");
    expect(phone.verification).toBe("UNVERIFIED");
    expect(phone.usageDecision).toBe("REVIEW_REQUIRED");
    expect(canPersistContactDecision(phone)).toBe(false);
  });
});
