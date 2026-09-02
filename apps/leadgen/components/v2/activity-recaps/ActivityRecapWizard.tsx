"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { formatCount } from "@/lib/v2/format/datetime";
import {
  ArrowRight,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MappingTable, type CanonicalMappingFields } from "@/components/v2/uploads/MappingTable";

// Premium activity-recap upload wizard (mock parity): Upload -> Auto-Detected Sheet &
// Headers -> Field Mapping -> Done. It reuses the shared ingestion runtime: the upload
// POSTs to /v2/ingestion as jobType=ACTIVITY_RECAP. Excel uploads return a detect payload
// (sheets + header row) before a job is created; the user confirms the sheet/header, then
// maps fields, then the V2Job chain (now on BullMQ) takes over.

type SheetInfo = { name: string; rowCount: number; columnCount?: number };

type Detection = {
  sheets: SheetInfo[];
  selectedSheet: string;
  headerRow: number;
  headers: string[];
  previewRows: Array<Record<string, string>>;
};

type UploadResult = {
  ingestionJobId: string;
  headers: string[];
  previewRows: Array<Record<string, string>>;
};

type WizardState =
  | { step: "upload" }
  | { step: "uploading" }
  | { step: "detect"; detection: Detection }
  | { step: "mapping"; upload: UploadResult }
  | { step: "submitting" }
  | { step: "queued"; ingestionJobId: string }
  | { step: "error"; message: string };

type WizardContext = {
  clientAccountId?: string;
  projectId?: string;
  icpVersionId?: string;
};

const STEPS = ["Upload Activity File", "Confirm Sheet & Mapping", "Create Review Queue"];

