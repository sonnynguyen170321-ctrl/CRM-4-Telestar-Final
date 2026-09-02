import "server-only";

import { prisma } from "@/lib/server/prisma";

// Live pipeline-stage read-model for the cockpit board (Import -> Enrich -> Score -> Review).
// Read-only, tenant-scoped, LeadAssignment-level. Every number is derived from real rows so the
// board never invents a count. `enrichCompanyIds` (capped) feeds the inline "Enrich all" runner,
// which calls the SAME extractCompanyIntelligenceBulkAction the Companies workspace uses — no new
// business logic, no scoring queued from here. NOT_SCORED = latestHardRuleAssessmentId IS NULL
// (Invariant 7: derived, never a placeholder row).

export type PipelineStages = {
  enrichCount: number; // active companies with no intelligence profile yet
  scoreCount: number; // active NOT_SCORED LeadAssignments
  reviewCount: number; // open manager review items
  enrichCompanyIds: string[]; // un-enriched company ids (cap 200) for the inline runner
};

const ENRICH_CAP = 200;

export async function queryPipelineStages(organizationId: string): Promise<PipelineStages> {
  const [counts, ids] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ enrichCount: number; scoreCount: number; reviewCount: number }>>(
      `SELECT
         (SELECT COUNT(*)::int FROM "V2Company" c
            WHERE c."organizationId"=$1 AND c."status"='ACTIVE' AND c."deletedAt" IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM "V2CompanyIntelligenceProfile" p
                 WHERE p."organizationId"=$1 AND p."companyId"=c."id")) AS "enrichCount",
         (SELECT COUNT(*)::int FROM "V2LeadAssignment" l
            WHERE l."organizationId"=$1 AND l."status"='ACTIVE' AND l."deletedAt" IS NULL
              AND l."latestHardRuleAssessmentId" IS NULL) AS "scoreCount",
         (SELECT COUNT(*)::int FROM "V2ManagerReviewItem"
            WHERE "organizationId"=$1 AND "status"='OPEN' AND "deletedAt" IS NULL) AS "reviewCount"`,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT c."id" FROM "V2Company" c
         WHERE c."organizationId"=$1 AND c."status"='ACTIVE' AND c."deletedAt" IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM "V2CompanyIntelligenceProfile" p
              WHERE p."organizationId"=$1 AND p."companyId"=c."id")
         ORDER BY c."createdAt" DESC
         LIMIT ${ENRICH_CAP}`,
      organizationId
    ),
  ]);

  const row = counts[0] ?? { enrichCount: 0, scoreCount: 0, reviewCount: 0 };
  return {
    enrichCount: row.enrichCount ?? 0,
    scoreCount: row.scoreCount ?? 0,
    reviewCount: row.reviewCount ?? 0,
    enrichCompanyIds: ids.map((r) => r.id),
  };
}
