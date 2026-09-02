import { describe, expect, it } from "vitest";

import { buildProviderRequest, looksLikeHtml, htmlToPlainText } from "../buildOutreachMessage";

const baseDraft = {
  fromAddress: "sdr@acme.example",
  fromName: "SDR",
  toAddress: "lead@target.example",
  subject: "Hi",
  listUnsubscribeToken: "tok",
};

describe("looksLikeHtml", () => {
  it("detects real markup, ignores a stray angle bracket", () => {
    expect(looksLikeHtml("<p>Hi there</p>")).toBe(true);
    expect(looksLikeHtml("Line one<br/>Line two")).toBe(true);
    expect(looksLikeHtml("Revenue < 5M and growing")).toBe(false);
    expect(looksLikeHtml("Plain text body")).toBe(false);
  });
});

describe("htmlToPlainText", () => {
  it("keeps line structure and strips tags", () => {
    expect(htmlToPlainText("<p>Hi Mai,</p><p>Quick question.</p>")).toBe("Hi Mai,\n\nQuick question.");
    expect(htmlToPlainText("<ul><li>One</li><li>Two</li></ul>")).toContain("• One");
  });
});

describe("buildProviderRequest", () => {
  const common = { messageId: "mid-1", unsubscribeMailto: "mailto:unsub@acme.example" };

  it("sends a plaintext body as text-only (legacy path untouched)", () => {
    const req = buildProviderRequest({ draft: { ...baseDraft, body: "Hi there,\nLet's talk." }, ...common });
    expect(req.body).toBe("Hi there,\nLet's talk.");
    expect(req.html).toBeUndefined();
  });

  it("splits an HTML body into html + a plaintext fallback", () => {
    const req = buildProviderRequest({ draft: { ...baseDraft, body: "<p>Hi there,</p><p>Let's talk.</p>" }, ...common });
    expect(req.html).toBe("<p>Hi there,</p><p>Let's talk.</p>");
    expect(req.body).toBe("Hi there,\n\nLet's talk.");
  });
});
