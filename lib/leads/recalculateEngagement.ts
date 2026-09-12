import { Prisma } from "@prisma/client";

import { ENGAGEMENT_SIGNAL_VALUES } from "@/lib/leads/scoring";
import { prisma } from "@/lib/prisma";

export type EngagementRecalculationSummary = {
  updatedCount: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
};

/**
 * Recalculate one tenant atomically.
 *
 * This remains a synchronous operator action because PostgreSQL can derive every row in one
 * statement. If the statement fails, it rolls back; no queue/checkpoint state is needed.
 */
export async function recalculateTenantEngagement(
  tenantId: string,
): Promise<EngagementRecalculationSummary> {
  const [summary] = await prisma.$queryRaw<
    EngagementRecalculationSummary[]
  >(Prisma.sql`
    WITH updated AS (
      UPDATE "Lead" AS lead
      SET
        "engagementScore" = CASE
          WHEN EXISTS (
            SELECT 1
            FROM "Meeting" AS meeting
            WHERE meeting."tenantId" = lead."tenantId"
              AND meeting."leadId" = lead."id"
          ) THEN ${ENGAGEMENT_SIGNAL_VALUES.meeting}
          WHEN lead."emailReplyCount" > 0 THEN ${ENGAGEMENT_SIGNAL_VALUES.reply}
          WHEN lead."emailOpenCount" > 0
            THEN LEAST(lead."emailOpenCount", ${ENGAGEMENT_SIGNAL_VALUES.maxOpens})
              * ${ENGAGEMENT_SIGNAL_VALUES.open}
          ELSE 0
        END,
        "crmPriorityScore" = CASE
          WHEN EXISTS (
            SELECT 1
            FROM "Meeting" AS meeting
            WHERE meeting."tenantId" = lead."tenantId"
              AND meeting."leadId" = lead."id"
          ) OR lead."emailReplyCount" > 0 THEN 'hot'::"Priority"
          WHEN lead."emailOpenCount" > 0 THEN 'warm'::"Priority"
          ELSE 'cold'::"Priority"
        END,
        "updatedAt" = NOW()
      WHERE lead."tenantId" = ${tenantId}
        AND lead."archivedAt" IS NULL
      RETURNING "crmPriorityScore"
    )
    SELECT
      COUNT(*)::int AS "updatedCount",
      COUNT(*) FILTER (WHERE "crmPriorityScore" = 'hot')::int AS "hotCount",
      COUNT(*) FILTER (WHERE "crmPriorityScore" = 'warm')::int AS "warmCount",
      COUNT(*) FILTER (WHERE "crmPriorityScore" = 'cold')::int AS "coldCount"
    FROM updated
  `);

  return (
    summary ?? { updatedCount: 0, hotCount: 0, warmCount: 0, coldCount: 0 }
  );
}
