import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";
import { isFeedbackDatasetSplit, type FeedbackDatasetSplit } from "./types";

// M4 learning loop: a MANAGER gates which captured feedback examples become
// tuning-eligible (approvedForLearning). Capture (createFeedbackExample) records the
// signal as pending; this flips it. It NEVER mutates the assessment or ICP rules
// (Invariant 4) — it only toggles an advisory flag + writes an audit event.
// Tenant-scoped from the caller's session orgId (Invariant 5). Idempotent.

export type SetApprovedForLearningDbTx = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export type SetApprovedForLearningDb = SetApprovedForLearningDbTx & {
  $transaction<T>(fn: (tx: SetApprovedForLearningDbTx) => Promise<T>): Promise<T>;
};

export type SetApprovedForLearningInput = {
  organizationId: string;
  actorUserId: string;
  feedbackExampleId: string;
  approved: boolean;
  // Dataset bucket to assign when approving (default TRAIN). Ignored when revoking.
  datasetSplit?: FeedbackDatasetSplit;
};

export type SetApprovedForLearningResult =
  | { kind: "updated"; approved: boolean; datasetSplit: FeedbackDatasetSplit }
  | { kind: "no_change" }
  | { kind: "not_found" }
  | { kind: "invalid"; code: string; message: string };

/** Pure: is this a real flag change vs a no-op? (Unit-testable, no I/O.) */
export function classifyApprovalChange(
  currentApproved: boolean,
  requestedApproved: boolean
): "change" | "no_change" {
  return currentApproved === requestedApproved ? "no_change" : "change";
}

export async function setFeedbackApprovedForLearning(
  db: SetApprovedForLearningDb,
  input: SetApprovedForLearningInput
): Promise<SetApprovedForLearningResult> {
  const datasetSplit: FeedbackDatasetSplit = input.approved
    ? input.datasetSplit ?? "TRAIN"
    : "UNSPECIFIED";
  if (!isFeedbackDatasetSplit(datasetSplit)) {
    return { kind: "invalid", code: "INVALID_DATASET_SPLIT", message: "datasetSplit is invalid." };
  }

  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ approvedForLearning: boolean; datasetSplit: string }>>(
      `SELECT "approvedForLearning", "datasetSplit"::text AS "datasetSplit"
         FROM "V2FeedbackExample"
        WHERE "id" = $1 AND "organizationId" = $2
        LIMIT 1`,
      input.feedbackExampleId,
      input.organizationId
    );
    const current = rows[0];
    if (!current) return { kind: "not_found" };

    if (classifyApprovalChange(current.approvedForLearning, input.approved) === "no_change") {
      return { kind: "no_change" };
    }

    await tx.$queryRawUnsafe(
      `UPDATE "V2FeedbackExample"
          SET "approvedForLearning" = $1,
              "datasetSplit" = $2::"V2DatasetSplit"
        WHERE "id" = $3 AND "organizationId" = $4`,
      input.approved,
      datasetSplit,
      input.feedbackExampleId,
      input.organizationId
    );

    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: input.approved ? "feedback.approved_for_learning" : "feedback.learning_revoked",
      entityType: "V2FeedbackExample",
      entityId: input.feedbackExampleId,
      metadataJson: {
        previousApproved: current.approvedForLearning,
        nextApproved: input.approved,
        datasetSplit,
      },
    });

    return { kind: "updated", approved: input.approved, datasetSplit };
  });
}
