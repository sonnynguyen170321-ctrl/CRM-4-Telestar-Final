import "server-only";

import { buildOutreachReport, type OutreachReport } from "./buildOutreachReport";
import { queryTrackingAnalytics } from "./queryTrackingAnalytics";
import type { SenderKind, SenderStatus } from "../senderPool/policy";
import { traceQuery, withSpan } from "@/lib/v2/observability/trace";

// O8: thin tenant-scoped loader for the outreach report. D2 perf: message + activity
// counts are aggregated in SQL (COUNT(*) FILTER) instead of pulling every message/activity
// row over the wire to count in JS. Open/click are loaded only from verified CTD
// tracking analytics, never fabricated.

export async function queryOutreachReport(organizationId: string): Promise<OutreachReport> {
  const { prisma } = await import("@/lib/server/prisma");
  return withSpan("outreach.report", async () => {
    const [messageCounts, activityCounts, senders, suppression, tracking] = await Promise.all([
      traceQuery("outreach.messageCounts", () =>
        prisma.$queryRawUnsafe<Array<{ sent: number; bounced: number }>>(
          `SELECT COUNT(*) FILTER (WHERE "status" IN ('SENT','REPLIED','BOUNCED'))::int AS "sent",
                  COUNT(*) FILTER (WHERE "status" = 'BOUNCED')::int AS "bounced"
           FROM "V2OutreachMessage" WHERE "organizationId" = $1 AND "deletedAt" IS NULL`,
          organizationId
        )
      ),
      traceQuery("outreach.activityCounts", () =>
        prisma.$queryRawUnsafe<Array<{ replied: number; meetingsBooked: number; unsubscribed: number }>>(
          `SELECT COUNT(*) FILTER (WHERE "eventKind" = 'outreach.replied')::int AS "replied",
                  COUNT(*) FILTER (WHERE "eventKind" = 'outreach.meeting_booked')::int AS "meetingsBooked",
                  COUNT(*) FILTER (WHERE "eventKind" = 'outreach.unsubscribed')::int AS "unsubscribed"
           FROM "V2OutreachActivity" WHERE "organizationId" = $1`,
          organizationId
        )
      ),
      traceQuery("outreach.senders", () =>
        prisma.$queryRawUnsafe<Array<{ id: string; kind: string; status: string; dailyCapCurrent: number; dailyCapTarget: number; warmupStage: number; bounceRate: number; complaintRate: number; sentToday: number; displayName: string | null; fromAddress: string | null }>>(
          `SELECT s."id", s."kind"::text AS kind, s."status"::text AS status, s."dailyCapCurrent", s."dailyCapTarget",
                  s."warmupStage", s."bounceRate", s."complaintRate", s."displayName", s."fromAddress",
                  COALESCE((SELECT d."count" FROM "V2SenderDailySend" d WHERE d."senderAccountId" = s."id" AND d."sendDate" = CURRENT_DATE), 0)::int AS "sentToday"
           FROM "V2SenderAccount" s
           WHERE s."organizationId" = $1 AND s."deletedAt" IS NULL`,
          organizationId
        ), (r) => r.length
      ),
      traceQuery("outreach.suppression", () =>
        prisma.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT COUNT(*)::int AS n FROM "V2SuppressionEntry" WHERE "organizationId" = $1 AND "deletedAt" IS NULL`,
          organizationId
        )
      ),
      traceQuery("outreach.tracking", () => queryTrackingAnalytics(organizationId)),
    ]);

    return buildOutreachReport({
      messageCounts: {
        sent: Number(messageCounts[0]?.sent ?? 0),
        bounced: Number(messageCounts[0]?.bounced ?? 0),
      },
      activityCounts: {
        replied: Number(activityCounts[0]?.replied ?? 0),
        meetingsBooked: Number(activityCounts[0]?.meetingsBooked ?? 0),
        unsubscribed: Number(activityCounts[0]?.unsubscribed ?? 0),
      },
      senders: senders.map((s) => ({
        ...s,
        kind: s.kind as SenderKind,
        status: s.status as SenderStatus,
        sentToday: Number(s.sentToday),
        lastSendAt: null,
      })),
      suppressionBlocks: Number(suppression[0]?.n ?? 0),
      tracking,
    });
  });
}
