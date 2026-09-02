// import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";

import {
  buildManagerReviewSourceFingerprint,
  type ManagerReviewSourceFingerprintInput,
} from "./sourceFingerprint";
import {
  ACTIVE_STATUS_SQL,
  createInvalidResult,
  getDefaultManagerReviewDb,
  isManagerReviewConfidence,
  isManagerReviewPriority,
  isManagerReviewReasonCode,
  isManagerReviewSourceType,
  mapReviewItem,
  validateActorMembership,
  type ManagerReviewConfidence,
  type ManagerReviewDb,
  type ManagerReviewInvalidResult,
  type ManagerReviewItem,
  type ManagerReviewMutationInputBase,
  type ManagerReviewPriority,
  type ManagerReviewReasonCode,
  type ManagerReviewSourceType,
  type ManagerReviewSqlRow,
  type ManagerReviewTransactionDb,
} from "./types";

export type CreateReviewItemInput = ManagerReviewMutationInputBase & {
  sourceType: ManagerReviewSourceType;
  reasonCode: ManagerReviewReasonCode;
  leadAssignmentId?: string | null;
  hardRuleAssessmentId?: string | null;
  projectId?: string | null;
  companyId?: string | null;
  contactId?: string | null;
  icpVersionId?: string | null;
  ingestionJobId?: string | null;
  ingestionRowId?: string | null;
  sourceRowHash?: string | null;
  eventIndexWithinRow?: number | null;
  sourceId?: string | null;
  sourceRefJson?: unknown;
  reasonDetail?: string | null;
  suggestedAction?: string | null;
  priority?: ManagerReviewPriority;
  confidence?: ManagerReviewConfidence;
  candidateSummariesJson?: unknown;
  metadataJson?: unknown;
  dueAt?: Date | string | null;
};

export type CreateReviewItemResult =
  | { kind: "created"; item: ManagerReviewItem }
  | { kind: "existing_active"; item: ManagerReviewItem }
  | ManagerReviewInvalidResult
  | {
      kind: "not_found";
      code: "LINKED_RECORD_NOT_FOUND";
      message: string;
    };

/**
 * Precondition: caller has already passed manager_review.decide or equivalent
 * route/service permission check. MR2 validates tenant/membership integrity only.
 */
export async function createReviewItem(
  input: CreateReviewItemInput,
  db?: ManagerReviewDb
): Promise<CreateReviewItemResult> {
  const normalized = normalizeCreateInput(input);

  if (normalized.kind === "invalid") {
    return normalized;
  }

  const activeDb = db ?? (await getDefaultManagerReviewDb());

  return activeDb.$transaction(async (tx) => {
    const membershipError = await validateActorMembership(tx, input);

    if (membershipError) {
      return membershipError;
    }

    const linkedError = await validateLinkedRecords(tx, normalized.input);

    if (linkedError) {
      return linkedError;
    }

    const existing = await findActiveByFingerprint(
      tx,
      input.organizationId,
      normalized.input.sourceFingerprint
    );

    if (existing) {
      return { kind: "existing_active", item: existing };
    }

    try {
      const insertedRows = await tx.$queryRawUnsafe<ManagerReviewSqlRow[]>(
        `
          INSERT INTO "V2ManagerReviewItem" (
            "id",
            "organizationId",
            "leadAssignmentId",
            "hardRuleAssessmentId",
            "projectId",
            "companyId",
            "contactId",
            "icpVersionId",
            "sourceType",
            "sourceId",
            "sourceRefJson",
            "sourceFingerprint",
            "reasonCode",
            "reasonDetail",
            "suggestedAction",
            "priority",
            "confidence",
            "candidateSummariesJson",
            "metadataJson",
            "status",
            "createdByUserId",
            "dueAt",
            "createdAt",
            "updatedAt"
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9::"V2ManagerReviewSourceType", $10, $11::jsonb, $12,
            $13::"V2ManagerReviewReasonCode", $14, $15,
            $16::"V2ManagerReviewPriority", $17::"V2ManagerReviewConfidence",
            $18::jsonb, $19::jsonb, 'OPEN', $20, $21::timestamp,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          RETURNING ${reviewItemReturningColumns()}
        `,
        createManagerReviewItemId(),
        normalized.input.organizationId,
        normalized.input.leadAssignmentId,
        normalized.input.hardRuleAssessmentId,
        normalized.input.projectId,
        normalized.input.companyId,
        normalized.input.contactId,
        normalized.input.icpVersionId,
        normalized.input.sourceType,
        normalized.input.sourceId,
        jsonOrNull(normalized.input.sourceRefJson),
        normalized.input.sourceFingerprint,
        normalized.input.reasonCode,
        normalized.input.reasonDetail,
        normalized.input.suggestedAction,
        normalized.input.priority,
        normalized.input.confidence,
        jsonOrNull(normalized.input.candidateSummariesJson),
        jsonOrNull(normalized.input.metadataJson),
        normalized.input.actorUserId,
        normalized.input.dueAt
      );
      const item = mapReviewItem(insertedRows[0]);

      await recordAuditEvent(tx, {
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        eventType: "manager_review.item_created",
        entityType: "V2ManagerReviewItem",
        entityId: item.id,
        metadataJson: buildAuditMetadata(item, input.membershipId, input.source),
      });

      return { kind: "created", item };
    } catch (error) {
      const duplicate = await findActiveByFingerprint(
        tx,
        input.organizationId,
        normalized.input.sourceFingerprint
      );

      if (duplicate && isUniqueConflict(error)) {
        return { kind: "existing_active", item: duplicate };
      }

      throw error;
    }
  });
}

