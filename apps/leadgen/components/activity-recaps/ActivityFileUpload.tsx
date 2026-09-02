"use client";

import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { parseActivityFile } from "@/lib/activityRecaps/parseActivityFile";
import type { ParsedActivityFile } from "@/lib/activityRecaps/types";

type ActivityFileUploadProps = {
  parsedFile: ParsedActivityFile | null;
  onParsedFile: (parsedFile: ParsedActivityFile) => void;
  onError: (message: string) => void;
};

export function ActivityFileUpload({
  parsedFile,
  onParsedFile,
  onError,
}: ActivityFileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isParsing, setIsParsing] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsParsing(true);
    try {
      const parsed = await parseActivityFile(file);
      onParsedFile(parsed);
    } catch (error) {
      onError(error instanceof Error ? error.message : "File parsing failed.");
    } finally {
      setIsParsing(false);
    }
  }

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardContent className="space-y-4">
        <div
          className="flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/70 px-4 py-8 text-center transition-colors hover:bg-blue-50/50"
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void handleFile(event.dataTransfer.files[0]);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              inputRef.current?.click();
            }
          }}
        >
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept=".csv,.xlsx"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700">
            <UploadCloud className="h-6 w-6" aria-hidden="true" />
          </div>
          <div className="mt-3 text-sm font-semibold text-slate-900">
            Drop SDR CSV/XLSX file here
          </div>
          <p className="mt-1 max-w-md text-xs leading-5 text-slate-500">
            Activity recaps are parsed locally in this Step 37.1 preview. No
            database save, CRM matching, export, or AI processing runs here.
          </p>
          <Button className="mt-4 bg-blue-600 text-white hover:bg-blue-700" disabled={isParsing}>
            {isParsing ? "Parsing..." : "Choose file"}
          </Button>
        </div>

        {parsedFile ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {parsedFile.fileName}
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{parsedFile.rowCount.toLocaleString()} rows</span>
                  <span>{parsedFile.headers.length.toLocaleString()} columns</span>
                  <span>{parsedFile.fileType.toUpperCase()}</span>
                  {parsedFile.sheetName ? <span>Sheet: {parsedFile.sheetName}</span> : null}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {parsedFile.headers.slice(0, 18).map((header) => (
                <span
                  key={header}
                  className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600"
                >
                  {header}
                </span>
              ))}
              {parsedFile.headers.length > 18 ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-500">
                  +{parsedFile.headers.length - 18} more
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

