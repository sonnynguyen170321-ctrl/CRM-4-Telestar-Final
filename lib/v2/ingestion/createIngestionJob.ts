import { enqueueIngestionParseJob } from "./enqueueIngestionJobs";
import {
  V2IngestionMappingContextSchema,
  type V2CsvIngestionInput,
  type V2IngestionDatabase,
  type V2IngestionMappingContext,
} from "./types";

export async function createIngestionJob(
  db: V2IngestionDatabase,
  input: V2CsvIngestionInput
) {
  const mappingContext: V2IngestionMappingContext =
    V2IngestionMappingContextSchema.parse({
      schemaVersion: "v2.ingestion.mapping.v1",
      runMode: input.runMode ?? "auto_after_parse",
      projectId: input.projectId ?? null,
      icpVersionId: input.icpVersionId ?? null,
      originalFileName: input.originalFileName,
      importProfileSuggestion: input.importProfileSuggestion ?? "unknown_mixed",
      importProfileConfidence: "low",
      spreadsheetIntake: input.spreadsheetIntake,
      uploadIntake:
        input.clientRequestId &&
        input.sourceFileStorageKey &&
        input.fileHash &&
        input.headerHash
          ? {
              schemaVersion: "v2.ingestion.upload-intake.v1",
              clientRequestId: input.clientRequestId,
              sourceFileStorageKey: input.sourceFileStorageKey,
              fileHash: input.fileHash,
              headerHash: input.headerHash,
              headers: input.headers ?? [],
              previewRows: input.previewRows ?? [],
              fileSizeBytes: input.fileSizeBytes ?? input.csvText.length,
            }
          : undefined,
      notes: ["INGEST-HV0 stores typed mapping context only; no business state."],
    });
  const createdRows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "V2IngestionJob" (
      "id",
      "organizationId",
      "projectId",
      "uploadedByUserId",
      "jobType",
      "status",
      "originalFileName",
      "sourceFileStorageKey",
      "mappingJson",
      "rowCountsJson",
      "errorSummaryJson",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${createIngestionJobId()},
      ${input.organizationId},
      ${input.projectId ?? null},
      ${input.uploadedByUserId ?? null},
      ${toJobType(input.importProfileSuggestion)}::"V2IngestionJobType",
      'PENDING',
      ${input.originalFileName},
      ${input.sourceFileStorageKey ?? null},
      ${JSON.stringify(mappingContext)}::jsonb,
      ${JSON.stringify({})}::jsonb,
      ${JSON.stringify({})}::jsonb,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING "id"
  `;
  const ingestionJobId = createdRows[0].id;
  const enqueueResult = await enqueueIngestionParseJob(db, {
    organizationId: input.organizationId,
    ingestionJobId,
    csvText: input.csvText,
    originalFileName: input.originalFileName,
    createdByUserId: input.uploadedByUserId ?? null,
  });

  return { ingestionJobId, enqueueResult };
}

function toJobType(importProfile: string | undefined) {
  if (importProfile === "contact_upload") {
    return "CONTACT_UPLOAD";
  }

  if (
    importProfile === "activity_event" ||
    importProfile === "wide_activity_bundle" ||
    importProfile === "meeting_tracker"
  ) {
    return "ACTIVITY_RECAP";
  }

  return "COMPANY_UPLOAD";
}

function createIngestionJobId() {
  return `ing_job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
