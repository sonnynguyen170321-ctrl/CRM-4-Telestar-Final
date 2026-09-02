import { describe, expect, it } from "vitest";

import type { CampaignSummary } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import {
  buildFunnel,
  buildLeaderboard,
  fillTrend,
  normalizeWindowDays,
} from "../campaignPerformanceMath";

function campaign(partial: Partial<CampaignSummary>): CampaignSummary {
  return {
    id: "c1",
    name: "C",
    description: null,
    status: "ACTIVE",
    timezoneMode: "LEAD",
    fallbackTimezone: "UTC",
    scheduleJson: null,
    trackingEnabled: false,
    launchedAt: null,
    pausedAt: null,
    updatedAt: new Date(0).toISOString(),
    stepCount: 1,
    variantCount: 1,
    senderCount: 1,
    liveSenderCount: 1,
    enrolledCount: 0,
    sentCount: 0,
    repliedCount: 0,
    bouncedCount: 0,
    failedCount: 0,
    verifiedTrackingSenderCount: 0,
    readiness: [],
    ...partial,
  };
}

describe("normalizeWindowDays", () => {
  it("accepts allowed windows, defaults the rest to 30", () => {
    expect(normalizeWindowDays(7)).toBe(7);
    expect(normalizeWindowDays("90")).toBe(90);
    expect(normalizeWindowDays(5)).toBe(30);
    expect(normalizeWindowDays(undefined)).toBe(30);
    expect(normalizeWindowDays("bad")).toBe(30);
  });
});

describe("buildLeaderboard", () => {
  it("computes delivered + reply/bounce rates, guarding divide-by-zero", () => {
    const [a, b] = buildLeaderboard([
      campaign({ id: "a", sentCount: 100, bouncedCount: 10, repliedCount: 18 }),
      campaign({ id: "b", sentCount: 0, bouncedCount: 0, repliedCount: 0 }),
    ]);
    expect(a.delivered).toBe(90);
    expect(a.replyRate).toBeCloseTo(18 / 90);
    expect(a.bounceRate).toBeCloseTo(10 / 100);
    expect(b.delivered).toBe(0);
    expect(b.replyRate).toBe(0);
    expect(b.bounceRate).toBe(0);
  });
});

describe("buildFunnel", () => {
  it("sums campaigns and passes opened/meetings through", () => {
    const f = buildFunnel(
      [
        campaign({ enrolledCount: 50, sentCount: 40, bouncedCount: 4, repliedCount: 6 }),
        campaign({ enrolledCount: 30, sentCount: 20, bouncedCount: 1, repliedCount: 3 }),
      ],
      5,
      12
    );
    expect(f).toEqual({ enrolled: 80, sent: 60, delivered: 55, opened: 12, replied: 9, meetings: 5 });
  });

  it("keeps opened null when tracking is unavailable", () => {
    expect(buildFunnel([], 0, null).opened).toBeNull();
  });
});

describe("fillTrend", () => {
  it("returns a continuous oldest→newest day series, filling zeros", () => {
    const now = Date.UTC(2026, 5, 10, 12, 0, 0); // 2026-06-10
    const points = fillTrend(
      3,
      {
        sent: new Map([["2026-06-10", 5]]),
        opened: new Map(),
        replied: new Map([["2026-06-09", 2]]),
        meetings: new Map(),
      },
      now
    );
    expect(points.map((p) => p.date)).toEqual(["2026-06-08", "2026-06-09", "2026-06-10"]);
    expect(points[2].sent).toBe(5);
    expect(points[1].replied).toBe(2);
    expect(points[0]).toEqual({ date: "2026-06-08", sent: 0, opened: 0, replied: 0, meetings: 0 });
  });
});
