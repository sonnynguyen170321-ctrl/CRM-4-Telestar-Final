import "server-only";

import { recordAuditEvent } from "@/lib/v2/audit";

import {
  buildAuditMetadata,
  reviewItemReturningColumns,
} from "./createReviewItem";
import {
  createInvalidResult,
  createNotFoundResult,
  isActiveReviewStatus,
  mapReviewItem,
  validateActorMembership,
  type ManagerReviewItem,
  type ManagerReviewMutationInputBase,
  type ManagerReviewMutationSource,
  type ManagerReviewNotFoundResult,
  type ManagerReviewSqlRow,
  type ManagerReviewStatus,
  type ManagerReviewTransactionDb,
} from "./types";

export type ReviewItemMutationBase = ManagerReviewMutationInputBase & {
  reviewItemId: string;
};

export type ReviewItemMutationInvalid =
  | ReturnType<typeof createInvalidResult>
  | ManagerReviewNotFoundResult;

export async function prepareMutation(
  tx: ManagerReviewTransactionDb,
  input: ReviewItemMutationBase
): Promise<
  | { kind: "ok"; item: ManagerReviewItem }
  | ReturnType<typeof createInvalidResult>
  | ManagerReviewNotFoundResult
> {
  const membershipError = await validateActorMembership(tx, input);

  if (membershipError) {
    return membershipError;
  }

  const item = await lockReviewItem(tx, input.organizationId, input.reviewItemId);

  if (!item) {
    return createNotFoundResult();
  }

  return { kind: "ok", item };
}

export async function lockReviewItem(
  tx: ManagerReviewTransactionDb,
  organizationId: string,
  reviewItemId: string
): Promise<ManagerReviewItem | null> {
  const rows = await tx.$queryRawUnsafe<ManagerReviewSqlRow[]>(
    `
      SELECT ${reviewItemReturningColumns()}
      FROM "V2ManagerReviewItem"
      WHERE "id" = $1
        AND "organizationId" = $2
        AND "deletedAt" IS NULL
      FOR UPDATE
    `,
    reviewItemId,
    organizationId
  );

  return rows[0] ? mapReviewItem(rows[0]) : null;
}

export async function updateReviewStatus(
  tx: ManagerReviewTransactionDb,
  input: {
    item: ManagerReviewItem;
    nextStatus: ManagerReviewStatus;
    actorUserId: string;
    membershipId: string;
    eventType: string;
    source?: ManagerReviewMutationSource;
    setSql?: string;
    values?: unknown[];
    extraAudit?: Record<string, unknown>;
  }
): Promise<ManagerReviewItem> {
  // SQL placeholders are intentionally fixed here:
  // $1 nextStatus, $2 review item id, $3 organizationId, $4+ caller values.
  const values = [
    input.nextStatus,
    input.item.id,
    input.item.organizationId,
    ...(input.values ?? []),
  ];
  const updatedRows = await tx.$queryRawUnsafe<ManagerReviewSqlRow[]>(
    `
      UPDATE "V2ManagerReviewItem"
      SET
        "status" = $1::"V2ManagerReviewStatus",
        "updatedAt" = CURRENT_TIMESTAMP
        ${input.setSql ? `, ${input.setSql}` : ""}
      WHERE "id" = $2
        AND "organizationId" = $3
        AND "deletedAt" IS NULL
      RETURNING ${reviewItemReturningColumns()}
    `,
    ...values
  );
  const updated = mapReviewItem(updatedRows[0]);

  await recordAuditEvent(tx, {
    organizationId: input.item.organizationId,
    actorUserId: input.actorUserId,
    eventType: input.eventType,
    entityType: "V2ManagerReviewItem",
    entityId: input.item.id,
    metadataJson: buildAuditMetadata(
      updated,
      input.membershipId,
      input.source,
      {
        previousStatus: input.item.status,
        nextStatus: updated.status,
        previousAssignee: input.item.assignedToUserId,
        nextAssignee: updated.assignedToUserId,
        ...input.extraAudit,
      }
    ),
  });

  return updated;
}

export function requireActiveTransition(
  item: ManagerReviewItem,
  allowedFrom: readonly ManagerReviewStatus[],
  transition: string
) {
  if (!isActiveReviewStatus(item.status) || !allowedFrom.includes(item.status)) {
    return createInvalidResult(
      "INVALID_TRANSITION",
      `Cannot ${transition} a review item from ${item.status}.`
    );
  }

  return null;
}
