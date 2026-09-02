import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";
import { createScoringRun } from "./createScoringRun";
import { enqueueScoringExecution } from "./enqueueScoringExecution";
import type { FanOutScoringDb } from "./fanOutCompanyScoring";

// P2c: take a set of existing leads (selected on /v2/leads, scored under ICP A) and
// score the SAME companies/contacts against a DIFFERENT target ICP (B), so they can
// be worked in another campaign. For each source lead it ensures a LeadAssignment
// under ICP B's project (idempotent - Inv 6, no duplicate leads), preserving the
// contact (contact-level) or company-level shape, then enqueues one idempotent
// ICP_SCORE job for the ensured set. Tenant-scoped (Inv 5); unit = LeadAssignment
// (Inv 2). Target ICP must be PUBLISHED with rules - never scores against a draft.

export type ScoreLeadsAgainstIcpInput = {
  organizationId: string;
  actorUserId: string;
  targetIcpVersionId: string;
  sourceLeadAssignmentIds: string[];
  /** Optional owner default for target leads created by self-serve SDR flows. */
  ownerUserId?: string | null;
};

export type ScoreLeadsAgainstIcpResult =
  | {
      ok: true;
      targetProjectId: string;
      requested: number;
      created: number;
      existing: number;
      ownerAssigned: number;
      leadAssignmentIds: string[];
      enqueued: boolean;
      runId: string;
      mode: "bull" | "db" | "empty";
      executionReason: string;
      workerHealthy: boolean;
      jobCreated: boolean;
      jobId: string | null;
      bullJobId: string | null;
    }
  | { ok: false; code: "INVALID_TARGET_ICP" | "NO_SOURCE_LEADS"; message: string };

type SourceLead = { id: string; companyId: string; contactId: string | null };

