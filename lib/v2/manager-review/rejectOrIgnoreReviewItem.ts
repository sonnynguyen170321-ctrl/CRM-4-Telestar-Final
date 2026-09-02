import "server-only";

import {
  createInvalidResult,
  getDefaultManagerReviewDb,
  type ManagerReviewDb,
  type ManagerReviewInvalidResult,
  type ManagerReviewItem,
  type ManagerReviewNotFoundResult,
} from "./types";
import {
  prepareMutation,
  requireActiveTransition,
  updateReviewStatus,
  type ReviewItemMutationBase,
} from "./lifecycle";

export type RejectOrIgnoreReviewItemInput = ReviewItemMutationBase & {
  resolutionType: "REJECT_DISMISS" | "NO_ACTION_NON_ACTIONABLE";
  resolutionNote?: string | null;
  resolutionMetadataJson?: unknown;
};

export type RejectOrIgnoreReviewItemResult =
  | { kind: "dismissed"; item: ManagerReviewItem }
  | ManagerReviewInvalidResult
  | ManagerReviewNotFoundResult;

/**
 * Precondition: caller has already passed manager_review.decide or equivalent
 * route/service permission check. MR2 validates tenant/membership integrity only.
 */
export async function rejectOrIgnoreReviewItem(
  input: RejectOrIgnoreReviewItemInput,
  db?: ManagerReviewDb
): Promise<RejectOrIgnoreReviewItemResult> {
  if (
    input.resolutionType !== "REJECT_DISMISS" &&
    input.resolutionType !== "NO_ACTION_NON_ACTIONABLE"
  ) {
    return createInvalidResult(
      "INVALID_RESOLUTION_TYPE",
      "Dismissal requires REJECT_DISMISS or NO_ACTION_NON_ACTIONABLE."
    );
  }

  const activeDb = db ?? (await getDefaultManagerReviewDb());

  return activeDb.$transaction(async (tx) => {
    const prepared = await prepareMutation(tx, input);

    if (prepared.kind !== "ok") {
      return prepared;
    }

    const transitionError = requireActiveTransition(
      prepared.item,
      ["OPEN", "IN_PROGRESS", "SNOOZED"],
      "dismiss"
    );

    if (transitionError) {
      return transitionError;
    }

    const item = await updateReviewStatus(tx, {
      item: prepared.item,
      nextStatus: "DISMISSED",
      actorUserId: input.actorUserId,
      membershipId: input.membershipId,
      eventType: "manager_review.item_dismissed",
      source: input.source,
      setSql: `"resolutionType" = $4::"V2ManagerReviewResolutionType", "resolutionNote" = $5, "resolutionMetadataJson" = $6::jsonb, "resolvedByUserId" = $7, "resolvedAt" = CURRENT_TIMESTAMP`,
      values: [
        input.resolutionType,
        input.resolutionNote ?? null,
        input.resolutionMetadataJson === undefined
          ? null
          : JSON.stringify(input.resolutionMetadataJson),
        input.actorUserId,
      ],
      extraAudit: {
        resolutionType: input.resolutionType,
      },
    });

    return { kind: "dismissed", item };
  });
}
