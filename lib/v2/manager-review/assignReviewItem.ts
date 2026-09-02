import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";

import {
  buildAuditMetadata,
  reviewItemReturningColumns,
} from "./createReviewItem";
import {
  createInvalidResult,
  getDefaultManagerReviewDb,
  mapReviewItem,
  validateAssignableUser,
  type ManagerReviewDb,
  type ManagerReviewInvalidResult,
  type ManagerReviewItem,
  type ManagerReviewNoChangeResult,
  type ManagerReviewNotFoundResult,
  type ManagerReviewSqlRow,
} from "./types";
import {
  prepareMutation,
  requireActiveTransition,
  type ReviewItemMutationBase,
} from "./lifecycle";

export type AssignReviewItemInput = ReviewItemMutationBase & {
  assignedToUserId: string | null;
};

export type AssignReviewItemResult =
  | { kind: "assigned"; item: ManagerReviewItem }
  | ManagerReviewNoChangeResult
  | ManagerReviewInvalidResult
  | ManagerReviewNotFoundResult;

/**
 * Precondition: caller has already passed manager_review.decide or equivalent
 * route/service permission check. MR2 validates tenant/membership integrity only.
 */
export async function assignReviewItem(
  input: AssignReviewItemInput,
  db?: ManagerReviewDb
): Promise<AssignReviewItemResult> {
  const activeDb = db ?? (await getDefaultManagerReviewDb());

  return activeDb.$transaction(async (tx) => {
    const prepared = await prepareMutation(tx, input);

    if (prepared.kind !== "ok") {
      return prepared;
    }

    const transitionError = requireActiveTransition(
      prepared.item,
      ["OPEN", "IN_PROGRESS", "SNOOZED"],
      "assign"
    );

    if (transitionError) {
      return transitionError;
    }

    if (prepared.item.assignedToUserId === input.assignedToUserId) {
      return { kind: "no_change", item: prepared.item };
    }

    if (input.assignedToUserId) {
      const assigneeError = await validateAssignableUser(
        tx,
        input.organizationId,
        input.assignedToUserId
      );

      if (assigneeError) {
        return assigneeError;
      }
    }

    const updatedRows = await tx.$queryRawUnsafe<ManagerReviewSqlRow[]>(
      `
        UPDATE "V2ManagerReviewItem"
        SET
          "assignedToUserId" = $1,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $2
          AND "organizationId" = $3
          AND "deletedAt" IS NULL
        RETURNING ${reviewItemReturningColumns()}
      `,
      input.assignedToUserId,
      input.reviewItemId,
      input.organizationId
    );
    const updated = updatedRows[0] ? mapReviewItem(updatedRows[0]) : null;

    if (!updated) {
      return createInvalidResult(
        "INVALID_INPUT",
        "Manager review item could not be assigned."
      );
    }

    await recordAuditEvent(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      eventType: "manager_review.item_assigned",
      entityType: "V2ManagerReviewItem",
      entityId: updated.id,
      metadataJson: buildAuditMetadata(
        updated,
        input.membershipId,
        input.source,
        {
          previousStatus: prepared.item.status,
          nextStatus: updated.status,
          previousAssignee: prepared.item.assignedToUserId,
          nextAssignee: updated.assignedToUserId,
        }
      ),
    });

    return { kind: "assigned", item: updated };
  });
}
