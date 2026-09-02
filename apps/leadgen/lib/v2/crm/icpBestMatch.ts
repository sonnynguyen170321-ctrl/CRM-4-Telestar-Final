import "server-only";

import { prisma } from "@/lib/server/prisma";
import type { LeadWorkspaceQualification, LeadWorkspaceAccountPreRank } from "./types";
import { rankIcpAssignments, type IcpBestMatchResult } from "./icpBestMatchRanking";

// S1 multi-ICP best-match read model. A company can have N LeadAssignments — one
// per (Project × ICPVersion) (Invariant 2). This loads them (optionally scoped to a
// project) and ranks best-first via the pure core. Tenant-scoped (Invariant 5);
// soft-delete respected (Invariant 8).

export * from "./icpBestMatchRanking";

type SqlRow = {
  leadAssignmentId: string;
  projectId: string;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: string | null;
  accountPreRank: string | null;
  fitScore: number | null;
  confidenceScore: number | null;
  ownerUserId: string | null;
  createdAt: Date;
};

export async function queryCompanyIcpBestMatch(
  organizationId: string,
  companyId: string,
  options: { projectId?: string } = {}
): Promise<IcpBestMatchResult> {
  const args: unknown[] = [organizationId, companyId];
  let projectClause = "";
  if (options.projectId) {
    args.push(options.projectId);
    projectClause = `AND lead."projectId" = $${args.length}`;
  }

  const rows = await prisma.$queryRawUnsafe<SqlRow[]>(
    `SELECT
       lead."id" AS "leadAssignmentId",
       project."id" AS "projectId",
       project."name" AS "projectName",
       profile."name" AS "icpProfileName",
       icp."versionNumber" AS "icpVersionNumber",
       lead."workflowStatus"::text AS "workflowStatus",
       assessment."qualification"::text AS "qualification",
       assessment."accountPreRank"::text AS "accountPreRank",
       assessment."fitScore" AS "fitScore",
       assessment."confidence" AS "confidenceScore",
       lead."ownerUserId" AS "ownerUserId",
       lead."createdAt" AS "createdAt"
     FROM "V2LeadAssignment" lead
     INNER JOIN "V2ICPVersion" icp ON icp."id" = lead."icpVersionId" AND icp."organizationId" = lead."organizationId"
     INNER JOIN "V2ICPProfile" profile ON profile."id" = icp."icpProfileId" AND profile."organizationId" = lead."organizationId"
     INNER JOIN "V2Project" project ON project."id" = lead."projectId" AND project."organizationId" = lead."organizationId"
     LEFT JOIN "V2HardRuleAssessment" assessment ON assessment."id" = lead."latestHardRuleAssessmentId" AND assessment."organizationId" = lead."organizationId"
     WHERE lead."organizationId" = $1 AND lead."companyId" = $2
       AND lead."status" = 'ACTIVE' AND lead."deletedAt" IS NULL
       ${projectClause}
     LIMIT 100`,
    ...args
  );

  return rankIcpAssignments(
    rows.map((r) => ({
      leadAssignmentId: r.leadAssignmentId,
      projectId: r.projectId,
      projectName: r.projectName,
      icpProfileName: r.icpProfileName,
      icpVersionNumber: r.icpVersionNumber,
      workflowStatus: r.workflowStatus,
      qualification: (r.qualification as LeadWorkspaceQualification) || "NOT_SCORED",
      accountPreRank: (r.accountPreRank as LeadWorkspaceAccountPreRank) || null,
      fitScore: r.fitScore === null ? null : Number(r.fitScore),
      confidenceScore: r.confidenceScore === null ? null : Number(r.confidenceScore),
      ownerUserId: r.ownerUserId,
      createdAt: new Date(r.createdAt).toISOString(),
    }))
  );
}
