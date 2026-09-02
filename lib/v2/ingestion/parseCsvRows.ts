import Papa from "papaparse";
import { computeSourceRowHash, normalizeHeaderName } from "./hash";
import {
  DEFAULT_CSV_CHUNK_SIZE,
  DEFAULT_MAX_CSV_ROWS,
  type V2ParsedCsvRow,
  type V2ParseCsvRowsInput,
  type V2ParseCsvRowsResult,
} from "./types";

export async function parseCsvRows(
  input: V2ParseCsvRowsInput
): Promise<V2ParseCsvRowsResult> {
  const chunkSize = input.chunkSize ?? DEFAULT_CSV_CHUNK_SIZE;
  const maxRows = input.maxRows ?? DEFAULT_MAX_CSV_ROWS;
  let headers: string[] | null = null;
  let totalRows = 0;
  let blankRows = 0;
  let parseErrors = 0;
  let maxRowsExceeded = false;
  let bufferedRows: V2ParsedCsvRow[] = [];
  let pendingWrite = Promise.resolve();

  const flushRows = async () => {
    if (bufferedRows.length === 0) {
      return;
    }

    const rows = bufferedRows;
    bufferedRows = [];
    await input.onRows(rows);
  };

  await new Promise<void>((resolve, reject) => {
    type StepResult = {
      data: string[];
      errors: Array<{ message: string }>;
    };
    type ParserControl = {
      pause: () => void;
      resume: () => void;
      abort: () => void;
    };
    const parseString = Papa.parse as unknown as (
      csvText: string,
      config: Record<string, unknown>
    ) => void;

    parseString(stripBom(input.csvText), {
      delimiter: "",
      skipEmptyLines: false,
      worker: false,
      step: (result: StepResult, parser: ParserControl) => {
        parser.pause();

        pendingWrite = pendingWrite
          .then(async () => {
            if (maxRowsExceeded) {
              return;
            }

            const row = Array.isArray(result.data) ? result.data : [];

            if (!headers) {
              headers = normalizeHeaders(row);
              parser.resume();
              return;
            }

            if (isBlankRow(row)) {
              blankRows += 1;
              parser.resume();
              return;
            }

            totalRows += 1;

            if (totalRows > maxRows) {
              maxRowsExceeded = true;
              parser.abort();
              return;
            }

            const safeHeaders = headers;
            const values = safeHeaders.map((_, index) => normalizeCell(row[index]));
            const parseErrorMessages = result.errors.map((error) => error.message);
            parseErrors += parseErrorMessages.length;
            bufferedRows.push({
              sourceRowNumber: totalRows + 1,
              headers: safeHeaders,
              values,
              rawRowJson: toRawRowJson(safeHeaders, values),
              sourceRowHash: computeSourceRowHash({
                headers: safeHeaders,
                values,
              }),
              parseErrors: parseErrorMessages,
            });

            if (bufferedRows.length >= chunkSize) {
              await flushRows();
            }

            parser.resume();
          })
          .catch(reject);
      },
      complete: () => {
        pendingWrite.then(flushRows).then(resolve).catch(reject);
      },
      error: (error: Error) => reject(error),
    });
  });

  return {
    headers: headers ?? [],
    totalRows,
    blankRows,
    parseErrors,
    maxRowsExceeded,
  };
}

function stripBom(value: string) {
  return value.replace(/^\uFEFF/, "");
}

function normalizeHeaders(row: string[]) {
  const seen = new Map<string, number>();

  return row.map((header, index) => {
    const base = normalizeHeaderName(header) || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);

    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function isBlankRow(row: unknown[]) {
  return row.every((value) => normalizeCell(value) === "");
}

function toRawRowJson(headers: string[], values: string[]) {
  return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
}
