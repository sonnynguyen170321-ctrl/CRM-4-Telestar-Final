import { toJsonbParam, sanitizeNullableText } from "../persistence/jsonbSanitizer";
import {
  DEFAULT_DB_BATCH_SIZE,
  type V2IngestionDatabase,
  type V2ParsedCsvRow,
  type V2PersistRowsResult,
} from "./types";

export async function persistIngestionRows(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    jobId: string;
    rows: V2ParsedCsvRow[];
    batchSize?: number;
  }
): Promise<V2PersistRowsResult> {
  const batchSize = input.batchSize ?? DEFAULT_DB_BATCH_SIZE;
  let insertedRows = 0;
  let errorRows = 0;

  for (let index = 0; index < input.rows.length; index += batchSize) {
    const batch = input.rows.slice(index, index + batchSize);

    await db.$transaction(async (tx) => {
      for (const row of batch) {
        const rowStatus = row.parseErrors.length > 0 ? "ERROR" : "RAW";
        const inserted = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO "V2IngestionRow" (
            "id",
            "jobId",
            "organizationId",
            "sourceRowNumber",
            "sourceRowHash",
            "rawRowJson",
            "rowStatus",
            "validationErrorsJson",
            "errorMessage",
            "createdAt"
          )
          VALUES (
            ${createRowId()},
            ${input.jobId},
            ${input.organizationId},
            ${row.sourceRowNumber},
            ${row.sourceRowHash},
            ${toJsonbParam(row.rawRowJson)}::jsonb,
            ${rowStatus}::"V2IngestionRowStatus",
            ${toJsonbParam(row.parseErrors)}::jsonb,
            ${sanitizeNullableText(row.parseErrors[0] ?? null)},
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("jobId", "sourceRowHash") DO NOTHING
          RETURNING "id"
        `;

        if (inserted.length > 0) {
          insertedRows += 1;

          if (rowStatus === "ERROR") {
            errorRows += 1;
          }
        }
      }
    });
  }

  return {
    attemptedRows: input.rows.length,
    insertedRows,
    duplicateRows: input.rows.length - insertedRows,
    errorRows,
  };
}

function createRowId() {
  return `ing_row_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
