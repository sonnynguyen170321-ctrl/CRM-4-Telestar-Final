import { describe, expect, it } from "vitest";

import { calculateLeadScore, DEFAULT_SCORING_RULES } from "@/lib/leads/scoring";
import { signWebhookPayload } from "@/lib/webhooks/dispatcher";

describe("Custom Webhook Signature Engine", () => {
  it("computes deterministic HMAC-SHA256 signatures", () => {
    const payload = JSON.stringify({ event: "lead.created", id: "123" });
    const secret = "whsec_sample_secret_key_12345";
    const sig1 = signWebhookPayload(payload, secret);
    const sig2 = signWebhookPayload(payload, secret);
    expect(sig1).toBe(sig2);
    expect(sig1).toHaveLength(64);
  });

  it("produces different signatures for different secrets or payloads", () => {
    const payload = JSON.stringify({ event: "lead.created" });
    expect(signWebhookPayload(payload, "secret_1")).not.toBe(
      signWebhookPayload(payload, "secret_2"),
    );
  });
});

describe("Fixed Engagement Engine", () => {
  it("ignores title and contact completeness", () => {
    const result = calculateLeadScore(
      {
        title: "Chief Technology Officer",
        emailValidation: "valid",
        phone: "+1 415 555 0199",
      },
      DEFAULT_SCORING_RULES,
    );
    expect(result).toEqual({
      score: 0,
      priority: "cold",
      reason: "no_engagement",
      breakdown: [],
    });
  });

  it("caps opens at 40 and keeps them Warm", () => {
    const result = calculateLeadScore(
      { emailOpenCount: 99 },
      DEFAULT_SCORING_RULES,
    );
    expect(result).toMatchObject({
      score: 40,
      priority: "warm",
      reason: "email_opened",
    });
  });

  it("makes a reply Hot and a meeting the strongest signal", () => {
    expect(
      calculateLeadScore({ emailReplyCount: 1 }, DEFAULT_SCORING_RULES),
    ).toMatchObject({
      score: 80,
      priority: "hot",
    });
    expect(
      calculateLeadScore({ meetingCount: 1 }, DEFAULT_SCORING_RULES),
    ).toMatchObject({
      score: 100,
      priority: "hot",
    });
  });
});
