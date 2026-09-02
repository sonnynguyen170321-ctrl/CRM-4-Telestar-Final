import "server-only";

import type { $Enums, Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/server/prisma";
import { recordAuditEvent } from "@/lib/v2/audit";

// Contacts & Leads "desk" writes + reads: notes, tasks (next actions), and manual
// activity logging on a LeadAssignment. All tenant-scoped from the caller's session
// orgId (Invariant 5); the unit is the LeadAssignment (Inv 2); none of these mutate
// an assessment (Inv 4). Every write verifies the lead belongs to the org first and
// records an audit event (which the lead timeline unions). Real DB only.

export type LeadDeskTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type LeadDeskDb = LeadDeskTx & {
  $transaction<T>(fn: (tx: LeadDeskTx) => Promise<T>): Promise<T>;
};

type LeadRef = { companyId: string; contactId: string | null };

// Shared guard: the lead must be an active, non-deleted row in THIS org. Returns
// its company/contact for child inserts (V2ActivityRecord.companyId is required).
async function loadLeadForWrite(
  tx: LeadDeskTx,
  organizationId: string,
  leadAssignmentId: string
): Promise<LeadRef | null> {
  const rows = await tx.$queryRawUnsafe<Array<LeadRef>>(
    `SELECT "companyId", "contactId" FROM "V2LeadAssignment"
      WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL AND "status" = 'ACTIVE'
      LIMIT 1`,
    leadAssignmentId,
    organizationId
  );
  return rows[0] ?? null;
}

async function isActiveOrgMember(
  tx: LeadDeskTx,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT u."id" FROM "V2User" u
       INNER JOIN "V2OrganizationMembership" m
         ON m."userId" = u."id" AND m."organizationId" = $1 AND m."status" = 'ACTIVE'
      WHERE u."id" = $2 AND u."status" = 'ACTIVE' LIMIT 1`,
    organizationId,
    userId
  );
  return Boolean(rows[0]);
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type LeadDeskWriteResult<T> =
  | { kind: "created"; value: T }
  | { kind: "not_found" }
  | { kind: "invalid"; code: string; message: string };

// ── Notes ──────────────────────────────────────────────────────────────────────

export async function createLeadNote(
  db: LeadDeskDb,
  input: { organizationId: string; actorUserId: string; leadAssignmentId: string; body: string }
): Promise<LeadDeskWriteResult<{ id: string }>> {
  const body = input.body.trim();
  if (!body) return { kind: "invalid", code: "EMPTY_NOTE", message: "Note body is required." };

  return db.$transaction(async (tx) => {
    if (!(await loadLeadForWrite(tx, input.organizationId, input.leadAssignmentId))) {
      return { kind: "not_found" };
    }
    const id = genId("lnote");
    await tx.$queryRawUnsafe(
      `INSERT INTO "V2LeadNote" ("id", "organizationId", "leadAssignmentId", "authorUserId", "body", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      input.organizationId,
      input.leadAssignmentId,
      input.actorUserId,
      body.slice(0, 5000)
    );
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "lead.note_added",
      entityType: "V2LeadAssignment",
      entityId: input.leadAssignmentId,
      metadataJson: { noteId: id },
    });
    return { kind: "created", value: { id } };
  });
}

export type LeadNote = { id: string; body: string; authorName: string | null; createdAt: string };

export async function queryLeadNotes(
  organizationId: string,
  leadAssignmentId: string
): Promise<LeadNote[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ id: string; body: string; authorName: string | null; createdAt: Date }>>(
    `SELECT n."id", n."body", u."name" AS "authorName", n."createdAt"
       FROM "V2LeadNote" n
       LEFT JOIN "V2User" u ON u."id" = n."authorUserId"
      WHERE n."organizationId" = $1 AND n."leadAssignmentId" = $2 AND n."deletedAt" IS NULL
      ORDER BY n."createdAt" DESC
      LIMIT 100`,
    organizationId,
    leadAssignmentId
  );
  return rows.map((r) => ({ id: r.id, body: r.body, authorName: r.authorName, createdAt: new Date(r.createdAt).toISOString() }));
}

// ── Tasks / next actions ─────────────────────────────────────────────────────────

