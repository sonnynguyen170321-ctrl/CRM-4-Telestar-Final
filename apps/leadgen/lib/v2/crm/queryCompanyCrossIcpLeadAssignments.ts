import { prisma } from "@/lib/server/prisma";
import type { LeadWorkspaceQualification, LeadWorkspaceAccountPreRank } from "./types";

export type CrossIcpLeadAssignmentRow = {
  id: string;
  projectId: string;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: LeadWorkspaceQualification;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  fitScore: number | null;
  confidenceScore: number | null;
  createdAt: Date;
};

export async function queryCompanyCrossIcpLeadAssignments(
  organizationId: string,
  companyId: string,
  currentLeadAssignmentId: string
): Promise<CrossIcpLeadAssignmentRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    id: string;
    projectId: string;
    projectName: string;
    icpProfileName: string;
    icpVersionNumber: number;
    workflowStatus: string;
    qualification: string | null;
    accountPreRank: string | null;
    fitScore: number | null;
    confidenceScore: number | null;
    createdAt: Date;
  }>>`
    SELECT
      lead."id",
      project."id" AS "projectId",
      project."name" AS "projectName",
      profile."name" AS "icpProfileName",
      icp."versionNumber",
      lead."workflowStatus",
      assessment."qualification"::text AS "qualification",
      assessment."accountPreRank"::text AS "accountPreRank",
      assessment."fitScore",
      assessment."confidence" AS "confidenceScore",
      lead."createdAt"
    FROM "V2LeadAssignment" lead
    INNER JOIN "V2ICPVersion" icp
      ON icp."id" = lead."icpVersionId"
      AND icp."organizationId" = lead."organizationId"
    INNER JOIN "V2ICPProfile" profile
      ON profile."id" = icp."icpProfileId"
      AND profile."organizationId" = lead."organizationId"
    INNER JOIN "V2Project" project
      ON project."id" = lead."projectId"
      AND project."organizationId" = lead."organizationId"
    LEFT JOIN "V2HardRuleAssessment" assessment
      ON assessment."id" = lead."latestHardRuleAssessmentId"
      AND assessment."organizationId" = lead."organizationId"
    WHERE lead."organizationId" = ${organizationId}
      AND lead."companyId" = ${companyId}
      AND lead."id" != ${currentLeadAssignmentId}
      AND lead."status" = 'ACTIVE'
      AND lead."deletedAt" IS NULL
    ORDER BY lead."createdAt" DESC
    LIMIT 50
  `;

  return rows.map(row => ({
    ...row,
    qualification: (row.qualification as LeadWorkspaceQualification) || "NOT_SCORED",
    accountPreRank: (row.accountPreRank as LeadWorkspaceAccountPreRank) || null,
    confidenceScore: row.confidenceScore === null ? null : Number(row.confidenceScore),
  }));
}
