import "server-only";

import { buildFeedbackFingerprint } from "./fingerprint";
import {
  FEEDBACK_DEFAULT_SOURCE,
  isFeedbackDatasetSplit,
  isFeedbackFinalQualification,
  type FeedbackDatasetSplit,
  type FeedbackExampleRow,
  type FeedbackFinalQualification,
} from "./types";

export type FeedbackDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(callback: (tx: FeedbackTransactionDb) => Promise<T>): Promise<T>;
};

export type FeedbackTransactionDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type CreateFeedbackExampleInput = {
  organizationId: string;
  leadAssignmentId: string;
  reviewedByUserId: string;
  finalQualification: FeedbackFinalQualification;
  finalFitScore?: number | null;
  finalCompanyType?: string | null;
  finalReason?: string | null;
  approvedForLearning?: boolean;
  datasetSplit?: FeedbackDatasetSplit;
  source?: string;
  correctionJson?: unknown;
  evidenceJson?: unknown;
};

export type CreateFeedbackExampleResult =
  | { kind: "created"; example: FeedbackExampleRow }
  | { kind: "duplicate"; example: FeedbackExampleRow }
  | { kind: "invalid"; code: string; message: string }
  | { kind: "lead_not_found"; message: string };

type LeadSnapshotRow = {
  icpVersionId: string | null;
  latestHardRuleAssessmentId: string | null;
  predictedFitScore: number | null;
  predictedQualification: string | null;
  predictedCompanyType: string | null;
  predictedReason: string | null;
};

/**
 * M3 — capture a feedback example for a lead assignment, snapshotting the
 * current (immutable) assessment as the "predicted" baseline and the human
 * correction as the "final" truth. This NEVER mutates the assessment or the ICP
 * rules (Invariant 4); it only inserts an advisory learning row. Idempotent by
 * fingerprint (Invariant 6): an exact duplicate returns the existing example.
 */
