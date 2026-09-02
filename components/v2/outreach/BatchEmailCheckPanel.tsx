"use client";

import { useActionState, useMemo } from "react";
import { Download, Play, Upload } from "lucide-react";
import { formatCount } from "@/lib/v2/format/datetime";

import { PanelCard } from "@/components/shared/PanelCard";
import {
  checkBatchEmailsAction,
  syncBatchToCampaignAction,
  type BatchCampaignSyncState,
  type BatchEmailCheckState,
} from "@/app/v2/outreach/suppression/batchActions";

export type BatchCampaignOption = {
  id: string;
  name: string;
  status: string;
};

const initialBatchEmailCheckState: BatchEmailCheckState = {
  status: "idle",
  errors: [],
  fileName: null,
  headers: [],
  emailColumn: null,
  leadAssignmentColumn: null,
  checkedAt: null,
  summary: null,
  rows: [],
};

const initialBatchCampaignSyncState: BatchCampaignSyncState = {
  status: "idle",
  message: null,
  errors: [],
};

export function BatchEmailCheckPanel({ campaigns }: { campaigns: BatchCampaignOption[] }) {
  const [checkState, checkAction, checking] = useActionState(
    checkBatchEmailsAction,
    initialBatchEmailCheckState
  );
  const [syncState, syncAction, syncing] = useActionState(
    syncBatchToCampaignAction,
    initialBatchCampaignSyncState
  );
  const validRowsWithLead = useMemo(
    () => checkState.rows.filter((row) => row.status === "valid" && row.leadAssignmentId),
    [checkState.rows]
  );

  return (
    <PanelCard
      title="Batch email check"
      description="Upload a CSV, validate email syntax, remove duplicates, check existing V2 contact validity, and apply the active suppression list."
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <form action={checkAction} className="space-y-3">
          <label className="block text-xs font-medium text-muted-foreground">
            CSV file
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="mt-1 block w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-foreground"
            />
          </label>
          <label className="block text-xs font-medium text-muted-foreground">
            Email column override
            <input
              name="emailColumn"
              placeholder="Optional, defaults to first header containing email"
              className="mt-1 h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary/20"
            />
          </label>
          <button
            type="submit"
            disabled={checking}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-white outline-none hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-primary/20"
          >
            <Upload className="h-4 w-4" aria-hidden="true" />
            {checking ? "Checking..." : "Check batch"}
          </button>
          <StateErrors state={checkState} />
        </form>

        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Result summary</div>
          <SummaryGrid state={checkState} />
          {checkState.status === "success" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => downloadCsv(checkState, "all")}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted/50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export all
              </button>
              <button
                type="button"
                onClick={() => downloadCsv(checkState, "valid")}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted/50"
              >
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export valid
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {checkState.status === "success" ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <BatchPreview state={checkState} />
          <form action={syncAction} className="rounded-md border border-border bg-card p-3">
            <div className="text-sm font-semibold text-foreground">Sync valid rows to campaign</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Requires a `leadAssignmentId` column. The campaign runtime rechecks eligibility,
              suppression, schedule, sender pool, and launch blockers.
            </p>
            <label className="mt-3 block text-xs font-medium text-muted-foreground">
              Draft campaign
              <select
                name="campaignId"
                className="mt-1 h-10 w-full rounded-md border border-border bg-card px-2 text-sm text-foreground outline-none focus:border-primary/20"
              >
                <option value="">Choose campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name} ({campaign.status})
                  </option>
                ))}
              </select>
            </label>
            {validRowsWithLead.map((row) => (
              <input key={row.rowNumber} type="hidden" name="leadAssignmentId" value={row.leadAssignmentId ?? ""} />
            ))}
            <button
              type="submit"
              disabled={syncing || validRowsWithLead.length === 0}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-semibold text-white outline-none hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-border"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {syncing ? "Syncing..." : "Sync to campaign"}
            </button>
            <div className="mt-2 text-xs text-muted-foreground">
              {formatCount(validRowsWithLead.length)} valid rows have leadAssignmentId.
            </div>
            {syncState.message ? (
              <div className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                {syncState.message}
              </div>
            ) : null}
            {syncState.errors.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-red-700">
                {syncState.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            ) : null}
          </form>
        </div>
      ) : null}
    </PanelCard>
  );
}

function StateErrors({ state }: { state: BatchEmailCheckState }) {
  if (state.errors.length === 0) return null;
  return (
    <ul className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
      {state.errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
  );
}

function SummaryGrid({ state }: { state: BatchEmailCheckState }) {
  const summary = state.summary;
  const items = [
    ["Total", summary?.total ?? 0],
    ["Valid", summary?.valid ?? 0],
    ["Suppressed", summary?.suppressed ?? 0],
    ["Invalid", summary?.invalid ?? 0],
    ["Duplicate", summary?.duplicate ?? 0],
    ["Missing", summary?.missing ?? 0],
  ];
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-md border border-border bg-card px-3 py-2">
          <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
          <div className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">{formatCount(Number(value))}</div>
        </div>
      ))}
    </div>
  );
}

function BatchPreview({ state }: { state: BatchEmailCheckState }) {
  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <div className="border-b border-border px-3 py-2">
        <div className="text-sm font-semibold text-foreground">Checked rows</div>
        <div className="text-xs text-muted-foreground">
          {state.fileName} - email column: {state.emailColumn}
        </div>
      </div>
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="sticky top-0 border-b border-border bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Row</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Reason</th>
              <th className="px-3 py-2 font-medium">LeadAssignment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {state.rows.slice(0, 200).map((row) => (
              <tr key={row.rowNumber}>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{row.rowNumber}</td>
                <td className="px-3 py-2 font-medium text-foreground">{(row.normalizedEmail ?? row.emailRaw) || "-"}</td>
                <td className="px-3 py-2">
                  <span className={"rounded-full px-2 py-0.5 font-semibold " + statusTone(row.status)}>
                    {row.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{row.reason}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{row.leadAssignmentId ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusTone(status: string) {
  if (status === "valid") return "bg-emerald-50 text-emerald-700";
  if (status === "suppressed") return "bg-amber-50 text-amber-700";
  if (status === "invalid") return "bg-red-50 text-red-700";
  return "bg-muted text-foreground";
}

function downloadCsv(state: BatchEmailCheckState, mode: "all" | "valid") {
  const rows = mode === "valid" ? state.rows.filter((row) => row.status === "valid") : state.rows;
  const headers = [
    "rowNumber",
    "emailRaw",
    "normalizedEmail",
    "domain",
    "status",
    "reason",
    "suppressionType",
    "suppressionMatchedOn",
    "contactIdentifierStatus",
    "leadAssignmentId",
  ];
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header as keyof typeof row])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `outreach-email-check-${mode}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
