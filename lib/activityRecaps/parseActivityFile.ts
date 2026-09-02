import Papa from "papaparse";
import * as XLSX from "xlsx";

import type { ParsedActivityFile } from "@/lib/activityRecaps/types";

type CellValue = string | number | boolean | Date | null | undefined;

export async function parseActivityFile(file: File): Promise<ParsedActivityFile> {
  const extension = file.name.toLowerCase().split(".").pop();

  if (extension === "csv") {
    return parseCsvActivityFile(file);
  }

  if (extension === "xlsx") {
    return parseXlsxActivityFile(file);
  }

  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
}

async function parseCsvActivityFile(file: File): Promise<ParsedActivityFile> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(file, {
      skipEmptyLines: "greedy",
      complete: (result) => {
        const matrix = result.data.map((row) => row.map(stringifyCell));
        const parsed = parseMatrix(matrix, file.name, "csv", file.size);

        if (parsed.headers.length === 0) {
          reject(new Error("CSV has no detected headers."));
          return;
        }

        resolve(parsed);
      },
      error: (error) => reject(new Error(error.message)),
    });
  });
}

async function parseXlsxActivityFile(file: File): Promise<ParsedActivityFile> {
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error("XLSX file does not contain a worksheet.");
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });

  const parsed = parseMatrix(matrix, file.name, "xlsx", file.size, sheetName);

  if (parsed.headers.length === 0) {
    throw new Error("XLSX sheet has no detected headers.");
  }

  return parsed;
}

function parseMatrix(
  matrix: CellValue[][],
  fileName: string,
  fileType: "csv" | "xlsx",
  fileSize?: number,
  sheetName?: string
): ParsedActivityFile {
  const firstHeaderIndex = matrix.findIndex((row) =>
    row.some((cell) => stringifyCell(cell).length > 0)
  );

  if (firstHeaderIndex < 0) {
    return {
      fileName,
      fileType,
      fileSize,
      headers: [],
      rows: [],
      rowCount: 0,
      sheetName,
    };
  }

  const headers = normalizeHeaders(matrix[firstHeaderIndex].map(stringifyCell));
  const rows = matrix
    .slice(firstHeaderIndex + 1)
    .map((row) => normalizeRow(row, headers))
    .filter((row) => Object.values(row).some((value) => value.length > 0));

  return {
    fileName,
    fileType,
    fileSize,
    headers,
    rows,
    rowCount: rows.length,
    sheetName,
  };
}

function normalizeHeaders(headers: string[]) {
  const seen = new Map<string, number>();

  return headers
    .map((header) => header.trim())
    .filter(Boolean)
    .map((header) => {
      const existingCount = seen.get(header) ?? 0;
      seen.set(header, existingCount + 1);

      if (existingCount === 0) {
        return header;
      }

      return `${header} (${existingCount + 1})`;
    });
}

function normalizeRow(row: CellValue[], headers: string[]) {
  return headers.reduce<Record<string, string>>((normalized, header, index) => {
    normalized[header] = stringifyCell(row[index]);
    return normalized;
  }, {});
}

function stringifyCell(value: CellValue) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}
