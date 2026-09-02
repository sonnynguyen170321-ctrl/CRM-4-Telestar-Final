import { enqueueV2Job } from "../jobs/enqueueJob";
import { currentResearchVersion } from "./pipelineVersion";
import type { EnqueueV2JobResult, V2JobSourceType } from "../jobs/types";
import {
  COMPANY_ENRICHMENT_JOB_SCHEMA_VERSION,
  type CompanyEnrichmentJobPayload,
  type V2CompanyIntelligenceDatabase,
} from "./types";

export { companyEnrichmentJobHandler } from "./companyEnrichmentHandler";

export async function enqueueCompanyEnrichmentJob(
  db: V2CompanyIntelligenceDatabase,
  input: {
    organizationId: string;
    companyId: string;
    researchVersion?: number;
    createdByUserId?: string | null;
    // Job source binding. Defaults to MANUAL (sourceId = companyId). When this
    // enrichment job is enqueued as part of an ingestion pipeline, the caller
    // passes { sourceType: "INGESTION_JOB", sourceId: ingestionJobId } so the
    // per-batch run control can claim it (and the handler forwards the same
    // binding onto the ICP_SCORE job it enqueues). Without this binding the
    // enrichment job is MANUAL-scoped and the ingestion run button can never
    // drain it — the leak that stalled the whole pipeline at enrichment.
    source?: { sourceType: V2JobSourceType; sourceId: string | null };
  }
): Promise<EnqueueV2JobResult> {
  const researchVersion = input.researchVersion ?? currentResearchVersion();

  if (!Number.isInteger(researchVersion) || researchVersion < 1) {
    throw new Error(
      "enqueueCompanyEnrichmentJob researchVersion must be a positive integer."
    );
  }

  const payload: CompanyEnrichmentJobPayload = {
    schemaVersion: COMPANY_ENRICHMENT_JOB_SCHEMA_VERSION,
    organizationId: input.organizationId,
    companyId: input.companyId,
    researchVersion,
  };

  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "COMPANY_ENRICHMENT",
    sourceType: input.source?.sourceType ?? "MANUAL",
    sourceId: input.source ? input.source.sourceId : input.companyId,
    idempotencyKey: buildCompanyEnrichmentJobIdempotencyKey(
      input.organizationId,
      input.companyId,
      researchVersion
    ),
    payload,
    createdByUserId: input.createdByUserId ?? null,
  });
}

export function buildCompanyEnrichmentJobIdempotencyKey(
  organizationId: string,
  companyId: string,
  researchVersion: number
) {
  return `company-enrichment:${organizationId}:${companyId}:${researchVersion}`;
}
