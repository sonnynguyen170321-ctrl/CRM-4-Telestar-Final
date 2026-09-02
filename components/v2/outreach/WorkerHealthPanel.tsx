import { Activity, AlertTriangle, CheckCircle2, CircleSlash } from "lucide-react";

import type { WorkerHealth, WorkerHealthEntry } from "@/lib/v2/jobs/queryWorkerHealth";

// W9: real runtime readiness. Replaces the old "heartbeat persistence is not available
// yet" placeholder with the actual worker liveness read (V2WorkerHeartbeat). Advisory:
// scheduled sends are persisted, so a briefly-down worker doesn't lose them — it just
// delays them until the daemon is back. Presentational; the page passes queryWorkerHealth.

const WORKER_LABELS: Record<string, { label: string; hint: string }> = {
  job_worker: { label: "Send worker", hint: "Processes scheduled email + sequence sends" },
  imap_poller: { label: "Inbox poller", hint: "Pulls replies/bounces into the inbox" },
};

function ageLabel(entry: WorkerHealthEntry): string {
  if (entry.reason === "NEVER" || entry.ageMs == null) return "no heartbeat yet";
  const minutes = Math.floor(entry.ageMs / 60000);
  if (minutes < 1) return "beat <1m ago";
  if (minutes < 60) return `beat ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `beat ${hours}h ago`;
}

export function WorkerHealthPanel({ health }: { health: WorkerHealth }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        Runtime workers
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {health.workers.map((worker) => {
          const meta = WORKER_LABELS[worker.kind] ?? { label: worker.kind, hint: "" };
          const tone = worker.healthy
            ? "border-emerald-200 bg-emerald-50"
            : worker.reason === "STALE"
              ? "border-amber-200 bg-amber-50"
              : "border-border bg-muted/40";
          return (
            <li key={worker.kind} className={`flex items-start gap-2 rounded-md border px-3 py-2 ${tone}`}>
              <span className="mt-0.5 shrink-0">
                {worker.healthy ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                ) : worker.reason === "STALE" ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                ) : (
                  <CircleSlash className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                )}
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-foreground">
                  {meta.label}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {worker.healthy ? "online" : worker.reason === "STALE" ? "stale" : "not running"}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">{ageLabel(worker)} · {meta.hint}</div>
              </div>
            </li>
          );
        })}
      </ul>
      {health.warning ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {health.warning}
        </div>
      ) : (
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          Scheduled sends are persisted — a briefly-offline worker delays them, it doesn’t drop them.
        </p>
      )}
    </div>
  );
}
