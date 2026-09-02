import { createNonRetryableJobError } from "../jobs/errors";
import type { V2JobDatabase } from "../jobs/types";

export const COMPANY_ENRICHMENT_JOB_SCHEMA_VERSION = "v2.company-enrichment.job.v1";

export type CompanyEnrichmentJobPayload = {
  schemaVersion: typeof COMPANY_ENRICHMENT_JOB_SCHEMA_VERSION;
  organizationId: string;
  companyId: string;
  researchVersion: number;
};

export type V2CompanyIntelligenceDatabase = V2JobDatabase;

export function parseCompanyEnrichmentJobPayload(value: unknown): CompanyEnrichmentJobPayload {
  if (!value || typeof value !== "object") {
    throw createNonRetryableJobError(
      "INVALID_COMPANY_ENRICHMENT_PAYLOAD",
      "COMPANY_ENRICHMENT payload must be an object."
    );
  }

  const candidate = value as CompanyEnrichmentJobPayload;

  if (candidate.schemaVersion !== COMPANY_ENRICHMENT_JOB_SCHEMA_VERSION) {
    throw createNonRetryableJobError(
      "INVALID_COMPANY_ENRICHMENT_PAYLOAD",
      "COMPANY_ENRICHMENT payload schemaVersion was invalid."
    );
  }

  if (typeof candidate.organizationId !== "string" || candidate.organizationId.trim() === "") {
    throw createNonRetryableJobError(
      "INVALID_COMPANY_ENRICHMENT_PAYLOAD",
      "COMPANY_ENRICHMENT payload organizationId was missing."
    );
  }

  if (typeof candidate.companyId !== "string" || candidate.companyId.trim() === "") {
    throw createNonRetryableJobError(
      "INVALID_COMPANY_ENRICHMENT_PAYLOAD",
      "COMPANY_ENRICHMENT payload companyId was missing."
    );
  }

  if (!Number.isInteger(candidate.researchVersion) || candidate.researchVersion < 1) {
    throw createNonRetryableJobError(
      "INVALID_COMPANY_ENRICHMENT_PAYLOAD",
      "COMPANY_ENRICHMENT payload researchVersion must be a positive integer."
    );
  }

  return candidate;
}
