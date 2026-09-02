import "server-only";

import { createScoringRun } from "./createScoringRun";
import { enqueueScoringExecution } from "./enqueueScoringExecution";
import { ensureCompanyLeadAssignment, type FanOutScoringDb } from "./fanOutCompanyScoring";

// Flexible bulk scoring: score 1..N selected companies against 1..N USER-CHOSEN published
// ICP versions — NOT biased to whatever ICP(s) the company already sits in. For each
// (company × chosen ICP) it resolves the ICP's project, ensures a company-level
// LeadAssignment (idempotent — Inv 6), then runs ONE scoring run over the whole ensured
// set (BullMQ scoring.plan when enabled, else the ICP_SCORE V2Job). Tenant-scoped (Inv 5);
// unit = LeadAssignment (Inv 2). Drafts / no-rules ICPs are rejected (returned as invalid).

export type ScoreCompaniesAgainstIcpsInput = {
  organizationId: string;
  companyIds: string[];
  icpVersionIds: string[];
  createdByUserId?: string | null;
};

export type ScoreCompaniesAgainstIcpsResult = {
  ok: boolean;
  runId: string | null;
  mode: "bull" | "db" | "empty" | null;
  companies: number;
  icpVersions: number;
  ensured: number;
  created: number;
  existing: number;
  leadAssignmentIds: string[];
  invalidIcpVersionIds: string[];
};

const EMPTY = (invalidIcpVersionIds: string[] = []): ScoreCompaniesAgainstIcpsResult => ({
  ok: false,
  runId: null,
  mode: null,
  companies: 0,
  icpVersions: 0,
  ensured: 0,
  created: 0,
  existing: 0,
  leadAssignmentIds: [],
  invalidIcpVersionIds,
});

export async function scoreCompaniesAgainstIcps(
  db: FanOutScoringDb,
  input: ScoreCompaniesAgainstIcpsInput
): Promise<ScoreCompaniesAgainstIcpsResult> {
  const companyIds = unique(input.companyIds);
  const icpVersionIds = unique(input.icpVersionIds);
  if (companyIds.length === 0 || icpVersionIds.length === 0) return EMPTY();

  // Resolve each chosen ICP version -> its project (PUBLISHED + rules-ready only).
  const icpRows = await db.$queryRawUnsafe<Array<{ icpVersionId: string; projectId: string }>>(
    `SELECT icp."id" AS "icpVersionId", offer."projectId" AS "projectId"
       FROM "V2ICPVersion" icp
       INNER JOIN "V2ICPProfile" profile
         ON profile."id" = icp."icpProfileId" AND profile."organizationId" = icp."organizationId" AND profile."status" = 'ACTIVE'
       INNER JOIN "V2Offer" offer
         ON offer."id" = profile."offerId" AND offer."organizationId" = icp."organizationId" AND offer."status" = 'ACTIVE'
       INNER JOIN "V2Project" project
         ON project."id" = offer."projectId" AND project."organizationId" = icp."organizationId" AND project."status" = 'ACTIVE'
      WHERE icp."id" = ANY($1::text[]) AND icp."organizationId" = $2
        AND icp."status" = 'PUBLISHED' AND icp."deletedAt" IS NULL AND icp."rulesJson" IS NOT NULL`,
    icpVersionIds,
    input.organizationId
  );
  const projectByIcp = new Map(icpRows.map((r) => [r.icpVersionId, r.projectId]));
  const invalidIcpVersionIds = icpVersionIds.filter((id) => !projectByIcp.has(id));
  if (projectByIcp.size === 0) return EMPTY(invalidIcpVersionIds);

  // Validate the companies are active + in this tenant.
  const companyRows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2Company"
      WHERE "id" = ANY($1::text[]) AND "organizationId" = $2
        AND "deletedAt" IS NULL AND "status" = 'ACTIVE'`,
    companyIds,
    input.organizationId
  );
  const validCompanyIds = companyRows.map((r) => r.id);
  if (validCompanyIds.length === 0) return EMPTY(invalidIcpVersionIds);

  const leadAssignmentIds: string[] = [];
  let created = 0;
  let existing = 0;
  for (const companyId of validCompanyIds) {
    for (const [icpVersionId, projectId] of projectByIcp) {
      const ensured = await ensureCompanyLeadAssignment(db, {
        organizationId: input.organizationId,
        projectId,
        icpVersionId,
        companyId,
      });
      leadAssignmentIds.push(ensured.id);
      if (ensured.action === "created") created += 1;
      else existing += 1;
    }
  }

  const run = await createScoringRun(db, {
    organizationId: input.organizationId,
    selection: { kind: "lead_assignment_ids", leadAssignmentIds },
    createdByUserId: input.createdByUserId ?? null,
  });
  const execution = await enqueueScoringExecution(db, {
    organizationId: input.organizationId,
    run,
    createdByUserId: input.createdByUserId ?? null,
  });

  return {
    ok: true,
    runId: run.runId,
    mode: execution.mode,
    companies: validCompanyIds.length,
    icpVersions: projectByIcp.size,
    ensured: leadAssignmentIds.length,
    created,
    existing,
    leadAssignmentIds,
    invalidIcpVersionIds,
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}
