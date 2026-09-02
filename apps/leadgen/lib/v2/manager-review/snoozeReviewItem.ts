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

export type SnoozeReviewItemInput = ReviewItemMutationBase & {
  snoozedUntil: Date | string;
  note?: string | null;
  metadataJson?: unknown;
};

export type SnoozeReviewItemResult =
  | { kind: "snoozed"; item: ManagerReviewItem }
  | ManagerReviewInvalidResult
  | ManagerReviewNotFoundResult;

/**
 * Precondition: caller has already passed manager_review.decide or equivalent
 * route/service permission check. MR2 validates tenant/membership integrity only.
 */
export async function snoozeReviewItem(
  input: SnoozeReviewItemInput,
  db?: ManagerReviewDb
): Promise<SnoozeReviewItemResult> {
  if (!input.snoozedUntil) {
    return createInvalidResult(
      "SNOOZED_UNTIL_REQUIRED",
      "snoozedUntil is required."
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
      ["OPEN", "IN_PROGRESS"],
      "snooze"
    );

    if (transitionError) {
      return transitionError;
    }

    const item = await updateReviewStatus(tx, {
      item: prepared.item,
      nextStatus: "SNOOZED",
      actorUserId: input.actorUserId,
      membershipId: input.membershipId,
      eventType: "manager_review.item_snoozed",
      source: input.source,
      setSql: `"snoozedUntil" = $4::timestamp, "resolutionNote" = COALESCE($5, "resolutionNote"), "resolutionMetadataJson" = COALESCE($6::jsonb, "resolutionMetadataJson")`,
      values: [
        input.snoozedUntil,
        input.note ?? null,
        input.metadataJson === undefined ? null : JSON.stringify(input.metadataJson),
      ],
      extraAudit: {
        snoozedUntil: input.snoozedUntil,
        ...(input.note ? { note: input.note } : {}),
      },
    });

    return { kind: "snoozed", item };
  });
}