export function reviewItemReturningColumns() {
  return `
    "id",
    "organizationId",
    "leadAssignmentId",
    "hardRuleAssessmentId",
    "projectId",
    "companyId",
    "contactId",
    "icpVersionId",
    "sourceType"::text AS "sourceType",
    "sourceId",
    "sourceRefJson",
    "sourceFingerprint",
    "reasonCode"::text AS "reasonCode",
    "reasonDetail",
    "suggestedAction",
    "priority"::text AS "priority",
    "confidence"::text AS "confidence",
    "candidateSummariesJson",
    "metadataJson",
    "status"::text AS "status",
    "assignedToUserId",
    "createdByUserId",
    "resolvedByUserId",
    "resolutionType"::text AS "resolutionType",
    "resolutionNote",
    "resolutionMetadataJson",
    "dueAt",
    "snoozedUntil",
    "resolvedAt",
    "archivedAt",
    "deletedAt",
    "createdAt",
    "updatedAt"
  `;
}

export async function findActiveByFingerprint(
  db: ManagerReviewTransactionDb,
  organizationId: string,
  sourceFingerprint: string
): Promise<ManagerReviewItem | null> {
  const rows = await db.$queryRawUnsafe<ManagerReviewSqlRow[]>(
    `
      SELECT ${reviewItemReturningColumns()}
      FROM "V2ManagerReviewItem"
      WHERE "organizationId" = $1
        AND "sourceFingerprint" = $2
        AND "deletedAt" IS NULL
        AND "status" IN (${ACTIVE_STATUS_SQL})
      ORDER BY "createdAt" ASC
      LIMIT 1
    `,
    organizationId,
    sourceFingerprint
  );

  return rows[0] ? mapReviewItem(rows[0]) : null;
}

export function buildAuditMetadata(
  item: ManagerReviewItem,
  membershipId: string,
  source = "MANAGER_REVIEW_RUNTIME",
  extra?: Record<string, unknown>
) {
  return {
    membershipId,
    previousStatus: extra?.previousStatus ?? null,
    nextStatus: extra?.nextStatus ?? item.status,
    previousAssignee: extra?.previousAssignee ?? null,
    nextAssignee: extra?.nextAssignee ?? item.assignedToUserId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    sourceFingerprint: item.sourceFingerprint,
    reasonCode: item.reasonCode,
    leadAssignmentId: item.leadAssignmentId,
    hardRuleAssessmentId: item.hardRuleAssessmentId,
    projectId: item.projectId,
    companyId: item.companyId,
    contactId: item.contactId,
    icpVersionId: item.icpVersionId,
    resolutionType: item.resolutionType,
    source,
    ...extra,
  };
}

