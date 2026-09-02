"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";

import { Button } from "@/components/ui/button";

const PREVIEW_ROW_LIMIT = 5;

export type CsvPreview = {
  file: File;
  clientRequestId: string;
  headers: string[];
  previewRows: Array<Record<string, string>>;
};

type FileDropzoneProps = {
  disabled?: boolean;
  onUpload: (preview: CsvPreview) => void;
};

export function FileDropzone({ disabled, onUpload }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    setError(null);

    if (!file) {
      return;
    }

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Only CSV files are supported.");
      return;
    }

    const text = stripBom(await file.text());
    const rows = text
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== "");
    const headers = rows[0] ? splitCsvLine(rows[0]).map((header) => header.trim()) : [];

    if (headers.length === 0) {
      setError("CSV headers could not be parsed.");
      return;
    }

    if (headers.some((header) => header === "")) {
      setError("CSV contains a blank header.");
      return;
    }

    const normalized = new Set<string>();

    for (const header of headers) {
      const key = header.toLowerCase();

      if (normalized.has(key)) {
        setError("CSV headers must be unique.");
        return;
      }

      normalized.add(key);
    }

    if (rows.length <= 1) {
      setError("CSV contains no data rows.");
      return;
    }

    setFileName(file.name);
    onUpload({
      file,
      clientRequestId: crypto.randomUUID(),
      headers,
      previewRows: rows.slice(1, PREVIEW_ROW_LIMIT + 1).map((line) => {
        const values = splitCsvLine(line);
        const previewRow: Record<string, string> = {};

        for (let index = 0; index < headers.length; index += 1) {
          previewRow[headers[index]] = values[index] ?? "";
        }

        return previewRow;
      }),
    });
  }

  return (
    <div className="rounded-lg border border-border bg-white p-5">
      <div
        className="rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center"
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          void handleFile(event.dataTransfer.files[0]);
        }}
      >
        <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
        <div className="mt-3 text-sm font-semibold text-foreground">
          Drop a CSV file here
        </div>
        <p className="mt-1 text-sm text-muted-foreground">One CSV file per ingestion job.</p>
        <div className="mt-4">
          <Button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Choose CSV
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
            }}
          />
        </div>
      </div>
      {fileName ? (
        <div className="mt-3 text-sm text-muted-foreground">Selected: {fileName}</div>
      ) : null}
      {error ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}
