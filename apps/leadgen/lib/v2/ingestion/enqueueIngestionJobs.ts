import { enqueueV2Job } from "../jobs/enqueueJob";
import type { EnqueueV2JobResult } from "../jobs/types";
import type { V2IngestionDatabase } from "./types";

export async function enqueueIngestionParseJob(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    csvText: string;
    originalFileName: string;
    createdByUserId?: string | null;
  }
): Promise<EnqueueV2JobResult> {
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "INGESTION_PARSE",
    sourceType: "INGESTION_JOB",
    sourceId: input.ingestionJobId,
    idempotencyKey: `ingestion-parse:${input.organizationId}:${input.ingestionJobId}`,
    payload: {
      schemaVersion: "v2.ingestion.parse-job.v1",
      ingestionJobId: input.ingestionJobId,
      originalFileName: input.originalFileName,
      csvText: input.csvText,
    },
    createdByUserId: input.createdByUserId ?? null,
  });
}

export async function enqueueIngestionNormalizeJob(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    createdByUserId?: string | null;
  }
): Promise<EnqueueV2JobResult> {
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "INGESTION_NORMALIZE",
    sourceType: "INGESTION_JOB",
    sourceId: input.ingestionJobId,
    idempotencyKey: `ingestion-normalize:${input.organizationId}:${input.ingestionJobId}`,
    payload: {
      schemaVersion: "v2.ingestion.normalize-job.v1",
      ingestionJobId: input.ingestionJobId,
    },
    createdByUserId: input.createdByUserId ?? null,
  });
}

export async function enqueueIngestionIdentityMatchJob(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    createdByUserId?: string | null;
  }
): Promise<EnqueueV2JobResult> {
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "IDENTITY_MATCH",
    sourceType: "INGESTION_JOB",
    sourceId: input.ingestionJobId,
    idempotencyKey: `ingestion-identity-match:${input.organizationId}:${input.ingestionJobId}`,
    payload: {
      schemaVersion: "v2.ingestion.identity-match-job.v1",
      ingestionJobId: input.ingestionJobId,
    },
    createdByUserId: input.createdByUserId ?? null,
  });
}

export async function enqueueLeadAssignmentUpsertJob(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    createdByUserId?: string | null;
  }
): Promise<EnqueueV2JobResult> {
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "LEAD_ASSIGNMENT_UPSERT",
    sourceType: "INGESTION_JOB",
    sourceId: input.ingestionJobId,
    idempotencyKey: `ingestion-lead-assignment-upsert:${input.organizationId}:${input.ingestionJobId}`,
    payload: {
      schemaVersion: "v2.ingestion.lead-assignment-upsert-job.v1",
      ingestionJobId: input.ingestionJobId,
    },
    createdByUserId: input.createdByUserId ?? null,
  });
}

export async function enqueueActivityEventUpsertJob(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    createdByUserId?: string | null;
  }
): Promise<EnqueueV2JobResult> {
  return enqueueV2Job(db, {
    organizationId: input.organizationId,
    jobType: "ACTIVITY_EVENT_UPSERT",
    sourceType: "INGESTION_JOB",
    sourceId: input.ingestionJobId,
    idempotencyKey: `ingestion-activity-event-upsert:${input.organizationId}:${input.ingestionJobId}`,
    payload: {
      schemaVersion: "v2.ingestion.activity-event-upsert-job.v1",
      ingestionJobId: input.ingestionJobId,
    },
    createdByUserId: input.createdByUserId ?? null,
  });
}