export async function scoreLeadsAgainstIcp(
  db: FanOutScoringDb,
  input: ScoreLeadsAgainstIcpInput
): Promise<ScoreLeadsAgainstIcpResult> {
  const sourceIds = Array.from(new Set(input.sourceLeadAssignmentIds.map((id) => id.trim()).filter(Boolean)));
  if (sourceIds.length === 0) {
    return { ok: false, code: "NO_SOURCE_LEADS", message: "No source leads selected." };
  }

  // Resolve target ICP B -> its project (Project -> active Offer -> active ICPProfile
  // -> PUBLISHED ICPVersion with rules). Tenant-scoped. Rejects drafts / no-rules.
  const icpRows = await db.$queryRawUnsafe<Array<{ projectId: string }>>(
    `SELECT offer."projectId" AS "projectId"
       FROM "V2ICPVersion" icp
       INNER JOIN "V2ICPProfile" profile
         ON profile."id" = icp."icpProfileId" AND profile."organizationId" = icp."organizationId" AND profile."status" = 'ACTIVE'
       INNER JOIN "V2Offer" offer
         ON offer."id" = profile."offerId" AND offer."organizationId" = icp."organizationId" AND offer."status" = 'ACTIVE'
       INNER JOIN "V2Project" project
         ON project."id" = offer."projectId" AND project."organizationId" = icp."organizationId" AND project."status" = 'ACTIVE'
      WHERE icp."id" = $1 AND icp."organizationId" = $2
        AND icp."status" = 'PUBLISHED' AND icp."deletedAt" IS NULL AND icp."rulesJson" IS NOT NULL
      LIMIT 1`,
    input.targetIcpVersionId,
    input.organizationId
  );
  const targetProjectId = icpRows[0]?.projectId;
  if (!targetProjectId) {
    return { ok: false, code: "INVALID_TARGET_ICP", message: "Target ICP is not a published, rules-ready version." };
  }

  const sources = await db.$queryRawUnsafe<SourceLead[]>(
    `SELECT "id", "companyId", "contactId"
       FROM "V2LeadAssignment"
      WHERE "id" = ANY($1::text[]) AND "organizationId" = $2
        AND "deletedAt" IS NULL AND "status" = 'ACTIVE'`,
    sourceIds,
    input.organizationId
  );
  if (sources.length === 0) {
    return { ok: false, code: "NO_SOURCE_LEADS", message: "No active source leads found in this organization." };
  }

  // Dedupe target (company, contact) pairs so the same person/company is ensured once.
  const seen = new Set<string>();
  const leadAssignmentIds: string[] = [];
  let created = 0;
  let existing = 0;
  let ownerAssigned = 0;
  const ownerUserId = input.ownerUserId?.trim() || null;
  for (const source of sources) {
    const key = `${source.companyId}::${source.contactId ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ensured = await ensureTargetLeadAssignment(db, {
      organizationId: input.organizationId,
      projectId: targetProjectId,
      icpVersionId: input.targetIcpVersionId,
      companyId: source.companyId,
      contactId: source.contactId,
      ownerUserId,
      assignedByUserId: ownerUserId ? input.actorUserId : null,
    });
    leadAssignmentIds.push(ensured.id);
    if (ensured.action === "created") created += 1;
    else existing += 1;
    if (ensured.ownerAssigned) ownerAssigned += 1;
  }

  // Route through the scoring runtime: createScoringRun freezes the selection and mirrors
  // V2RuntimeRun/Stage/Chunk; enqueueScoringExecution dispatches to BullMQ (scoring.plan
  // fan-out) when enabled, else the ICP_SCORE V2Job. The UI polls the run for progress,
  // so "Run scoring" reflects an actual runtime instead of a fire-and-hope enqueue.
  const run = await createScoringRun(db, {
    organizationId: input.organizationId,
    selection: { kind: "lead_assignment_ids", leadAssignmentIds },
    projectId: targetProjectId,
    icpVersionId: input.targetIcpVersionId,
    createdByUserId: input.actorUserId,
  });
  const execution = await enqueueScoringExecution(db, {
    organizationId: input.organizationId,
    run,
    createdByUserId: input.actorUserId,
  });

  await recordAuditEvent(db, {
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    eventType: "lead.scored_against_icp",
    entityType: "V2ICPVersion",
    entityId: input.targetIcpVersionId,
    metadataJson: {
      targetProjectId,
      requested: sources.length,
      created,
      existing,
      ownerAssigned,
      leadAssignmentIds,
      runId: run.runId,
      mode: execution.mode,
      executionReason: execution.reason,
      workerHealthy: execution.workerHealthy,
      jobCreated: execution.jobCreated,
      jobId: execution.jobId,
      bullJobId: execution.bullJobId,
    },
  });

  return {
    ok: true,
    targetProjectId,
    requested: sources.length,
    created,
    existing,
    ownerAssigned,
    leadAssignmentIds,
    enqueued: execution.mode !== "empty",
    runId: run.runId,
    mode: execution.mode,
    executionReason: execution.reason,
    workerHealthy: execution.workerHealthy,
    jobCreated: execution.jobCreated,
    jobId: execution.jobId,
    bullJobId: execution.bullJobId,
  };
}

// Idempotent ensure of a LeadAssignment for (company, target project, target ICP),
// preserving the source's contact (contact-level) or company-level shape. Mirrors
// the ingestion upsert: select active -> insert -> on unique conflict re-select.
async function ensureTargetLeadAssignment(
  db: FanOutScoringDb,
  input: {
    organizationId: string;
    projectId: string;
    icpVersionId: string;
    companyId: string;
    contactId: string | null;
    ownerUserId: string | null;
    assignedByUserId: string | null;
  }
): Promise<{ id: string; action: "created" | "existing"; ownerAssigned: boolean }> {
  const level = input.contactId ? "CONTACT" : "COMPANY";
  const found = await selectActive(db, input, level);
  if (found) {
    const ownerAssigned = await assignOwnerIfUnassigned(db, {
      organizationId: input.organizationId,
      leadAssignmentId: found,
      ownerUserId: input.ownerUserId,
      assignedByUserId: input.assignedByUserId,
    });
    return { id: found, action: "existing", ownerAssigned };
  }

  try {
    const created = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `INSERT INTO "V2LeadAssignment"
         ("id", "organizationId", "projectId", "icpVersionId", "companyId", "contactId",
          "assignmentLevel", "workflowStatus", "ownerUserId", "assignedAt", "assignedByUserId",
          "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7::"V2LeadAssignmentLevel", 'NEW',
               $8, CASE WHEN $8::text IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END, $9,
               'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING "id"`,
      `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      input.organizationId,
      input.projectId,
      input.icpVersionId,
      input.companyId,
      level === "CONTACT" ? input.contactId : null,
      level,
      input.ownerUserId,
      input.ownerUserId ? input.assignedByUserId : null
    );
    if (input.ownerUserId) {
      await recordAuditEvent(db, {
        organizationId: input.organizationId,
        actorUserId: input.assignedByUserId ?? input.ownerUserId,
        eventType: "lead.assigned",
        entityType: "V2LeadAssignment",
        entityId: created[0].id,
        metadataJson: { previousOwner: null, nextOwner: input.ownerUserId, source: "contacts.add_to_leads" },
      });
    }

    return { id: created[0].id, action: "created", ownerAssigned: Boolean(input.ownerUserId) };
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const afterConflict = await selectActive(db, input, level);
    if (!afterConflict) throw error;
    const ownerAssigned = await assignOwnerIfUnassigned(db, {
      organizationId: input.organizationId,
      leadAssignmentId: afterConflict,
      ownerUserId: input.ownerUserId,
      assignedByUserId: input.assignedByUserId,
    });
    return { id: afterConflict, action: "existing", ownerAssigned };
  }
}

async function assignOwnerIfUnassigned(
  db: FanOutScoringDb,
  input: {
    organizationId: string;
    leadAssignmentId: string;
    ownerUserId: string | null;
    assignedByUserId: string | null;
  }
): Promise<boolean> {
  if (!input.ownerUserId) return false;

  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "V2LeadAssignment"
        SET "ownerUserId" = $1,
            "assignedAt" = CURRENT_TIMESTAMP,
            "assignedByUserId" = $2,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $3
        AND "organizationId" = $4
        AND "deletedAt" IS NULL
        AND "status" = 'ACTIVE'
        AND "ownerUserId" IS NULL
      RETURNING "id"`,
    input.ownerUserId,
    input.assignedByUserId,
    input.leadAssignmentId,
    input.organizationId
  );

  if (!rows[0]) return false;

  await recordAuditEvent(db, {
    organizationId: input.organizationId,
    actorUserId: input.assignedByUserId ?? input.ownerUserId,
    eventType: "lead.assigned",
    entityType: "V2LeadAssignment",
    entityId: input.leadAssignmentId,
    metadataJson: { previousOwner: null, nextOwner: input.ownerUserId, source: "contacts.add_to_leads" },
  });

  return true;
}

async function selectActive(
  db: FanOutScoringDb,
  input: { organizationId: string; projectId: string; icpVersionId: string; companyId: string; contactId: string | null },
  level: "CONTACT" | "COMPANY"
): Promise<string | null> {
  const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "V2LeadAssignment"
      WHERE "organizationId" = $1 AND "projectId" = $2 AND "icpVersionId" = $3 AND "companyId" = $4
        AND ${level === "CONTACT" ? `"contactId" = $5` : `"contactId" IS NULL`}
        AND "assignmentLevel" = '${level}'
        AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
      LIMIT 1`,
    ...(level === "CONTACT"
      ? [input.organizationId, input.projectId, input.icpVersionId, input.companyId, input.contactId]
      : [input.organizationId, input.projectId, input.icpVersionId, input.companyId])
  );
  return rows[0]?.id ?? null;
}

function isUniqueConflict(error: unknown): boolean {
  const text = String(
    (error as { code?: unknown; message?: unknown })?.code ??
      (error as { message?: unknown })?.message ??
      ""
  );
  return (
    text.includes("23505") ||
    text.includes("P2002") ||
    text.includes("V2LeadAssignment_active_company_assignment_key") ||
    text.includes("V2LeadAssignment_active_contact_assignment_key")
  );
}
