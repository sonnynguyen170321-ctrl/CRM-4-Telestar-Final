import "server-only";

import { prisma } from "@/lib/server/prisma";

export type ActivityRecapStats = {
  totalActivityRecords: number;
  pendingApplyJobs: number;
  openReviewItems: number;
  recentRecords: ActivityRecordRow[];
};

export type ActivityRecordRow = {
  id: string;
  leadAssignmentId: string;
  channel: string;
  activityType: string;
  outcome: string;
  occurredAt: Date;
  actorUserId: string | null;
  note: string | null;
};

export async function queryActivityRecapStats(
  organizationId: string
): Promise<ActivityRecapStats> {
  if (!organizationId) {
    throw new Error("queryActivityRecapStats: organizationId is required.");
  }

  const [countRows, pendingRows, reviewRows, recentRows] = await Promise.all([
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "V2ActivityRecord"
      WHERE "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "V2Job"
      WHERE "organizationId" = ${organizationId}
        AND "jobType" = 'ACTIVITY_APPLY'
        AND "status" IN ('QUEUED', 'RUNNING')
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "V2ManagerReviewItem"
      WHERE "organizationId" = ${organizationId}
        AND "sourceType" = 'ACTIVITY_RECAP_ROW'
        AND "status" IN ('OPEN', 'IN_PROGRESS', 'SNOOZED')
        AND "deletedAt" IS NULL
    `,
    prisma.$queryRaw<ActivityRecordRow[]>`
      SELECT
        id,
        "leadAssignmentId",
        channel,
        "activityType",
        outcome,
        "occurredAt",
        "actorUserId",
        note
      FROM "V2ActivityRecord"
      WHERE "organizationId" = ${organizationId}
        AND "deletedAt" IS NULL
      ORDER BY "occurredAt" DESC
      LIMIT 20
    `,
  ]);

  return {
    totalActivityRecords: Number(countRows[0]?.count ?? 0),
    pendingApplyJobs: Number(pendingRows[0]?.count ?? 0),
    openReviewItems: Number(reviewRows[0]?.count ?? 0),
    recentRecords: recentRows,
  };
}
