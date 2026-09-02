import "server-only";

import { prisma } from "@/lib/server/prisma";
import { queryCampaigns } from "@/lib/v2/outreach/campaigns/queryCampaigns";
import {
  buildFunnel,
  buildLeaderboard,
  fillTrend,
  normalizeWindowDays,
  type CampaignLeaderboardRow,
  type PerformanceFunnel,
  type TrendPoint,
} from "./campaignPerformanceMath";

// Cross-campaign performance read-model for the /v2/outreach/performance dashboard:
// a per-campaign leaderboard, an org funnel, and daily time-series trends over a window.
// Tenant-scoped (Inv 5), soft-delete filtered. Open metrics stay honest — null (hidden)
// unless a VERIFIED tracking domain exists (no fabricated zeros). Pure shaping lives in
// campaignPerformanceMath.ts (unit-tested); this file owns the SQL only.

export { normalizeWindowDays };
export type { CampaignLeaderboardRow, PerformanceFunnel, TrendPoint };

export type CampaignPerformance = {
  windowDays: number;
  leaderboard: CampaignLeaderboardRow[];
  funnel: PerformanceFunnel;
  trackingAvailable: boolean;
  trend: TrendPoint[];
};

export async function queryCampaignPerformance(
  organizationId: string,
  options: { windowDays?: number } = {}
): Promise<CampaignPerformance> {
  const windowDays = normalizeWindowDays(options.windowDays);

  const [campaigns, meetingsRow, trackingDomain] = await Promise.all([
    queryCampaigns(organizationId),
    prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS "count" FROM "V2OutreachActivity"
       WHERE "organizationId" = $1 AND "eventKind" = 'outreach.meeting_booked'`,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "V2TrackingDomain"
         WHERE "organizationId" = $1 AND "status" = 'VERIFIED' AND "deletedAt" IS NULL) AS "exists"`,
      organizationId
    ),
  ]);

  const trackingAvailable = trackingDomain[0]?.exists === true;
  const opened = trackingAvailable ? await countUniqueOpens(organizationId, null) : null;

  const leaderboard = buildLeaderboard(campaigns);
  const funnel = buildFunnel(campaigns, Number(meetingsRow[0]?.count ?? 0), opened);
  const trend = await buildTrend(organizationId, windowDays, trackingAvailable);

  return { windowDays, leaderboard, funnel, trackingAvailable, trend };
}

async function countUniqueOpens(organizationId: string, since: Date | null): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(DISTINCT "messageId")::int AS "count" FROM "V2OutreachTrackingEvent"
     WHERE "organizationId" = $1 AND "eventKind" = 'OPEN' AND "botClassification" = 'HUMAN'
       ${since ? `AND "occurredAt" >= $2` : ""}`,
    ...(since ? [organizationId, since] : [organizationId])
  );
  return Number(rows[0]?.count ?? 0);
}

async function buildTrend(
  organizationId: string,
  windowDays: number,
  trackingAvailable: boolean
): Promise<TrendPoint[]> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [sends, activities, opens] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ day: string; count: number }>>(
      `SELECT to_char(date_trunc('day', "sentAt"), 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "count"
       FROM "V2OutreachMessage"
       WHERE "organizationId" = $1 AND "deletedAt" IS NULL AND "sentAt" IS NOT NULL
         AND "status" IN ('SENT','REPLIED','BOUNCED') AND "sentAt" >= $2
       GROUP BY 1`,
      organizationId,
      since
    ),
    prisma.$queryRawUnsafe<Array<{ day: string; kind: string; count: number }>>(
      `SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS "day", "eventKind" AS "kind", COUNT(*)::int AS "count"
       FROM "V2OutreachActivity"
       WHERE "organizationId" = $1 AND "occurredAt" >= $2
         AND "eventKind" IN ('outreach.replied','outreach.meeting_booked')
       GROUP BY 1, 2`,
      organizationId,
      since
    ),
    trackingAvailable
      ? prisma.$queryRawUnsafe<Array<{ day: string; count: number }>>(
          `SELECT to_char(date_trunc('day', "occurredAt"), 'YYYY-MM-DD') AS "day", COUNT(DISTINCT "messageId")::int AS "count"
           FROM "V2OutreachTrackingEvent"
           WHERE "organizationId" = $1 AND "eventKind" = 'OPEN' AND "botClassification" = 'HUMAN' AND "occurredAt" >= $2
           GROUP BY 1`,
          organizationId,
          since
        )
      : Promise.resolve<Array<{ day: string; count: number }>>([]),
  ]);

  const repliedByDay = new Map<string, number>();
  const meetingByDay = new Map<string, number>();
  for (const a of activities) {
    const map = a.kind === "outreach.replied" ? repliedByDay : meetingByDay;
    map.set(a.day, Number(a.count));
  }

  return fillTrend(windowDays, {
    sent: new Map(sends.map((r) => [r.day, Number(r.count)])),
    opened: new Map(opens.map((r) => [r.day, Number(r.count)])),
    replied: repliedByDay,
    meetings: meetingByDay,
  });
}
