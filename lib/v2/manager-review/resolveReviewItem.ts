import "server-only";

import { enqueueIcpScoreJob } from "@/lib/v2/scoring/runtime/enqueueScoringJobs";
import type { V2ScoreRuntimeDatabase } from "@/lib/v2/scoring/runtime/types";

import {
  createInvalidResult,
  getDefaultManagerReviewDb,
  isManagerReviewResolutionType,
  type ManagerReviewDb,
  type ManagerReviewInvalidResult,
  type ManagerReviewItem,
  type ManagerReviewNotFoundResult,
  type ManagerReviewResolutionType,
} from "./types";
import {
  prepareMutation,
  requireActiveTransition,
  updateReviewStatus,
  type ReviewItemMutationBase,
} from "./lifecycle";

export type ResolveReviewItemInput = ReviewItemMutationBase & {
  resolutionType: ManagerReviewResolutionType;
  resolutionNote?: string | null;
  resolutionMetadataJson?: unknown;
};

/**
 * M2 (Link C) — outcome of the review → rescore bridge. A resolution that
 * corrects scoring input (identity / company / contact re-link) enqueues an
 * idempotent ICP_SCORE; everything else enqueues nothing. The bridge NEVER
 * mutates an existing assessment (Invariant 4) — the score job inserts a new
 * immutable assessment and moves the latest pointer transactionally.
 */
export type ResolveRescoreOutcome =
  | {
      enqueued: true;
      jobId: string;
      deduped: boolean;
    }
  | {
      enqueued: false;
      reason:
        | "not_scoring_input_change"
        | "no_lead_assignment"
        | "enqueue_failed";
    };

export type ResolveReviewItemResult =
  | { kind: "resolved"; item: ManagerReviewItem; rescore: ResolveRescoreOutcome }
  | ManagerReviewInvalidResult
  | ManagerReviewNotFoundResult;

/**
 * Resolution types that change ICP scoring input. Re-linking the lead to a
 * different existing company/contact (LINK_EXISTING) changes the scored
 * identity, so the lead must be rescored. Workflow-status-only resolutions are
 * deliberately excluded: qualification is not workflow status (Invariant 3), so
 * a status change must not trigger a rescore.
 */
const SCORING_INPUT_CHANGING_RESOLUTION_TYPES: ReadonlySet<ManagerReviewResolutionType> =
  new Set<ManagerReviewResolutionType>(["LINK_EXISTING"]);

/**
 * Pure predicate (exported for the M2 smoke). An explicit `rescore` boolean in
 * the resolution metadata wins over the resolution-type default, so a caller
 * that knows it changed (or did not change) scoring input can be authoritative.
 */
export function resolutionChangesScoringInput(input: {
  resolutionType: ManagerReviewResolutionType;
  resolutionMetadataJson?: unknown;
}): boolean {
  const meta = input.resolutionMetadataJson;

  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const flag = (meta as Record<string, unknown>).rescore;

    if (flag === true) {
      return true;
    }

    if (flag === false) {
      return false;
    }
  }

  return SCORING_INPUT_CHANGING_RESOLUTION_TYPES.has(input.resolutionType);
}

/**
 * The review → rescore bridge. Runs AFTER the resolution has committed (the
 * resolution must not be lost if the rescore enqueue fails). The ICP_SCORE job
 * is idempotency-keyed by org + lead ids, so a duplicate resolution or a retry
 * returns the existing job instead of creating a second one (Invariant 6).
 */
export async function enqueueRescoreForResolution(
  jobDb: V2ScoreRuntimeDatabase,
  args: {
    organizationId: string;
    item: ManagerReviewItem;
    resolutionType: ManagerReviewResolutionType;
    resolutionMetadataJson?: unknown;
    actorUserId: string;
  }
): Promise<ResolveRescoreOutcome> {
  if (
    !resolutionChangesScoringInput({
      resolutionType: args.resolutionType,
      resolutionMetadataJson: args.resolutionMetadataJson,
    })
  ) {
    return { enqueued: false, reason: "not_scoring_input_change" };
  }

  if (!args.item.leadAssignmentId) {
    return { enqueued: false, reason: "no_lead_assignment" };
  }

  try {
    const result = await enqueueIcpScoreJob(jobDb, {
      organizationId: args.organizationId,
      selection: {
        kind: "lead_assignment_ids",
        leadAssignmentIds: [args.item.leadAssignmentId],
      },
      createdByUserId: args.actorUserId,
      // Bind the rescore to the review item that triggered it for traceability.
      source: { sourceType: "MANUAL", sourceId: args.item.id },
    });

    if (result.kind === "conflict") {
      return { enqueued: false, reason: "enqueue_failed" };
    }

    return {
      enqueued: true,
      jobId: result.job.id,
      deduped: result.kind === "existing",
    };
  } catch {
    // The resolution already committed; a failed rescore enqueue must not undo
    // it. A later manual rescore (or a re-resolution) recovers the freshness.
    return { enqueued: false, reason: "enqueue_failed" };
  }
}

/**
 * Precondition: caller has already passed manager_review.decide or equivalent
 * route/service permission check. MR2 validates tenant/membership integrity only.
 */
export async function resolveReviewItem(
  input: ResolveReviewItemInput,
  db?: ManagerReviewDb,
  jobDb?: V2ScoreRuntimeDatabase
): Promise<ResolveReviewItemResult> {
  if (!input.resolutionType) {
    return createInvalidResult(
      "RESOLUTION_TYPE_REQUIRED",
      "resolutionType is required."
    );
  }

  if (!isManagerReviewResolutionType(input.resolutionType)) {
    return createInvalidResult(
      "INVALID_RESOLUTION_TYPE",
      "Invalid resolutionType."
    );
  }

  const activeDb = db ?? (await getDefaultManagerReviewDb());

  const txResult = await activeDb.$transaction(async (tx) => {
    const prepared = await prepareMutation(tx, input);

    if (prepared.kind !== "ok") {
      return prepared;
    }

    const transitionError = requireActiveTransition(
      prepared.item,
      ["OPEN", "IN_PROGRESS", "SNOOZED"],
      "resolve"
    );

    if (transitionError) {
      return transitionError;
    }

    const item = await updateReviewStatus(tx, {
      item: prepared.item,
      nextStatus: "RESOLVED",
      actorUserId: input.actorUserId,
      membershipId: input.membershipId,
      eventType: "manager_review.item_resolved",
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

    return { kind: "ok_resolved" as const, item };
  });

  if (txResult.kind !== "ok_resolved") {
    return txResult;
  }

  // M2 bridge: enqueue a rescore only when the resolution changed scoring input.
  // Runs outside the resolve transaction because job enqueue uses the tagged
  // `$queryRaw` job-db interface (the MR transaction exposes `$queryRawUnsafe`).
  const resolvedJobDb = jobDb ?? (await getDefaultJobDb());
  const rescore = await enqueueRescoreForResolution(resolvedJobDb, {
    organizationId: input.organizationId,
    item: txResult.item,
    resolutionType: input.resolutionType,
    resolutionMetadataJson: input.resolutionMetadataJson,
    actorUserId: input.actorUserId,
  });

  return { kind: "resolved", item: txResult.item, rescore };
}

async function getDefaultJobDb(): Promise<V2ScoreRuntimeDatabase> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma as unknown as V2ScoreRuntimeDatabase;
}
