"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCw, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cancelJobAction, retryJobAction } from "@/app/v2/ingestion/jobs/actions";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { formatDateTime } from "@/lib/v2/format/datetime";

export type JobRow = {
  id: string;
  jobType: string;
  status: string;
  retryCount: number;
  updatedAt: string;
  errorMessage: string | null;
};

const STATUS_CLS: Record<string, string> = {
  QUEUED: "bg-[#EFF4FF] text-[#0F5BF4]",
  RUNNING: "bg-[#E0F2FE] text-[#0369A1]",
  SUCCEEDED: "bg-[#DCFCE7] text-[#16A34A]",
  FAILED: "bg-[#FEE2E2] text-[#EF4444]",
  RETRY_SCHEDULED: "bg-[#FEF3C7] text-[#D97706]",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function JobsTable({ rows }: { rows: JobRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(action: (id: string) => Promise<{ error?: string; success?: boolean }>, id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const res = await action(id);
      setBusyId(null);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const empty = <p className="px-4 py-8 text-center text-sm text-muted-foreground bg-surface">No jobs in range.</p>;

  const columns: DataTableColumn<JobRow>[] = [
    {
      key: "jobType",
      header: "Job type",
      cell: (job) => <span className="font-semibold text-foreground">{job.jobType}</span>,
    },
    {
      key: "status",
      header: "Status",
      cell: (job) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[job.status] ?? "bg-secondary text-muted-foreground"}`}>
          {job.status}
        </span>
      ),
    },
    {
      key: "retries",
      header: "Retries",
      cell: (job) => <span className="tabular-nums text-muted-foreground">{job.retryCount}</span>,
    },
    {
      key: "updated",
      header: "Updated",
      cell: (job) => <span className="text-muted-foreground">{formatDateTime(job.updatedAt)}</span>,
    },
    {
      key: "error",
      header: "Error",
      cell: (job) => (
        <div className="max-w-[220px] truncate text-muted-foreground" title={job.errorMessage ?? ""}>
          {job.errorMessage ?? "—"}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (job) => {
        const canRetry = job.status === "FAILED" || job.status === "RETRY_SCHEDULED";
        const canCancel = job.status === "QUEUED" || job.status === "RETRY_SCHEDULED";
        const busy = pending && busyId === job.id;
        return (
          <div className="flex justify-end gap-2">
            {canRetry && (
              <Button size="sm" variant="outline" className="cursor-pointer border-hairline hover:bg-surface-raised animate-in fade-in" disabled={busy} onClick={() => run(retryJobAction, job.id)}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCw className="mr-1 h-3.5 w-3.5" />}
                Retry
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="outline" className="cursor-pointer border-hairline hover:bg-surface-raised animate-in fade-in" disabled={busy} onClick={() => run(cancelJobAction, job.id)}>
                {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1 h-3.5 w-3.5" />}
                Cancel
              </Button>
            )}
            {!canRetry && !canCancel && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      {error && <div className="m-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-700 font-semibold">{error}</div>}
      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(job) => job.id}
        minWidth="min-w-[640px]"
        empty={empty}
        className="border-none shadow-none rounded-none"
      />
    </div>
  );
}
