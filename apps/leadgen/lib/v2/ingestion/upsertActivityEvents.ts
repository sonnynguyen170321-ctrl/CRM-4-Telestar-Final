import "server-only";

import { createNonRetryableJobError } from "../jobs/errors";
import { enqueueActivityApplyJob } from "../activity-recaps/enqueueActivityApplyJob";
import { expandActivityRowsFromRawRow } from "../activity-recaps/normalizeActivityRow";
import type { V2JobHandler } from "../jobs/types";
import type { V2IngestionDatabase } from "./types";
import { DEFAULT_DB_BATCH_SIZE } from "./types";
import type { ImportRowKind } from "../activity-recaps/types";

type IngestionJobRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  uploadedByUserId: string | null;
  mappingJson: unknown;
};

type IngestionRowRecord = {
  id: string;
  sourceRowNumber: number;
  rawRowJson: unknown;
};

export const activityEventUpsertIngestionJobHandler: V2JobHandler = async (context) => {
  const payload = context.payload as { ingestionJobId?: string };
  const ingestionJobId = context.job.sourceId ?? payload.ingestionJobId;

  if (!ingestionJobId) {
    throw createNonRetryableJobError(
      "INVALID_ACTIVITY_EVENT_UPSERT_PAYLOAD",
      "ACTIVITY_EVENT_UPSERT payload missing ingestionJobId."
    );
  }

  const ingestionJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });

  const importProfile = (ingestionJob.mappingJson as { importProfile?: ImportRowKind } | null)?.importProfile as ImportRowKind;
  if (!importProfile) {
    throw createNonRetryableJobError(
      "MISSING_IMPORT_PROFILE",
      "Ingestion job mapping missing importProfile."
    );
  }

  if (importProfile !== "activity_event" && importProfile !== "wide_activity_bundle" && importProfile !== "meeting_tracker") {
    // Nothing to do for profiles that don't have activities
    return {
      resultSnapshotJson: {
        ingestionJobId,
        message: "No activities to upsert for this profile.",
      },
      progressCurrent: 1,
      progressTotal: 1,
    };
  }

  let processedRows = 0;
  let applyEventsEnqueued = 0;
  const stoppedEarly = false;
  let offset = 0;

  while (!stoppedEarly) {
    const rows = await context.db.$queryRaw<IngestionRowRecord[]>`
      SELECT "id", "sourceRowNumber", "rawRowJson"
      FROM "V2IngestionRow"
      WHERE "organizationId" = ${context.organizationId}
        AND "jobId" = ${ingestionJobId}
        AND "rowStatus" IN ('MATCHED', 'NORMALIZED', 'APPLIED')
      ORDER BY "sourceRowNumber" ASC
      LIMIT ${DEFAULT_DB_BATCH_SIZE}
      OFFSET ${offset}
    `;

    if (rows.length === 0) {
      break;
    }

    const activityRows = [];

    for (const row of rows) {
      const expansion = expandActivityRowsFromRawRow({
        rawRow: row.rawRowJson as Record<string, unknown>,
        sourceRowNumber: row.sourceRowNumber,
        importRowKind: importProfile,
      });

      for (const event of expansion.events) {
        activityRows.push({
          row: event.row,
          eventIndexWithinRow: event.eventIndexWithinRow,
          timestampQuality: event.timestampQuality,
        });
      }

      processedRows += 1;
    }

    if (activityRows.length > 0) {
      await enqueueActivityApplyJob(context.db, {
        organizationId: context.organizationId,
        rows: activityRows,
        ingestionJobId,
        createdByUserId: ingestionJob.uploadedByUserId,
        source: { sourceType: "INGESTION_JOB", sourceId: ingestionJobId },
      });
      applyEventsEnqueued += activityRows.length;
    }

    offset += DEFAULT_DB_BATCH_SIZE;
    await context.updateProgress({ current: processedRows });
  }

  return {
    resultSnapshotJson: {
      ingestionJobId,
      processedRows,
      applyEventsEnqueued,
    },
    progressCurrent: processedRows,
    progressTotal: processedRows || 1,
  };
};

async function loadIngestionJob(
  db: V2IngestionDatabase,
  input: { organizationId: string; ingestionJobId: string }
) {
  const rows = await db.$queryRaw<IngestionJobRecord[]>`
    SELECT "id", "organizationId", "uploadedByUserId", "mappingJson"
    FROM "V2IngestionJob"
    WHERE "id" = ${input.ingestionJobId}
      AND "organizationId" = ${input.organizationId}
    LIMIT 1
  `;

  if (!rows[0]) {
    throw createNonRetryableJobError(
      "INGESTION_JOB_NOT_FOUND",
      "V2 ingestion job was not found for ACTIVITY_EVENT_UPSERT."
    );
  }

  return rows[0];
}