export async function createLeadTask(
  db: LeadDeskDb,
  input: {
    organizationId: string;
    actorUserId: string;
    leadAssignmentId: string;
    title: string;
    detail?: string | null;
    dueAt?: string | null;
    ownerUserId?: string | null;
  }
): Promise<LeadDeskWriteResult<{ id: string }>> {
  const title = input.title.trim();
  if (!title) return { kind: "invalid", code: "EMPTY_TITLE", message: "Task title is required." };
  const dueAt = input.dueAt && !Number.isNaN(Date.parse(input.dueAt)) ? new Date(input.dueAt).toISOString() : null;

  return db.$transaction(async (tx) => {
    const lead = await loadLeadForWrite(tx, input.organizationId, input.leadAssignmentId);
    if (!lead) return { kind: "not_found" };
    // Owner is assignable to any active org member (decision); default = creator.
    const ownerUserId = input.ownerUserId || input.actorUserId;
    if (ownerUserId !== input.actorUserId && !(await isActiveOrgMember(tx, input.organizationId, ownerUserId))) {
      return { kind: "invalid", code: "INVALID_OWNER", message: "Task owner is not an active org member." };
    }
    const id = genId("ltask");
    await tx.$queryRawUnsafe(
      `INSERT INTO "V2Task"
         ("id", "organizationId", "leadAssignmentId", "contactId", "title", "detail", "dueAt", "status", "ownerUserId", "createdByUserId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      input.organizationId,
      input.leadAssignmentId,
      lead.contactId,
      title.slice(0, 300),
      input.detail?.trim().slice(0, 2000) || null,
      dueAt,
      ownerUserId,
      input.actorUserId
    );
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "lead.task_created",
      entityType: "V2LeadAssignment",
      entityId: input.leadAssignmentId,
      metadataJson: { taskId: id, ownerUserId, dueAt },
    });
    return { kind: "created", value: { id } };
  });
}

export async function completeLeadTask(
  db: LeadDeskDb,
  input: { organizationId: string; actorUserId: string; taskId: string }
): Promise<{ kind: "completed" | "not_found" }> {
  return db.$transaction(async (tx) => {
    const updated = await tx.$queryRawUnsafe<Array<{ id: string; leadAssignmentId: string }>>(
      `UPDATE "V2Task"
          SET "status" = 'DONE', "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $1 AND "organizationId" = $2 AND "status" = 'OPEN' AND "deletedAt" IS NULL
        RETURNING "id", "leadAssignmentId"`,
      input.taskId,
      input.organizationId
    );
    if (!updated[0]) return { kind: "not_found" };
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "lead.task_completed",
      entityType: "V2LeadAssignment",
      entityId: updated[0].leadAssignmentId,
      metadataJson: { taskId: input.taskId },
    });
    return { kind: "completed" };
  });
}

export type LeadTask = {
  id: string;
  title: string;
  detail: string | null;
  dueAt: string | null;
  status: string;
  ownerName: string | null;
  createdAt: string;
};

export async function queryLeadTasks(
  organizationId: string,
  leadAssignmentId: string
): Promise<LeadTask[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ id: string; title: string; detail: string | null; dueAt: Date | null; status: string; ownerName: string | null; createdAt: Date }>
  >(
    `SELECT t."id", t."title", t."detail", t."dueAt", t."status"::text AS "status",
            u."name" AS "ownerName", t."createdAt"
       FROM "V2Task" t
       LEFT JOIN "V2User" u ON u."id" = t."ownerUserId"
      WHERE t."organizationId" = $1 AND t."leadAssignmentId" = $2 AND t."deletedAt" IS NULL
      ORDER BY (t."status" = 'OPEN') DESC, t."dueAt" ASC NULLS LAST, t."createdAt" DESC
      LIMIT 100`,
    organizationId,
    leadAssignmentId
  );
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
    status: r.status,
    ownerName: r.ownerName,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

// ── Manual activity log ──────────────────────────────────────────────────────────

const MANUAL_ACTIVITY_CHANNELS = new Set(["email", "call", "linkedin", "meeting", "note", "other"]);

export async function logLeadActivity(
  db: LeadDeskDb,
  input: {
    organizationId: string;
    actorUserId: string;
    leadAssignmentId: string;
    channel: string;
    outcome?: string | null;
    note?: string | null;
  }
): Promise<LeadDeskWriteResult<{ id: string }>> {
  const channel = input.channel.trim().toLowerCase();
  if (!MANUAL_ACTIVITY_CHANNELS.has(channel)) {
    return { kind: "invalid", code: "INVALID_CHANNEL", message: "Unsupported activity channel." };
  }

  return db.$transaction(async (tx) => {
    const lead = await loadLeadForWrite(tx, input.organizationId, input.leadAssignmentId);
    if (!lead) return { kind: "not_found" };
    const id = genId("lact");
    // Manual log reuses V2ActivityRecord (no new model). Random sourceActivityHash
    // keeps the (org, hash) idempotency unique per manual entry; timestampQuality
    // marks it human-entered. eventKind = activity.<channel> so queryLeadTimeline
    // surfaces it.
    await tx.$queryRawUnsafe(
      `INSERT INTO "V2ActivityRecord"
         ("id", "organizationId", "leadAssignmentId", "companyId", "contactId", "actorUserId",
          "channel", "activityType", "outcome", "eventKind", "occurredAt", "timestampQuality",
          "sourceActivityHash", "note", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, 'manual_log', $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      input.organizationId,
      input.leadAssignmentId,
      lead.companyId,
      lead.contactId,
      input.actorUserId,
      channel,
      channel,
      input.outcome?.trim().slice(0, 120) || "logged",
      `activity.${channel}`,
      `manual:${id}`,
      input.note?.trim().slice(0, 2000) || null
    );
    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "lead.activity_logged",
      entityType: "V2LeadAssignment",
      entityId: input.leadAssignmentId,
      metadataJson: { activityId: id, channel },
    });
    return { kind: "created", value: { id } };
  });
}

