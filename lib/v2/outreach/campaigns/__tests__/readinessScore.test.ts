import { describe, expect, it } from "vitest";

import { computeCampaignReadiness } from "../readinessScore";
import { classifyReply } from "../../inbox/classifyReply";

describe("computeCampaignReadiness", () => {
  const ready = {
    stepCount: 2, senderCount: 1, liveSenderCount: 1, enrolledCount: 40,
    trackingEnabled: false, verifiedTrackingSenderCount: 0, hasSchedule: true, outreachReadyLeadRatio: 0.8,
  };
  it("scores a fully-set campaign as ready", () => {
    const r = computeCampaignReadiness(ready);
    expect(r.score).toBe(100);
    expect(r.band).toBe("ready");
    expect(r.blockers).toEqual([]);
  });
  it("drops score + lists blockers when key pieces are missing", () => {
    const r = computeCampaignReadiness({ ...ready, liveSenderCount: 0, enrolledCount: 0 });
    expect(r.score).toBeLessThan(85);
    expect(r.blockers).toContain("A live-enabled sender");
    expect(r.blockers).toContain("Enrolled leads");
  });
  it("flags unverified tracking only when tracking is enabled", () => {
    const off = computeCampaignReadiness({ ...ready, trackingEnabled: false, verifiedTrackingSenderCount: 0 });
    const on = computeCampaignReadiness({ ...ready, trackingEnabled: true, verifiedTrackingSenderCount: 0 });
    expect(off.checks.find((c) => c.key === "tracking")?.ok).toBe(true);
    expect(on.checks.find((c) => c.key === "tracking")?.ok).toBe(false);
  });
});

describe("classifyReply", () => {
  it("prioritizes bounce + auto-reply + unsubscribe over intent", () => {
    expect(classifyReply({ body: "Delivery has failed to these recipients" })).toBe("BOUNCE");
    expect(classifyReply({ isBounce: true, body: "hi" })).toBe("BOUNCE");
    expect(classifyReply({ body: "I am out of office until Monday, happy to chat later" })).toBe("AUTO_REPLY");
    expect(classifyReply({ body: "please unsubscribe me" })).toBe("UNSUBSCRIBE");
  });
  it("detects meeting intent + positive + not-interested", () => {
    expect(classifyReply({ body: "Sure, let's set up a call — here's my calendly" })).toBe("MEETING_INTENT");
    expect(classifyReply({ body: "Interested, can you send me more pricing details?" })).toBe("POSITIVE");
    expect(classifyReply({ body: "Not interested, we're all set thanks" })).toBe("NOT_INTERESTED");
  });
  it("falls back to needs-review for ambiguous human replies", () => {
    expect(classifyReply({ body: "Who is this?" })).toBe("NEEDS_REVIEW");
  });
});
