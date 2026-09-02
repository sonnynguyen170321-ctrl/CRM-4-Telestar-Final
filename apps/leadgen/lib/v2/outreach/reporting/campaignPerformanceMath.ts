// Pure (prisma-free) math for the campaign performance dashboard, so the leaderboard /
// funnel / trend logic is unit-testable without a database. queryCampaignPerformance.ts
// runs the SQL and delegates the shaping here.

import type { CampaignSummary } from "@/lib/v2/outreach/campaigns/queryCampaigns";

export type CampaignLeaderboardRow = CampaignSummary & {
  delivered: number;
  replyRate: number; // 0..1 of delivered
  bounceRate: number; // 0..1 of sent
};

export type PerformanceFunnel = {
  enrolled: number;
  sent: number;
  delivered: number;
  opened: number | null;
  replied: number;
  meetings: number;
};

export type TrendPoint = { date: string; sent: number; opened: number; replied: number; meetings: number };

export const ALLOWED_WINDOWS = [7, 30, 90] as const;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeWindowDays(value: string | number | undefined): number {
  const n = typeof value === "string" ? parseInt(value, 10) : value;
  return n != null && (ALLOWED_WINDOWS as readonly number[]).includes(n) ? n : 30;
}

export function buildLeaderboard(campaigns: CampaignSummary[]): CampaignLeaderboardRow[] {
  return campaigns.map((c) => {
    const delivered = Math.max(c.sentCount - c.bouncedCount, 0);
    return {
      ...c,
      delivered,
      replyRate: delivered > 0 ? c.repliedCount / delivered : 0,
      bounceRate: c.sentCount > 0 ? c.bouncedCount / c.sentCount : 0,
    };
  });
}

export function buildFunnel(
  campaigns: CampaignSummary[],
  meetings: number,
  opened: number | null
): PerformanceFunnel {
  const totals = campaigns.reduce(
    (acc, c) => ({
      enrolled: acc.enrolled + c.enrolledCount,
      sent: acc.sent + c.sentCount,
      bounced: acc.bounced + c.bouncedCount,
      replied: acc.replied + c.repliedCount,
    }),
    { enrolled: 0, sent: 0, bounced: 0, replied: 0 }
  );
  return {
    enrolled: totals.enrolled,
    sent: totals.sent,
    delivered: Math.max(totals.sent - totals.bounced, 0),
    opened,
    replied: totals.replied,
    meetings,
  };
}

/** Fill a continuous day series (oldest→newest) from per-day count maps keyed YYYY-MM-DD. */
export function fillTrend(
  windowDays: number,
  maps: {
    sent: Map<string, number>;
    opened: Map<string, number>;
    replied: Map<string, number>;
    meetings: Map<string, number>;
  },
  nowMs: number = Date.now()
): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = windowDays - 1; i >= 0; i -= 1) {
    const day = new Date(nowMs - i * DAY_MS).toISOString().slice(0, 10);
    points.push({
      date: day,
      sent: maps.sent.get(day) ?? 0,
      opened: maps.opened.get(day) ?? 0,
      replied: maps.replied.get(day) ?? 0,
      meetings: maps.meetings.get(day) ?? 0,
    });
  }
  return points;
}