// ── Qualification Override ─────────────────────────────────────────────────────────

export async function overrideLeadQualification(
  db: LeadDeskDb,
  input: {
    organizationId: string;
    actorUserId: string;
    leadAssignmentId: string;
    qualification: string; // 'QUALIFIED' | 'UNQUALIFIED'
  }
): Promise<LeadDeskWriteResult<{ id: string }>> {
  return db.$transaction(async (tx) => {
    const lead = await loadLeadForWrite(tx, input.organizationId, input.leadAssignmentId);
    if (!lead) return { kind: "not_found" };

    // The runtime tx is the real Prisma transaction client (callers pass the prisma
    // singleton); the narrow LeadDeskTx view only exposes $queryRawUnsafe. Type it
    // properly so the model-method copy below is lint/type-clean (no `any`).
    const txPrisma = tx as unknown as Prisma.TransactionClient;

    // Get the latest assessment using Prisma to avoid raw SQL type/JSON issues
    const prev = await txPrisma.v2HardRuleAssessment.findFirst({
      where: { leadAssignmentId: input.leadAssignmentId, organizationId: input.organizationId },
      orderBy: { createdAt: "desc" },
    });
    
    if (!prev) return { kind: "invalid", code: "NO_ASSESSMENT", message: "No previous assessment to override." };

    const newId = genId("hra");
    
    // Insert new assessment copying old data but overriding qualification, reason, and scoringSource
    await txPrisma.v2HardRuleAssessment.create({
      data: {
        id: newId,
        organizationId: prev.organizationId,
        leadAssignmentId: prev.leadAssignmentId,
        icpVersionId: prev.icpVersionId,
        fitScore: prev.fitScore,
        confidence: prev.confidence,
        qualification: input.qualification as $Enums.V2Qualification,
        accountPreRank: prev.accountPreRank,
        companyType: prev.companyType,
        reason: "SDR manually overridden from Lead Workspace",
        oneSentenceCompanySummary: prev.oneSentenceCompanySummary,
        evidenceSnapshotJson: prev.evidenceSnapshotJson || undefined,
        hardGateResultsJson: prev.hardGateResultsJson || undefined,
        confidenceBreakdownJson: prev.confidenceBreakdownJson || undefined,
        dataQualityJson: prev.dataQualityJson || undefined,
        // A manual override is NOT a scoring input, so it must not collide with the
        // idempotency unique key (org, lead, icp, inputFingerprint, scoringVersion) — that
        // key dedupes identical *rescore* runs, not human decisions. Give the override a
        // synthetic per-row fingerprint so every override inserts a fresh immutable
        // assessment (Inv 4) and repeated overrides on the same lead never clash.
        inputFingerprint: `override:${newId}`,
        icpRulesHash: prev.icpRulesHash,
        scoringSource: "manual_sdr_override",
        scoringVersion: prev.scoringVersion,
        previousAssessmentId: prev.id,
      }
    });

    const leadAssign = await txPrisma.v2LeadAssignment.findUnique({
      where: { id: input.leadAssignmentId },
      select: { workflowStatus: true }
    });

    // Update LeadAssignment
    await txPrisma.v2LeadAssignment.update({
      where: { id: input.leadAssignmentId },
      data: {
        latestHardRuleAssessmentId: newId,
        workflowStatus: leadAssign?.workflowStatus === "NEW" && input.qualification === "QUALIFIED" 
          ? "WORKING" 
          : undefined,
      }
    });

    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "lead.qualification_overridden",
      entityType: "V2LeadAssignment",
      entityId: input.leadAssignmentId,
      metadataJson: { previousAssessmentId: prev.id, newAssessmentId: newId, qualification: input.qualification },
    });

    return { kind: "created", value: { id: newId } };
  });
}

