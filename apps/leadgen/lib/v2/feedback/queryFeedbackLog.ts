import "server-only";

import { prisma } from "@/lib/server/prisma";

export type FeedbackLogRow = {
  id: string;
  leadAssignmentId: string;
  companyName: string | null;
  icpProfileName: string | null;
  icpVersionNumber: number | null;
  source: string;
  predictedQualification: string | null;
  finalQualification: string;
  predictedFitScore: number | null;
  finalFitScore: number | null;
  finalReason: string | null;
  reviewerEmail: string | null;
  approvedForLearning: boolean;
  datasetSplit: string;
  createdAt: string;
};

export type FeedbackLogStats = {
  total: number;
  approvedForLearning: number;
  distinctLeads: number;
};

export type QueryFeedbackLogInput = {
  organizationId: string;
  leadAssignmentId?: string;
  limit?: number;
};

export type QueryFeedbackLogResult = {
  rows: FeedbackLogRow[];
  stats: FeedbackLogStats;
};

export async function queryFeedbackLog(
  input: QueryFeedbackLogInput
): Promise<QueryFeedbackLogResult> {
  if (!input.organizationId) {
    throw new Error("queryFeedbackLog: organizationId is required.");
  }

  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const leadFilter = input.leadAssignmentId?.trim() || null;

  const [rows, statsRows] = await Promise.all([
    prisma.$queryRawUnsafe<FeedbackLogRow[]>(
      `
        SELECT
          fb."id",
          fb."leadAssignmentId",
          company."name" AS "companyName",
          profile."name" AS "icpProfileName",
          icp."versionNumber" AS "icpVersionNumber",
          fb."source",
          fb."predictedQualification"::text AS "predictedQualification",
          fb."finalQualification"::text AS "finalQualification",
          fb."predictedFitScore",
          fb."finalFitScore",
          fb."finalReason",
          reviewer."emailNormalized" AS "reviewerEmail",
          fb."approvedForLearning",
          fb."datasetSplit"::text AS "datasetSplit",
          fb."createdAt"
        FROM "V2FeedbackExample" fb
        LEFT JOIN "V2LeadAssignment" lead
          ON lead."id" = fb."leadAssignmentId"
          AND lead."organizationId" = fb."organizationId"
        LEFT JOIN "V2Company" company
          ON company."id" = lead."companyId"
          AND company."organizationId" = fb."organizationId"
        LEFT JOIN "V2ICPVersion" icp
          ON icp."id" = fb."icpVersionId"
          AND icp."organizationId" = fb."organizationId"
        LEFT JOIN "V2ICPProfile" profile
          ON profile."id" = icp."icpProfileId"
          AND profile."organizationId" = fb."organizationId"
        LEFT JOIN "V2User" reviewer
          ON reviewer."id" = fb."reviewedByUserId"
        WHERE fb."organizationId" = $1
          ${leadFilter ? `AND fb."leadAssignmentId" = $2` : ""}
        ORDER BY fb."createdAt" DESC
        LIMIT ${limit}
      `,
      ...(leadFilter ? [input.organizationId, leadFilter] : [input.organizationId])
    ),
    prisma.$queryRawUnsafe<
      Array<{ total: bigint; approved: bigint; distinctLeads: bigint }>
    >(
      `
        SELECT
          COUNT(*)::bigint AS "total",
          COUNT(*) FILTER (WHERE "approvedForLearning")::bigint AS "approved",
          COUNT(DISTINCT "leadAssignmentId")::bigint AS "distinctLeads"
        FROM "V2FeedbackExample"
        WHERE "organizationId" = $1
          ${leadFilter ? `AND "leadAssignmentId" = $2` : ""}
      `,
      ...(leadFilter ? [input.organizationId, leadFilter] : [input.organizationId])
    ),
  ]);

  const stats = statsRows[0];

  return {
    rows: rows.map((row) => ({
      ...row,
      createdAt: new Date(row.createdAt as string | Date).toISOString(),
    })),
    stats: {
      total: Number(stats?.total ?? 0),
      approvedForLearning: Number(stats?.approved ?? 0),
      distinctLeads: Number(stats?.distinctLeads ?? 0),
    },
  };
}