export function ActivityRecapWizard({ context }: { context: WizardContext }) {
  const [state, setState] = useState<WizardState>({ step: "upload" });
  const fileRef = useRef<File | null>(null);
  const requestIdRef = useRef<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const hasContext = Boolean(context.clientAccountId && context.projectId && context.icpVersionId);
  const activeStep = stepIndex(state.step);

  function buildFormData(extra?: { selectedSheet?: string; headerRow?: number }) {
    const formData = new FormData();
    if (fileRef.current) formData.set("file", fileRef.current);
    formData.set("clientRequestId", requestIdRef.current);
    formData.set("clientAccountId", context.clientAccountId ?? "");
    formData.set("projectId", context.projectId ?? "");
    formData.set("icpVersionId", context.icpVersionId ?? "");
    formData.set("jobType", "ACTIVITY_RECAP");
    if (extra?.selectedSheet) formData.set("selectedSheet", extra.selectedSheet);
    if (extra?.headerRow !== undefined) formData.set("headerRow", String(extra.headerRow));
    return formData;
  }

  async function postUpload(extra?: { selectedSheet?: string; headerRow?: number }) {
    const response = await fetch("/v2/ingestion", { method: "POST", body: buildFormData(extra) });
    return response.json();
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!hasContext) {
      setState({ step: "error", message: "Choose Account, Project, and ICP above before uploading." });
      return;
    }
    fileRef.current = file;
    requestIdRef.current = crypto.randomUUID();
    setState({ step: "uploading" });

    try {
      const body = await postUpload();
      if (body.ok === false) {
        setState({ step: "error", message: body.message ?? "Upload failed." });
        return;
      }
      if (body.code === "SPREADSHEET_DETECTED") {
        setState({
          step: "detect",
          detection: {
            sheets: body.sheets ?? [],
            selectedSheet: body.selectedSheet,
            headerRow: body.headerRow,
            headers: body.headers ?? [],
            previewRows: body.previewRows ?? [],
          },
        });
        return;
      }
      // CSV path: job already created.
      setState({
        step: "mapping",
        upload: {
          ingestionJobId: body.ingestionJobId,
          headers: body.headers ?? [],
          previewRows: body.previewRows ?? [],
        },
      });
    } catch {
      setState({ step: "error", message: "An error occurred during upload." });
    }
  }

  async function refreshSheet(sheet: string) {
    if (state.step !== "detect") return;
    try {
      const body = await postUpload({ selectedSheet: sheet });
      if (body.code === "SPREADSHEET_DETECTED") {
        setState({
          step: "detect",
          detection: {
            sheets: body.sheets ?? state.detection.sheets,
            selectedSheet: body.selectedSheet,
            headerRow: body.headerRow,
            headers: body.headers ?? [],
            previewRows: body.previewRows ?? [],
          },
        });
      }
    } catch {
      // keep current detection on refresh failure
    }
  }

  async function confirmSheet(selectedSheet: string, headerRow: number) {
    setState({ step: "uploading" });
    try {
      const body = await postUpload({ selectedSheet, headerRow });
      if (body.ok === false) {
        setState({ step: "error", message: body.message ?? "Sheet confirmation failed." });
        return;
      }
      setState({
        step: "mapping",
        upload: {
          ingestionJobId: body.ingestionJobId,
          headers: body.headers ?? [],
          previewRows: body.previewRows ?? [],
        },
      });
    } catch {
      setState({ step: "error", message: "An error occurred confirming the sheet." });
    }
  }

  async function submitMapping(ingestionJobId: string, fields: CanonicalMappingFields) {
    setState({ step: "submitting" });
    try {
      const response = await fetch(`/v2/ingestion/${ingestionJobId}/mapping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      const body = await response.json();
      if (!response.ok || body.ok === false) {
        setState({ step: "error", message: body.message ?? "Mapping failed." });
        return;
      }
      setState({ step: "queued", ingestionJobId });
    } catch {
      setState({ step: "error", message: "An error occurred submitting the mapping." });
    }
  }

  return (
    <div className="space-y-5">
      <Stepper activeStep={activeStep} />

      {!hasContext ? (
        <div className="rounded-xl border border-dashed border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-600 dark:text-amber-400 shadow-premium">
          Select an Account, Project, and ICP in the context bar above to enable uploads.
        </div>
      ) : null}

      {state.step === "error" ? (
        <div className="flex items-center justify-between rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400 shadow-premium">
          <span>{state.message}</span>
          <Button variant="ghost" size="sm" onClick={() => setState({ step: "upload" })}>
            Start over
          </Button>
        </div>
      ) : null}

      {state.step === "upload" || state.step === "uploading" ? (
        <div className="rounded-2xl border border-hairline bg-card/60 backdrop-blur-xl p-6 shadow-premium ring-1 ring-border">
          <div
            className="rounded-xl border border-dashed border-hairline bg-background/50 p-10 text-center"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (hasContext && state.step === "upload") void handleFile(event.dataTransfer.files[0]);
            }}
          >
            {state.step === "uploading" ? (
              <>
                <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
                <div className="mt-3 text-sm font-semibold text-foreground">Reading file…</div>
              </>
            ) : (
              <>
                <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
                <div className="mt-3 text-base font-bold text-foreground">
                  Drop an Excel or CSV activity recap
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  .xlsx multi-sheet supported — we auto-detect sheets and the header row.
                </p>
                <div className="mt-4">
                  <Button type="button" disabled={!hasContext} onClick={() => inputRef.current?.click()}>
                    Choose file
                  </Button>
                  <input
                    ref={inputRef}
                    type="file"
                    accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="sr-only"
                    onChange={(event) => void handleFile(event.target.files?.[0])}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}

      {state.step === "detect" ? (
        <SheetDetectStep
          key={`${state.detection.selectedSheet}:${state.detection.headerRow}`}
          detection={state.detection}
          onSheetChange={refreshSheet}
          onConfirm={confirmSheet}
        />
      ) : null}

      {state.step === "mapping" || state.step === "submitting" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-white">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Field Mapping</h2>
            <Button variant="ghost" size="sm" onClick={() => setState({ step: "upload" })}>
              Cancel
            </Button>
          </div>
          {state.step === "mapping" ? (
            <MappingTable
              headers={state.upload.headers}
              previewRows={state.upload.previewRows}
              onSubmit={(fields) => submitMapping(state.upload.ingestionJobId, fields)}
            />
          ) : (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Saving mapping and starting the pipeline…
            </div>
          )}
        </div>
      ) : null}

      {state.step === "queued" ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          </div>
          <h3 className="mt-3 text-base font-semibold text-foreground">Recap queued</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            The pipeline is running on BullMQ — parse → normalize → identity → lead upsert → activity.
          </p>
          <Button asChild className="mt-4">
            <Link href={`/v2/activity-recaps/${state.ingestionJobId}`}>
              View recap progress <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SheetDetectStep({
  detection,
  onSheetChange,
  onConfirm,
}: {
  detection: Detection;
  onSheetChange: (sheet: string) => void;
  onConfirm: (sheet: string, headerRow: number) => void;
}) {
  // Remounted via `key` whenever the server refreshes detection, so these initialize
  // fresh from the latest detection — no syncing effect needed.
  const [sheet, setSheet] = useState(detection.selectedSheet);
  const [headerRow, setHeaderRow] = useState(detection.headerRow);

  const headerRowOptions = Array.from({ length: 10 }, (_, index) => index);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-white p-5">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
          <h2 className="text-sm font-semibold text-foreground">Auto-Detected Sheet &amp; Headers</h2>
        </div>

        <label className="mt-4 block text-sm">
          <span className="font-medium text-foreground">Detected sheet</span>
          <select
            value={sheet}
            onChange={(event) => {
              setSheet(event.target.value);
              onSheetChange(event.target.value);
            }}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20"
          >
            {detection.sheets.map((info) => (
              <option key={info.name} value={info.name}>
                {info.name} ({formatCount(info.rowCount)} rows)
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-sm">
          <span className="font-medium text-foreground">Header row</span>
          <select
            value={headerRow}
            onChange={(event) => setHeaderRow(Number(event.target.value))}
            className="mt-1 h-9 w-full rounded-lg border border-border bg-white px-3 text-sm outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20"
          >
            {headerRowOptions.map((index) => (
              <option key={index} value={index}>
                Row {index + 1}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Detected columns ({detection.headers.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {detection.headers.map((header) => (
              <span
                key={header}
                className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground"
              >
                {header}
              </span>
            ))}
          </div>
        </div>

        <Button className="mt-5 w-full" onClick={() => onConfirm(sheet, headerRow)}>
          Confirm sheet &amp; continue <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-white">
        <div className="border-b border-border px-5 py-4 text-sm font-semibold text-foreground">
          Preview
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/40">
              <tr>
                {detection.headers.map((header) => (
                  <th
                    key={header}
                    className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-normal text-muted-foreground"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {detection.previewRows.map((row, index) => (
                <tr key={index}>
                  {detection.headers.map((header) => (
                    <td key={header} className="max-w-56 truncate px-3 py-2 text-foreground">
                      {row[header] || "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stepper({ activeStep }: { activeStep: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-white px-5 py-4">
      {STEPS.map((label, index) => {
        const done = index < activeStep;
        const active = index === activeStep;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-primary text-white"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
            </span>
            <span className={`text-sm ${active ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
              {label}
            </span>
            {index < STEPS.length - 1 ? <span className="h-px w-8 bg-muted" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function stepIndex(step: WizardState["step"]): number {
  switch (step) {
    case "upload":
    case "uploading":
      return 0;
    case "detect":
    case "mapping":
    case "submitting":
      return 1;
    case "queued":
      return 2;
    default:
      return 0;
  }
}
