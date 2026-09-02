import "server-only";

import {
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

export type StartReviewItemInput = ReviewItemMutationBase;

export type StartReviewItemResult =
  | { kind: "started"; item: ManagerReviewItem }
  | ManagerReviewInvalidResult
  | ManagerReviewNotFoundResult;

/**
 * Precondition: caller has already passed manager_review.decide or equivalent
 * route/service permission check. MR2 validates tenant/membership integrity only.
 */
export async function startReviewItem(
  input: StartReviewItemInput,
  db?: ManagerReviewDb
): Promise<StartReviewItemResult> {
  const activeDb = db ?? (await getDefaultManagerReviewDb());

  return activeDb.$transaction(async (tx) => {
    const prepared = await prepareMutation(tx, input);

    if (prepared.kind !== "ok") {
      return prepared;
    }

    const transitionError = requireActiveTransition(
      prepared.item,
      ["OPEN"],
      "start"
    );

    if (transitionError) {
      return transitionError;
    }

    const item = await updateReviewStatus(tx, {
      item: prepared.item,
      nextStatus: "IN_PROGRESS",
      actorUserId: input.actorUserId,
      membershipId: input.membershipId,
      eventType: "manager_review.item_started",
      source: input.source,
    });

    return { kind: "started", item };
  });
}
