import "server-only";

import { createScoringRun } from "./createScoringRun";
import { enqueueScoringExecution } from "./enqueueScoringExecution";
import {
  dedupeProjectIcpPairs,
  distinctProjectCount,
  type ProjectIcpPair,
} from "./fanOutPlanning";
import type { V2ScoreRuntimeDatabase } from "./types";

// S1 fan-out: score ONE company against ALL published ICPs of the project(s) it is
// already in. For each (project × published ICPVersion) it ensures a company-level
// LeadAssignment (idempotent — Invariant 6, no duplicate leads) then enqueues a
// single idempotent ICP_SCORE job for the ensured set. Tenant-scoped from the
// caller's session orgId (Invariant 5). The unit is the LeadAssignment (Invariant 2).

export type FanOutScoringDb = V2ScoreRuntimeDatabase & {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type FanOutCompanyScoringInput = {
  organizationId: string;
  companyId: string;
  createdByUserId?: string | null;
  // Limit fan-out to a single project; default = every project the company is in.
  projectId?: string;
  // Limit fan-out to the ICPs of ONE account (V2Project.clientAccountId). Default = every
  // account the company touches. "Score against all ICPs" should pass the account in context so
  // it scores that account's ICPs, not org-wide across every account the company appears in.
  clientAccountId?: string;
};

export type FanOutCompanyScoringResult = {
  projectsProcessed: number;
  publishedIcpVersions: number;
  assignmentsCreated: number;
  assignmentsExisting: number;
  leadAssignmentIds: string[];
  enqueued: boolean;
  enqueueKind: string | null;
  runId: string | null;
  mode: "bull" | "db" | "empty" | null;
};

export async function fanOutCompanyScoring(
  db: FanOutScoringDb,
  input: FanOutCompanyScoringInput
): Promise<FanOutCompanyScoringResult> {
  const args: unknown[] = [input.organizationId, input.companyId];
  let projectClause = "";
  if (input.projectId) {
    args.push(input.projectId);
    projectClause = `AND project."id" = $${args.length}`;
  }
  let accountClause = "";
  if (input.clientAccountId) {
    args.push(input.clientAccountId);
    accountClause = `AND project."clientAccountId" = $${args.length}`;
  }

  // Every published ICP version reachable from a project the company is already in
  // (Project -> active Offer -> active ICPProfile -> PUBLISHED ICPVersion with rules).
  const rawPairs = await db.$queryRawUnsafe<ProjectIcpPair[]>(
    `SELECT DISTINCT project."id" AS "projectId", icp."id" AS "icpVersionId"
       FROM "V2LeadAssignment" lead
       INNER JOIN "V2Project" project
         ON project."id" = lead."projectId" AND project."organizationId" = lead."organizationId" AND project."status" = 'ACTIVE'
       INNER JOIN "V2Offer" offer
         ON offer."projectId" = project."id" AND offer."organizationId" = project."organizationId" AND offer."status" = 'ACTIVE'
       INNER JOIN "V2ICPProfile" profile
         ON profile."offerId" = offer."id" AND profile."organizationId" = project."organizationId" AND profile."status" = 'ACTIVE'
       INNER JOIN "V2ICPVersion" icp
         ON icp."icpProfileId" = profile."id" AND icp."organizationId" = project."organizationId"
         AND icp."status" = 'PUBLISHED' AND icp."deletedAt" IS NULL AND icp."rulesJson" IS NOT NULL
      WHERE lead."organizationId" = $1 AND lead."companyId" = $2
        AND lead."deletedAt" IS NULL AND lead."status" = 'ACTIVE'
        ${projectClause}
        ${accountClause}`,
    ...args
  );

  const pairs = dedupeProjectIcpPairs(rawPairs);
  if (pairs.length === 0) {
    return {
      projectsProcessed: 0,
      publishedIcpVersions: 0,
      assignmentsCreated: 0,
      assignmentsExisting: 0,
      leadAssignmentIds: [],
      enqueued: false,
      enqueueKind: null,
      runId: null,
      mode: null,
    };
  }

  const leadAssignmentIds: string[] = [];
  let created = 0;
  let existing = 0;
  for (const pair of pairs) {
    const ensured = await ensureCompanyLeadAssignment(db, {
      organizationId: input.organizationId,
      projectId: pair.projectId,
      icpVersionId: pair.icpVersionId,
      companyId: input.companyId,
    });
    leadAssignmentIds.push(ensured.id);
    if (ensured.action === "created") created += 1;
    else existing += 1;
  }

  // Route through the scoring runtime (BullMQ scoring.plan fan-out when enabled, else the
  // ICP_SCORE V2Job) so the run is tracked + pollable instead of a bare enqueue.
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
    projectsProcessed: distinctProjectCount(pairs),
    publishedIcpVersions: pairs.length,
    assignmentsCreated: created,
    assignmentsExisting: existing,
    leadAssignmentIds,
    enqueued: execution.mode !== "empty",
    enqueueKind: execution.mode,
    runId: run.runId,
    mode: execution.mode,
  };
}

// Idempotent ensure of a company-level LeadAssignment, mirroring the ingestion
// upsert (select active -> insert -> on unique conflict re-select). Never creates a
// duplicate for the same (company, project, ICPVersion) active row.
export async function ensureCompanyLeadAssignment(
  db: FanOutScoringDb,
  input: { organizationId: string; projectId: string; icpVersionId: string; companyId: string }
): Promise<{ id: string; action: "created" | "existing" }> {
  const existing = await selectActiveCompanyAssignment(db, input);
  if (existing) return { id: existing, action: "existing" };

  try {
    const created = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "V2LeadAssignment"
         ("id", "organizationId", "projectId", "icpVersionId", "companyId", "contactId",
          "assignmentLevel", "workflowStatus", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, NULL, 'COMPANY'::"V2LeadAssignmentLevel", 'NEW', 'ACTIVE',
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING "id"`,
      `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      input.organizationId,
      input.projectId,
      input.icpVersionId,
      input.companyId
    );
    return { id: created[0].id, action: "created" };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const afterConflict = await selectActiveCompanyAssignment(db, input);
    if (!afterConflict) throw error;
    return { id: afterConflict, action: "existing" };
  }
}

async function selectActiveCompanyAssignment(
  db: FanOutScoringDb,
  input: { organizationId: string; projectId: string; icpVersionId: string; companyId: string }
): Promise<string | null> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2LeadAssignment"
      WHERE "organizationId" = $1 AND "projectId" = $2 AND "icpVersionId" = $3 AND "companyId" = $4
        AND "contactId" IS NULL AND "assignmentLevel" = 'COMPANY'
        AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
      LIMIT 1`,
    input.organizationId,
    input.projectId,
    input.icpVersionId,
    input.companyId
  );
  return rows[0]?.id ?? null;
}

function isUniqueConflict(error: unknown): boolean {
  const text = String(
    (error as { code?: unknown; message?: unknown; meta?: unknown })?.code ??
      (error as { message?: unknown })?.message ??
      ""
  );
  return (
    text.includes("23505") ||
    text.includes("P2002") ||
    text.includes("V2LeadAssignment_active_company_assignment_key")
  );
}
