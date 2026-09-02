import { createNonRetryableJobError } from "../jobs/errors";
import type { V2JobHandler } from "../jobs/types";
import { executeResearchDiscovery } from "./runResearchDiscovery";

// Durable V2Job handler for RESEARCH_DISCOVERY. Payload = { researchRunId, cursor };
// the run row carries the canonical ICP, kind, queries, and cursor. Each job drains one
// bounded batch and may enqueue the next cursor.

export const researchDiscoveryJobHandler: V2JobHandler = async (context) => {
  const payload = context.payload as { researchRunId?: unknown };
  const researchRunId = typeof payload?.researchRunId === "string" ? payload.researchRunId : null;
  if (!researchRunId) {
    throw createNonRetryableJobError("RESEARCH_PAYLOAD_INVALID", "RESEARCH_DISCOVERY payload requires researchRunId.");
  }

  const result = await executeResearchDiscovery({
    organizationId: context.organizationId,
    researchRunId,
  });

  return {
    resultSnapshotJson: { researchRunId, ...result },
    progressCurrent: result.cursor,
    progressTotal: result.totalQueries,
  };
};