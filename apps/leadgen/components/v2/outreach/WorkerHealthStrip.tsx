import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

import type { WorkerHealth } from "@/lib/v2/jobs/queryWorkerHealth";

// Surfaces job-worker + IMAP-poller liveness and the job backlog so a dead worker
// with queued work is visible (the "51 queued, no worker" failure mode), not silent.

const KIND_LABEL: Record<string, string> = {
  job_worker: "Job worker",
  imap_poller: "IMAP poller",
};

export function WorkerHealthStrip({ health }: { health: WorkerHealth }) {
  const { backlog, warning, workers } = health;
  const anyBacklog = backlog.queued + backlog.running + backlog.retryScheduled > 0;

  return (
    <div
      className={`rounded-md border p-4 ${
        warning ? "border-amber-200 bg-amber-50" : "border-border bg-card"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {warning ? (
            <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
          ) : (
            <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          )}
          <span className="text-sm font-semibold text-foreground">Runtime</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workers.map((w) => (
            <span
              key={w.kind}
              title={w.lastBeatAt ? `last beat ${new Date(w.lastBeatAt).toLocaleString()}` : "never seen"}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                w.healthy ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
              }`}
            >
              {w.healthy ? (
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              )}
              {KIND_LABEL[w.kind] ?? w.kind}: {w.healthy ? "live" : w.reason === "NEVER" ? "never" : "stale"}
            </span>
          ))}
          {anyBacklog ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
              {backlog.queued} queued / {backlog.running} running
              {backlog.retryScheduled > 0 ? ` / ${backlog.retryScheduled} retry` : ""}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No jobs pending</span>
          )}
        </div>
      </div>
      {warning ? <p className="mt-2 text-sm text-amber-800">{warning}</p> : null}
    </div>
  );
}
