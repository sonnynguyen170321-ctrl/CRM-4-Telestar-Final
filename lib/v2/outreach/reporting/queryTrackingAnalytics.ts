import "server-only";

import { prisma } from "@/lib/server/prisma";

// CTD analytics — HONEST. Counts UNIQUE messages opened/clicked (not raw event
// rows), excludes non-human (bot/proxy) events, and is HIDDEN entirely
// (trackingEnabled=false) unless the org has a VERIFIED tracking domain. No fake
// zero-filled metrics when tracking isn't actually running (V9 guardrail).

export type TrackingAnalytics = {
  trackingEnabled: boolean;
  uniqueOpens: number;
  uniqueClicks: number;
  totalOpens: number;
  totalClicks: number;
};

export async function queryTrackingAnalytics(
  organizationId: string,
  options: { messageIds?: string[] } = {}
): Promise<TrackingAnalytics> {
  const verifiedRows = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT COUNT(*)::int AS n FROM "V2TrackingDomain"
     WHERE "organizationId" = $1 AND "status" = 'VERIFIED' AND "deletedAt" IS NULL`,
    organizationId
  );
  if (Number(verifiedRows[0]?.n ?? 0) === 0) {
    return { trackingEnabled: false, uniqueOpens: 0, uniqueClicks: 0, totalOpens: 0, totalClicks: 0 };
  }

  const ids = options.messageIds && options.messageIds.length > 0 ? options.messageIds : null;
  const rows = await prisma.$queryRawUnsafe<
    Array<{ uo: bigint; uc: bigint; to: bigint; tc: bigint }>
  >(
    `SELECT
       COUNT(DISTINCT CASE WHEN "eventKind" = 'OPEN' THEN "messageId" END) AS uo,
       COUNT(DISTINCT CASE WHEN "eventKind" = 'CLICK' THEN "messageId" END) AS uc,
       COUNT(*) FILTER (WHERE "eventKind" = 'OPEN') AS "to",
       COUNT(*) FILTER (WHERE "eventKind" = 'CLICK') AS tc
     FROM "V2OutreachTrackingEvent"
     WHERE "organizationId" = $1 AND "botClassification" = 'HUMAN'
       ${ids ? `AND "messageId" = ANY($2::text[])` : ""}`,
    ...(ids ? [organizationId, ids] : [organizationId])
  );
  const r = rows[0];
  return {
    trackingEnabled: true,
    uniqueOpens: Number(r?.uo ?? 0),
    uniqueClicks: Number(r?.uc ?? 0),
    totalOpens: Number(r?.to ?? 0),
    totalClicks: Number(r?.tc ?? 0),
  };
}
