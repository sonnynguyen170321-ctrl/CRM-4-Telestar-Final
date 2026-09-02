import Papa from "papaparse";

export type ParsedCsvRow = Record<string, string>;

export type ParsedCsvResult = {
  fileName: string;
  headers: string[];
  rows: ParsedCsvRow[];
  previewRows: ParsedCsvRow[];
  rowCount: number;
  errors: string[];
};

type RawCsvRow = Record<string, unknown>;

export function parseCsvFile(file: File): Promise<ParsedCsvResult> {
  return new Promise((resolve) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      resolve(emptyResult(file.name, ["File must use a .csv extension."]));
      return;
    }

    if (file.size === 0) {
      resolve(emptyResult(file.name, ["CSV file is empty."]));
      return;
    }

    Papa.parse<RawCsvRow>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        const headers = normalizeHeaders(results.meta.fields ?? []);
        const rows = normalizeRows(results.data, headers);
        const errors = results.errors.map((error) => error.message);

        if (headers.length === 0) {
          errors.push("CSV has no detected headers.");
        }

        if (rows.length === 0) {
          errors.push("CSV has no data rows.");
        }

        resolve({
          fileName: file.name,
          headers,
          rows,
          previewRows: rows.slice(0, 5),
          rowCount: rows.length,
          errors,
        });
      },
      error: (error) => {
        resolve(emptyResult(file.name, [error.message]));
      },
    });
  });
}

function emptyResult(fileName: string, errors: string[]): ParsedCsvResult {
  return {
    fileName,
    headers: [],
    rows: [],
    previewRows: [],
    rowCount: 0,
    errors,
  };
}

function normalizeHeaders(headers: string[]) {
  const seen = new Set<string>();

  return headers
    .map((header) => header.trim())
    .filter((header) => {
      if (header.length === 0 || seen.has(header)) {
        return false;
      }

      seen.add(header);
      return true;
    });
}

function normalizeRows(rows: RawCsvRow[], headers: string[]): ParsedCsvRow[] {
  return rows
    .map((row) => normalizeRow(row, headers))
    .filter((row) =>
      Object.values(row).some((value) => value.trim().length > 0)
    );
}

function normalizeRow(row: RawCsvRow, headers: string[]): ParsedCsvRow {
  return headers.reduce<ParsedCsvRow>((normalized, header) => {
    normalized[header] = stringifyCell(row[header]);
    return normalized;
  }, {});
}

function stringifyCell(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}