export async function createFeedbackExample(
  input: CreateFeedbackExampleInput,
  db: FeedbackDb
): Promise<CreateFeedbackExampleResult> {
  if (!input.organizationId || !input.leadAssignmentId || !input.reviewedByUserId) {
    return {
      kind: "invalid",
      code: "MISSING_REQUIRED_FIELD",
      message: "organizationId, leadAssignmentId, and reviewedByUserId are required.",
    };
  }

  if (!isFeedbackFinalQualification(input.finalQualification)) {
    return {
      kind: "invalid",
      code: "INVALID_FINAL_QUALIFICATION",
      message: "finalQualification must be a canonical qualification (UNCERTAIN is not allowed).",
    };
  }

  const datasetSplit = input.datasetSplit ?? "UNSPECIFIED";

  if (!isFeedbackDatasetSplit(datasetSplit)) {
    return {
      kind: "invalid",
      code: "INVALID_DATASET_SPLIT",
      message: "datasetSplit must be one of UNSPECIFIED, TRAIN, EVAL, HOLDOUT.",
    };
  }

  if (
    input.finalFitScore !== undefined &&
    input.finalFitScore !== null &&
    (!Number.isInteger(input.finalFitScore) ||
      input.finalFitScore < 0 ||
      input.finalFitScore > 100)
  ) {
    return {
      kind: "invalid",
      code: "INVALID_FINAL_FIT_SCORE",
      message: "finalFitScore must be an integer between 0 and 100.",
    };
  }

  const source = input.source?.trim() || FEEDBACK_DEFAULT_SOURCE;

  return db.$transaction(async (tx) => {
    // Tenant-scoped lead lookup + predicted snapshot from the latest immutable
    // assessment. Soft-delete respected (Invariant 8).
    const leadRows = await tx.$queryRawUnsafe<LeadSnapshotRow[]>(
      `
        SELECT
          lead."icpVersionId" AS "icpVersionId",
          lead."latestHardRuleAssessmentId" AS "latestHardRuleAssessmentId",
          assessment."fitScore" AS "predictedFitScore",
          assessment."qualification"::text AS "predictedQualification",
          assessment."companyType" AS "predictedCompanyType",
          assessment."reason" AS "predictedReason"
        FROM "V2LeadAssignment" lead
        LEFT JOIN "V2HardRuleAssessment" assessment
          ON assessment."id" = lead."latestHardRuleAssessmentId"
          AND assessment."organizationId" = lead."organizationId"
        WHERE lead."id" = $1
          AND lead."organizationId" = $2
          AND lead."status" = 'ACTIVE'
          AND lead."deletedAt" IS NULL
        LIMIT 1
      `,
      input.leadAssignmentId,
      input.organizationId
    );

    const lead = leadRows[0];

    if (!lead) {
      return {
        kind: "lead_not_found" as const,
        message: "Lead assignment was not found in this organization.",
      };
    }

    if (!lead.icpVersionId) {
      return {
        kind: "invalid" as const,
        code: "LEAD_MISSING_ICP_VERSION",
        message: "Lead assignment has no ICP version; cannot attach feedback.",
      };
    }

    const fingerprint = buildFeedbackFingerprint({
      organizationId: input.organizationId,
      leadAssignmentId: input.leadAssignmentId,
      icpVersionId: lead.icpVersionId,
      hardRuleAssessmentId: lead.latestHardRuleAssessmentId,
      reviewedByUserId: input.reviewedByUserId,
      finalQualification: input.finalQualification,
      finalFitScore: input.finalFitScore ?? null,
      finalReason: input.finalReason ?? null,
      source,
    });

    const existing = await findByFingerprint(tx, input.organizationId, fingerprint);

    if (existing) {
      return { kind: "duplicate" as const, example: existing };
    }

    const rawExampleJson = {
      fingerprint,
      submittedAtKind: "manual_feedback_form",
    };

    const insertedRows = await tx.$queryRawUnsafe<FeedbackExampleRow[]>(
      `
        INSERT INTO "V2FeedbackExample" (
          "id",
          "organizationId",
          "leadAssignmentId",
          "icpVersionId",
          "hardRuleAssessmentId",
          "reviewedByUserId",
          "source",
          "predictedFitScore",
          "predictedQualification",
          "predictedCompanyType",
          "predictedReason",
          "finalFitScore",
          "finalQualification",
          "finalCompanyType",
          "finalReason",
          "correctionJson",
          "evidenceJson",
          "rawExampleJson",
          "approvedForLearning",
          "datasetSplit",
          "createdAt"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9::"V2Qualification", $10, $11,
          $12, $13::"V2Qualification", $14, $15,
          $16::jsonb, $17::jsonb, $18::jsonb,
          $19, $20::"V2DatasetSplit", CURRENT_TIMESTAMP
        )
        RETURNING ${feedbackReturningColumns()}
      `,
      createFeedbackExampleId(),
      input.organizationId,
      input.leadAssignmentId,
      lead.icpVersionId,
      lead.latestHardRuleAssessmentId,
      input.reviewedByUserId,
      source,
      lead.predictedFitScore,
      lead.predictedQualification,
      lead.predictedCompanyType,
      lead.predictedReason,
      input.finalFitScore ?? null,
      input.finalQualification,
      input.finalCompanyType ?? null,
      input.finalReason ?? null,
      jsonOrNull(input.correctionJson),
      jsonOrNull(input.evidenceJson),
      JSON.stringify(rawExampleJson),
      input.approvedForLearning ?? false,
      datasetSplit
    );

    return { kind: "created" as const, example: insertedRows[0] };
  });
}

export function feedbackReturningColumns() {
  return `
    "id",
    "organizationId",
    "leadAssignmentId",
    "icpVersionId",
    "hardRuleAssessmentId",
    "reviewedByUserId",
    "source",
    "predictedFitScore",
    "predictedQualification"::text AS "predictedQualification",
    "predictedCompanyType",
    "predictedReason",
    "finalFitScore",
    "finalQualification"::text AS "finalQualification",
    "finalCompanyType",
    "finalReason",
    "approvedForLearning",
    "datasetSplit"::text AS "datasetSplit",
    "createdAt"
  `;
}

async function findByFingerprint(
  tx: FeedbackTransactionDb,
  organizationId: string,
  fingerprint: string
): Promise<FeedbackExampleRow | null> {
  const rows = await tx.$queryRawUnsafe<FeedbackExampleRow[]>(
    `
      SELECT ${feedbackReturningColumns()}
      FROM "V2FeedbackExample"
      WHERE "organizationId" = $1
        AND "rawExampleJson"->>'fingerprint' = $2
      ORDER BY "createdAt" ASC
      LIMIT 1
    `,
    organizationId,
    fingerprint
  );

  return rows[0] ?? null;
}

function createFeedbackExampleId() {
  return `fbk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function jsonOrNull(value: unknown) {
  return value === undefined || value === null ? null : JSON.stringify(value);
}
