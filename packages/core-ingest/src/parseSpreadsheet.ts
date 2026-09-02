import "server-only";

import * as XLSX from "xlsx";

import { sanitizeDisplayHeaders } from "./headers";

// V2-native spreadsheet intake. INGEST-HV0 supported CSV only; the activity-recap wizard
// needs multi-sheet Excel with header-row auto-detection (mock: "Auto-Detected Sheet &
// Headers", header "Row 2"). This re-implements parsing in the V2 namespace using the
// `xlsx` package directly — it does NOT import V1 `lib/activityRecaps/parseActivityFile`
// (V2 invariant #1: build V2's own runtime). The output funnels into the existing CSV
// pipeline: a chosen sheet + header row is rendered to canonical CSV text, so
// parseCsvRows / persistIngestionRows / the whole stage chain stay unchanged.

const PREVIEW_ROW_LIMIT = 5;
const HEADER_SCAN_LIMIT = 15;

export type SpreadsheetSheetInfo = {
  name: string;
  rowCount: number;
  columnCount: number;
};

export type SpreadsheetDetection = {
  sheets: SpreadsheetSheetInfo[];
  selectedSheet: string;
  /** 0-based index of the detected header row within the selected sheet. */
  headerRow: number;
  headers: string[];
  previewRows: Array<Record<string, string>>;
};

export type SpreadsheetExtraction = {
  selectedSheet: string;
  headerRow: number;
  headers: string[];
  csvText: string;
};

const SPREADSHEET_EXTENSIONS = [".xlsx", ".xls", ".xlsm"];

export function isSpreadsheetFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return SPREADSHEET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isSpreadsheetMimeType(mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.ms-excel.sheet.macroEnabled.12"
  );
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function readSheetMatrix(sheet: XLSX.WorkSheet): string[][] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: "",
  });
  return matrix.map((row) => (Array.isArray(row) ? row.map(stringifyCell) : []));
}

/**
 * Best-guess header row: within the first rows, the one with the most non-empty cells
 * (earliest wins ties). This skips title/blank lead rows (mock: a title on row 1, the
 * real headers on row 2) without hard-coding an offset.
 */
export function detectHeaderRowIndex(matrix: string[][]): number {
  let bestIndex = 0;
  let bestNonEmpty = -1;
  const scanLimit = Math.min(matrix.length, HEADER_SCAN_LIMIT);
  for (let index = 0; index < scanLimit; index += 1) {
    const nonEmpty = matrix[index].filter((cell) => cell !== "").length;
    if (nonEmpty > bestNonEmpty) {
      bestNonEmpty = nonEmpty;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Trim trailing all-empty header columns (reduces noise from sparse Excel exports), then
 *  sanitize the rest: blank middle cells become "Column N" and duplicate names get a
 *  "(2)" suffix so messy multi-column exports never bounce downstream. */
function normalizeHeaders(rawHeaders: string[]): string[] {
  const headers = rawHeaders.map((header) => header.trim());
  while (headers.length > 0 && headers[headers.length - 1] === "") {
    headers.pop();
  }
  return sanitizeDisplayHeaders(headers);
}

function buildPreviewRows(
  matrix: string[][],
  headerRow: number,
  headers: string[]
): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  for (
    let index = headerRow + 1;
    index < matrix.length && rows.length < PREVIEW_ROW_LIMIT;
    index += 1
  ) {
    const values = matrix[index];
    if (values.every((cell) => cell === "")) continue;
    const row: Record<string, string> = {};
    headers.forEach((header, column) => {
      if (header) row[header] = values[column] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/** Pick the sheet with the most populated rows (the recap data, not an empty tab). */
function pickDefaultSheet(workbook: XLSX.WorkBook): string {
  let selected = workbook.SheetNames[0] ?? "";
  let bestRows = -1;
  for (const name of workbook.SheetNames) {
    const matrix = readSheetMatrix(workbook.Sheets[name]);
    if (matrix.length > bestRows) {
      bestRows = matrix.length;
      selected = name;
    }
  }
  return selected;
}

export function readWorkbook(buffer: Buffer | ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "buffer", cellDates: true });
}

/** Step-2 detection payload for the wizard: sheets + the auto-picked sheet/header/headers. */
export function detectSpreadsheet(
  buffer: Buffer | ArrayBuffer,
  preferredSheet?: string | null
): SpreadsheetDetection {
  const workbook = readWorkbook(buffer);
  if (workbook.SheetNames.length === 0) {
    throw new SpreadsheetError("SPREADSHEET_NO_SHEETS", "Workbook has no worksheets.");
  }

  const sheets: SpreadsheetSheetInfo[] = workbook.SheetNames.map((name) => {
    const matrix = readSheetMatrix(workbook.Sheets[name]);
    const columnCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    return { name, rowCount: matrix.length, columnCount };
  });

  const selectedSheet =
    preferredSheet && workbook.SheetNames.includes(preferredSheet)
      ? preferredSheet
      : pickDefaultSheet(workbook);
  const matrix = readSheetMatrix(workbook.Sheets[selectedSheet]);
  const headerRow = detectHeaderRowIndex(matrix);
  const headers = normalizeHeaders(matrix[headerRow] ?? []);
  const previewRows = buildPreviewRows(matrix, headerRow, headers);

  return { sheets, selectedSheet, headerRow, headers, previewRows };
}

/** Render a chosen sheet + header row to canonical CSV so it feeds the existing pipeline. */
export function extractSheetToCsv(
  buffer: Buffer | ArrayBuffer,
  input: { selectedSheet: string; headerRow: number }
): SpreadsheetExtraction {
  const workbook = readWorkbook(buffer);
  if (!workbook.SheetNames.includes(input.selectedSheet)) {
    throw new SpreadsheetError(
      "SPREADSHEET_SHEET_NOT_FOUND",
      `Worksheet "${input.selectedSheet}" was not found in the workbook.`
    );
  }
  const matrix = readSheetMatrix(workbook.Sheets[input.selectedSheet]);
  const headerRow = Math.min(Math.max(input.headerRow, 0), Math.max(matrix.length - 1, 0));
  const headers = normalizeHeaders(matrix[headerRow] ?? []);

  if (headers.length === 0) {
    throw new SpreadsheetError(
      "SPREADSHEET_NO_HEADERS",
      "Selected header row has no column names."
    );
  }

  const lines: string[] = [csvLine(headers)];
  for (let index = headerRow + 1; index < matrix.length; index += 1) {
    const values = matrix[index];
    if (values.every((cell) => cell === "")) continue;
    // Pad/trim each data row to the header width so columns stay aligned.
    const row = headers.map((_, column) => values[column] ?? "");
    lines.push(csvLine(row));
  }

  return {
    selectedSheet: input.selectedSheet,
    headerRow,
    headers,
    csvText: lines.join("\n"),
  };
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export class SpreadsheetError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "SpreadsheetError";
  }
}