function normalizeCreateInput(input: CreateReviewItemInput) {
  if (!isManagerReviewSourceType(input.sourceType)) {
    return createInvalidResult("INVALID_SOURCE_TYPE", "Invalid sourceType.");
  }

  if (!isManagerReviewReasonCode(input.reasonCode)) {
    return createInvalidResult("INVALID_REASON_CODE", "Invalid reasonCode.");
  }

  const priority = input.priority ?? "NORMAL";
  const confidence = input.confidence ?? "UNKNOWN";

  if (!isManagerReviewPriority(priority)) {
    return createInvalidResult("INVALID_PRIORITY", "Invalid priority.");
  }

  if (!isManagerReviewConfidence(confidence)) {
    return createInvalidResult("INVALID_CONFIDENCE", "Invalid confidence.");
  }

  const fingerprint = buildManagerReviewSourceFingerprint(
    input as ManagerReviewSourceFingerprintInput
  );

  if (fingerprint.kind === "invalid") {
    return fingerprint;
  }

  return {
    kind: "ok" as const,
    input: {
      ...input,
      priority,
      confidence,
      sourceId: input.sourceId ?? fingerprint.sourceId,
      sourceFingerprint: fingerprint.sourceFingerprint,
    },
  };
}

async function validateLinkedRecords(
  db: ManagerReviewTransactionDb,
  input: CreateReviewItemInput & {
    sourceFingerprint: string;
    priority: ManagerReviewPriority;
    confidence: ManagerReviewConfidence;
  }
): Promise<CreateReviewItemResult | null> {
  if (
    ["MANUAL_SDR_REQUEST", "WORKFLOW_CONFLICT"].includes(input.sourceType) &&
    !input.leadAssignmentId
  ) {
    return createInvalidResult(
      "INVALID_INPUT",
      `${input.sourceType} requires leadAssignmentId.`
    );
  }

  if (input.leadAssignmentId) {
    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM "V2LeadAssignment"
        WHERE "id" = $1
          AND "organizationId" = $2
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
        LIMIT 1
      `,
      input.leadAssignmentId,
      input.organizationId
    );

    if (!rows[0]) {
      return linkedNotFound("leadAssignmentId");
    }
  }

  if (input.hardRuleAssessmentId) {
    const rows = await db.$queryRawUnsafe<Array<{ id: string; leadAssignmentId: string }>>(
      `
        SELECT "id", "leadAssignmentId"
        FROM "V2HardRuleAssessment"
        WHERE "id" = $1
          AND "organizationId" = $2
        LIMIT 1
      `,
      input.hardRuleAssessmentId,
      input.organizationId
    );

    if (!rows[0]) {
      return linkedNotFound("hardRuleAssessmentId");
    }

    if (
      input.sourceType === "HARD_RULE_ASSESSMENT" &&
      input.leadAssignmentId &&
      rows[0].leadAssignmentId !== input.leadAssignmentId
    ) {
      return createInvalidResult(
        "INVALID_INPUT",
        "hardRuleAssessmentId and leadAssignmentId must refer to the same lead assignment."
      );
    }
  }

  for (const linked of [
    ["companyId", input.companyId, `"V2Company"`, `AND "status" = 'ACTIVE' AND "deletedAt" IS NULL`],
    ["contactId", input.contactId, `"V2Contact"`, `AND "status" = 'ACTIVE' AND "deletedAt" IS NULL`],
    ["projectId", input.projectId, `"V2Project"`, `AND "status" = 'ACTIVE'`],
    ["icpVersionId", input.icpVersionId, `"V2ICPVersion"`, `AND "deletedAt" IS NULL`],
  ] as const) {
    const [field, id, table, extraWhere] = linked;

    if (!id) {
      continue;
    }

    const rows = await db.$queryRawUnsafe<Array<{ id: string }>>(
      `
        SELECT "id"
        FROM ${table}
        WHERE "id" = $1
          AND "organizationId" = $2
          ${extraWhere}
        LIMIT 1
      `,
      id,
      input.organizationId
    );

    if (!rows[0]) {
      return linkedNotFound(field);
    }
  }

  return null;
}

function linkedNotFound(field: string): CreateReviewItemResult {
  return {
    kind: "not_found",
    code: "LINKED_RECORD_NOT_FOUND",
    message: `Linked ${field} was not found in this organization.`,
  };
}

function createManagerReviewItemId() {
  return `mri_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function jsonOrNull(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function isUniqueConflict(error: unknown) {
  const text = String(
    (error as { code?: unknown; message?: unknown; meta?: unknown })?.code ??
      (error as { message?: unknown })?.message ??
      (error as { meta?: unknown })?.meta ??
      ""
  );

  return (
    text.includes("P2010") ||
    text.includes("23505") ||
    text.includes("V2ManagerReviewItem_active_sourceFingerprint_key")
  );
}
