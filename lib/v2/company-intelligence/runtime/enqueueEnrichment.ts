import "server-only";

import { isBullEnabled } from "../../bullmq/config";
import { V2_QUEUE_NAMES } from "../../bullmq/queueNames";
import { addJob } from "../../bullmq/queues";
import type { V2JobDatabase, V2JobSourceType } from "../../jobs/types";
import { enqueueCompanyEnrichmentJob } from "../index";

// P4 split: one place that decides HOW a company enrichment executes.
//   - BullMQ enabled -> enqueue research.discover (fans through fetch -> extract).
//   - otherwise       -> the existing single COMPANY_ENRICHMENT V2Job (db ledger).
// Both end at the same persisted snapshot + profile + scoring handoff.

export type EnrichmentExecutionMode = "bull" | "db";

export async function enqueueEnrichmentExecution(
  db: V2JobDatabase,
  input: {
    organizationId: string;
    companyId: string;
    researchVersion: number;
    createdByUserId?: string | null;
    runtimeRunId?: string | null;
    source?: { sourceType: V2JobSourceType; sourceId: string | null };
  }
): Promise<{ mode: EnrichmentExecutionMode }> {
  const { organizationId, companyId, researchVersion } = input;

  if (isBullEnabled()) {
    await addJob(
      V2_QUEUE_NAMES.researchDiscover,
      "research.discover",
      { organizationId, companyId, researchVersion, createdByUserId: input.createdByUserId ?? null, runtimeRunId: input.runtimeRunId ?? null, sourceType: input.source?.sourceType ?? "MANUAL", sourceId: input.source ? input.source.sourceId : companyId },
      { jobId: `enrich_${organizationId}_${companyId}_${researchVersion}_discover` }
    );
    return { mode: "bull" };
  }

  await enqueueCompanyEnrichmentJob(db, {
    organizationId,
    companyId,
    researchVersion,
    createdByUserId: input.createdByUserId ?? null,
    source: input.source,
  });
  return { mode: "db" };
}
