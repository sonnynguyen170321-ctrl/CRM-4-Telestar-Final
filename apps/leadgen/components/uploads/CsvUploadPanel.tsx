"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ClipboardCheck,
  Columns3,
  Database,
  FileSpreadsheet,
  RotateCcw,
  Upload,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/statusBadges";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ErrorBanner } from "@/components/shared/ErrorBanner";
import { LocalScoringPreview } from "@/components/uploads/LocalScoringPreview";
import {
  createCompanyRecordsForUpload,
  type CreateCompanyRecordsForUploadResult,
} from "@/lib/client/companyRecords";
import { createUploadJob } from "@/lib/client/uploadJobs";
import { parseCsvFile, type ParsedCsvResult } from "@/lib/csv";

const expectedCompanyHeaders = [
  "Company Name",
  "Website",
  "Company Country",
  "Company LinkedIn URL",
  "Company Industry",
  "Company Phone 1",
  "Company Staff Count Range",
  "Notes / Tags",
];

const expectedHeaderSet = new Set(
  expectedCompanyHeaders.map((header) => normalizeHeader(header))
);

type UploadJobPersistenceStatus = "idle" | "saving" | "saved" | "failed";
type CompanyRowsPersistenceStatus = "idle" | "saving" | "saved" | "failed";

export function CsvUploadPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [parsedCsv, setParsedCsv] = useState<ParsedCsvResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploadJobId, setUploadJobId] = useState<string | null>(null);
  const [uploadJobStatus, setUploadJobStatus] =
    useState<UploadJobPersistenceStatus>("idle");
  const [uploadJobError, setUploadJobError] = useState<string | null>(null);
  const [companyRowsStatus, setCompanyRowsStatus] =
    useState<CompanyRowsPersistenceStatus>("idle");
  const [savedCompanyRowsCount, setSavedCompanyRowsCount] = useState(0);
  const [companyRecordIdsByRowIndex, setCompanyRecordIdsByRowIndex] = useState<
    Record<number, string>
  >({});
  const [persistedSourceRowIndexes, setPersistedSourceRowIndexes] = useState<
    number[]
  >([]);
  const [duplicateRows, setDuplicateRows] = useState<
    CreateCompanyRecordsForUploadResult["duplicates"]
  >([]);
  const [companyRowsError, setCompanyRowsError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      setErrors(["No file selected."]);
      return;
    }

    setIsParsing(true);
    setErrors([]);
    setUploadJobId(null);
    setUploadJobStatus("idle");
    setUploadJobError(null);
    setCompanyRowsStatus("idle");
    setSavedCompanyRowsCount(0);
    setCompanyRecordIdsByRowIndex({});
    setPersistedSourceRowIndexes([]);
    setDuplicateRows([]);
    setCompanyRowsError(null);

    const result = await parseCsvFile(file);
    setParsedCsv(result);
    setErrors(result.errors);
    setIsParsing(false);

    if (result.errors.length > 0) {
      return;
    }

    setUploadJobStatus("saving");

    try {
      const uploadJob = await createUploadJob({
        fileName: result.fileName,
        totalRows: result.rowCount,
      });

      setUploadJobId(uploadJob.id);
      setUploadJobStatus("saved");
      setCompanyRowsStatus("saving");

      try {
        const savedCompanyRows = await createCompanyRecordsForUpload({
          uploadJobId: uploadJob.id,
          rows: result.rows,
        });

        setSavedCompanyRowsCount(savedCompanyRows.count);
        setCompanyRecordIdsByRowIndex(savedCompanyRows.idsBySourceRowIndex);
        setPersistedSourceRowIndexes(savedCompanyRows.persistedSourceRowIndexes);
        setDuplicateRows(savedCompanyRows.duplicates);
        setCompanyRowsStatus("saved");
      } catch (error) {
        setCompanyRowsError(
          error instanceof Error
            ? error.message
            : "Company row save failed."
        );
        setCompanyRowsStatus("failed");
      }
    } catch (error) {
      setUploadJobError(
        error instanceof Error
          ? error.message
          : "Upload metadata save failed."
      );
      setUploadJobStatus("failed");
    }
  }

  function clearFile() {
    setParsedCsv(null);
    setErrors([]);
    setUploadJobId(null);
    setUploadJobStatus("idle");
    setUploadJobError(null);
    setCompanyRowsStatus("idle");
    setSavedCompanyRowsCount(0);
    setCompanyRecordIdsByRowIndex({});
    setPersistedSourceRowIndexes([]);
    setDuplicateRows([]);
    setCompanyRowsError(null);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  const displayedHeaders = parsedCsv?.headers.slice(0, 8) ?? [];
  const hiddenHeaderCount = Math.max((parsedCsv?.headers.length ?? 0) - 8, 0);
  const compactUploadPicker = Boolean(parsedCsv);
  const parsedFileName = parsedCsv?.fileName ?? "Selected CSV";

  return (
    <div className="space-y-4 font-sans">
      <div
        className={
          compactUploadPicker
            ? "flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
            : "flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-blue-300 bg-white px-6 py-8 text-center shadow-sm"
        }
      >
        <div
          className={
            compactUploadPicker
              ? "flex items-center gap-3"
              : "flex flex-col items-center"
          }
        >
          <div
            className={
              compactUploadPicker
                ? "flex h-10 w-10 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700"
                : "flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-100 bg-blue-50 text-blue-700"
            }
          >
            <Upload className={compactUploadPicker ? "h-5 w-5" : "h-7 w-7"} />
          </div>
          <div className={compactUploadPicker ? "text-left" : "mt-4 text-center"}>
            <h2 className="text-base font-semibold text-slate-950">
              {compactUploadPicker
                ? "Replace company CSV"
                : "Drag and drop your CSV file here"}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
              {compactUploadPicker
                ? `${parsedFileName} is parsed locally and saved through the existing upload APIs.`
                : "Choose a company CSV to validate headers, save company rows, run research and scoring, and review companies."}
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
        />
        <div className={compactUploadPicker ? "flex flex-wrap gap-2" : "mt-4 flex flex-wrap justify-center gap-2"}>
          <Button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={isParsing}
            variant={compactUploadPicker ? "outline" : "default"}
            className={
              compactUploadPicker
                ? "h-9 rounded-lg bg-white"
                : "h-10 rounded-lg bg-blue-600 px-4 font-semibold text-white hover:bg-blue-700"
            }
          >
            <FileSpreadsheet className="h-4 w-4" />
            {isParsing ? "Parsing CSV" : "Choose CSV file"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={clearFile}
            disabled={!parsedCsv && errors.length === 0}
            className="h-9 rounded-lg bg-white"
          >
            <RotateCcw className="h-4 w-4" />
            Clear file
          </Button>
        </div>
      </div>

      {errors.length > 0 && (
        <ErrorBanner title="CSV parse issue" message={errors.join(" ")} />
      )}

      {parsedCsv && (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {parsedCsv.headers.length > 0 && (
              <CompactDetails
                icon={Columns3}
                title="Detected headers"
                badge={`${parsedCsv.headers.length.toLocaleString()} headers matched`}
                meta={`${parsedCsv.headers.length.toLocaleString()} headers detected`}
                defaultOpen={uploadJobStatus === "failed" || companyRowsStatus === "failed"}
              >
                <div className="flex flex-wrap gap-2">
                  {parsedCsv.headers.map((header) => {
                    const isCompanyMatch = expectedHeaderSet.has(
                      normalizeHeader(header)
                    );

                    return (
                      <Badge
                        key={header}
                        variant={isCompanyMatch ? "default" : "outline"}
                      >
                        {header}
                      </Badge>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  Highlighted headers exactly match expected company-first fields.
                  The column mapping preview below remains static until later
                  wiring.
                </p>
              </CompactDetails>
            )}

            {parsedCsv.previewRows.length > 0 && (
              <CompactDetails
                icon={FileSpreadsheet}
                title="Parsed CSV preview"
                badge={`Showing ${parsedCsv.previewRows.length.toLocaleString()} rows`}
                meta={`Showing ${parsedCsv.previewRows.length.toLocaleString()} preview rows from ${parsedCsv.fileName}`}
                defaultOpen={false}
              >
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {displayedHeaders.map((header) => (
                          <TableHead key={header}>{header}</TableHead>
                        ))}
                        {hiddenHeaderCount > 0 && (
                          <TableHead>+{hiddenHeaderCount} more</TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {parsedCsv.previewRows.map((row, index) => (
                        <TableRow key={index}>
                          {displayedHeaders.map((header) => (
                            <TableCell key={header} className="whitespace-nowrap">
                              {row[header]}
                            </TableCell>
                          ))}
                          {hiddenHeaderCount > 0 && (
                            <TableCell className="text-muted-foreground">
                              Hidden
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CompactDetails>
            )}

            <CompactDetails
              icon={ClipboardCheck}
              title="Saved metadata"
              badge={getUploadJobStatusBadge(uploadJobStatus)}
              meta={getUploadJobStatusMeta(uploadJobStatus, uploadJobId)}
              defaultOpen={uploadJobStatus === "failed"}
            >
              <UploadJobStatus
                status={uploadJobStatus}
                uploadJobId={uploadJobId}
                error={uploadJobError}
              />
            </CompactDetails>

            <CompactDetails
              icon={Database}
              title="Company rows saved"
              badge={getCompanyRowsStatusBadge(companyRowsStatus)}
              meta={getCompanyRowsStatusMeta({
                status: companyRowsStatus,
                totalCount: parsedCsv.rowCount,
                savedCount: savedCompanyRowsCount,
                duplicateCount: duplicateRows.length,
              })}
              defaultOpen={companyRowsStatus === "failed"}
            >
              <CompanyRowsStatus
                status={companyRowsStatus}
                totalCount={parsedCsv.rowCount}
                savedCount={savedCompanyRowsCount}
                duplicateCount={duplicateRows.length}
                duplicates={duplicateRows}
                error={companyRowsError}
              />
            </CompactDetails>
          </div>

          {parsedCsv.rows.length > 0 && (
            <div
              id="research-scoring"
              className="upload-review-workspace [&>div]:overflow-hidden [&>div]:rounded-2xl [&>div]:border-slate-200 [&>div]:bg-white [&>div]:shadow-sm [&>div>div:first-child]:hidden [&>div>div:nth-child(2)>div:first-child]:hidden [&>div>div:nth-child(2)]:space-y-4 [&_table]:font-sans [&_thead]:bg-slate-50 [&_th]:h-10 [&_th]:text-xs [&_th]:font-semibold [&_th]:text-slate-500 [&_td]:text-sm [&_tr]:border-slate-100"
            >
              <LocalScoringPreview
                rows={parsedCsv.rows}
                uploadJobId={uploadJobId}
                companyRecordIdsByRowIndex={companyRecordIdsByRowIndex}
                persistedSourceRowIndexes={persistedSourceRowIndexes}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UploadJobStatus({
  status,
  uploadJobId,
  error,
}: {
  status: UploadJobPersistenceStatus;
  uploadJobId: string | null;
  error: string | null;
}) {
  if (status === "idle") {
    return null;
  }

  const content = {
    saving: {
      label: "Saving upload metadata...",
      tone: "text-muted-foreground",
      badge: "Saving",
    },
    saved: {
      label: "Upload metadata saved",
      tone: "text-foreground",
      badge: "Saved",
    },
    failed: {
      label: "Upload metadata save failed - local scoring still works",
      tone: "text-destructive",
      badge: "Failed",
    },
  }[status];

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "failed" ? "destructive" : "secondary"}>
          {content.badge}
        </Badge>
        <p className={`text-sm font-medium ${content.tone}`}>
          {content.label}
        </p>
      </div>
      {uploadJobId && (
        <p className="mt-2 text-xs text-muted-foreground">
          Upload Job: {uploadJobId}
        </p>
      )}
      {status === "failed" && error && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{error}</p>
      )}
    </div>
  );
}

function CompanyRowsStatus({
  status,
  totalCount,
  savedCount,
  duplicateCount,
  duplicates,
  error,
}: {
  status: CompanyRowsPersistenceStatus;
  totalCount: number;
  savedCount: number;
  duplicateCount: number;
  duplicates: CreateCompanyRecordsForUploadResult["duplicates"];
  error: string | null;
}) {
  if (status === "idle") {
    return null;
  }

  const content = {
    saving: {
      label: "Saving company rows...",
      tone: "text-muted-foreground",
      badge: "Saving",
    },
    saved: {
      label: "Company rows saved",
      tone: "text-foreground",
      badge: "Saved",
    },
    failed: {
      label: "Company row save failed - local scoring still works",
      tone: "text-destructive",
      badge: "Failed",
    },
  }[status];

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status === "failed" ? "destructive" : "secondary"}>
          {content.badge}
        </Badge>
        <p className={`text-sm font-medium ${content.tone}`}>
          {content.label}
        </p>
      </div>
      {status === "saved" && (
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          <p>
            Total CSV rows: {totalCount.toLocaleString()} | Unique company rows
            saved: {savedCount.toLocaleString()} | Duplicate rows skipped:{" "}
            {duplicateCount.toLocaleString()}
          </p>
          {duplicates.length > 0 && (
            <div className="rounded-md border bg-muted/30 p-2">
              <p className="font-medium text-foreground">Duplicate summary</p>
              <ul className="mt-1 space-y-1">
                {duplicates.slice(0, 5).map((duplicate) => (
                  <li
                    key={`${duplicate.duplicateKey}-${duplicate.sourceRowIndex}`}
                  >
                    {duplicate.companyName} skipped at row{" "}
                    {duplicate.sourceRowIndex + 1}; matched{" "}
                    {duplicate.duplicateKey} kept from row{" "}
                    {duplicate.keptRowIndex + 1}.
                  </li>
                ))}
              </ul>
              {duplicates.length > 5 && (
                <p className="mt-1">
                  +{(duplicates.length - 5).toLocaleString()} more duplicates.
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {status === "failed" && error && (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">{error}</p>
      )}
    </div>
  );
}

function CompactDetails({
  icon: Icon,
  title,
  badge,
  meta,
  children,
  defaultOpen,
}: {
  icon: typeof FileSpreadsheet;
  title: string;
  badge: string;
  meta: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group border-b border-slate-200 last:border-b-0"
      open={defaultOpen}
    >
      <summary className="grid cursor-pointer list-none grid-cols-[32px_minmax(150px,1fr)_auto_minmax(180px,1.4fr)_20px] items-center gap-3 px-4 py-3 transition-colors hover:bg-slate-50">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <StatusBadge tone="info">{badge}</StatusBadge>
        <p className="truncate text-xs text-slate-500">{meta}</p>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-slate-200 bg-slate-50/40 px-4 py-3">
        {children}
      </div>
    </details>
  );
}

function getUploadJobStatusBadge(status: UploadJobPersistenceStatus) {
  if (status === "saved") return "Metadata saved";
  if (status === "saving") return "Saving";
  if (status === "failed") return "Failed";

  return "Pending";
}

function getUploadJobStatusMeta(
  status: UploadJobPersistenceStatus,
  uploadJobId: string | null
) {
  if (uploadJobId) return `Upload ID: ${uploadJobId}`;
  if (status === "failed") return "Upload metadata could not be saved.";

  return "Waiting for upload metadata.";
}

function getCompanyRowsStatusBadge(status: CompanyRowsPersistenceStatus) {
  if (status === "saved") return "Rows saved";
  if (status === "saving") return "Saving";
  if (status === "failed") return "Failed";

  return "Pending";
}

function getCompanyRowsStatusMeta({
  status,
  totalCount,
  savedCount,
  duplicateCount,
}: {
  status: CompanyRowsPersistenceStatus;
  totalCount: number;
  savedCount: number;
  duplicateCount: number;
}) {
  if (status === "saved") {
    return `${savedCount.toLocaleString()} unique rows saved / ${duplicateCount.toLocaleString()} duplicates skipped`;
  }

  if (status === "failed") {
    return "Company rows could not be saved.";
  }

  if (status === "saving") {
    return `Saving ${totalCount.toLocaleString()} parsed rows.`;
  }

  return `${totalCount.toLocaleString()} parsed rows ready.`;
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase();
}
