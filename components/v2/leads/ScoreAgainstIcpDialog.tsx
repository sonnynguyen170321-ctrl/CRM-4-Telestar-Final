"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Sparkles, X, Loader2, CheckCircle2 } from "lucide-react";

import { getTaskTransitionView, taskToneClasses, TaskProgressBar } from "@/components/v2/shared/taskTransition";

export type ScoreIcpOption = { id: string; label: string };

type Summary = { requested: number; created: number; existing: number; enqueued: boolean };
type ExecutionMeta = {
  executionMode: "bull" | "db" | "empty";
  executionReason: string;
  workerHealthy: boolean;
  jobCreated: boolean;
  jobId: string | null;
  bullJobId: string | null;
  drainMode: string;
};
type Progress = { processed: number; total: number; status: string };

const TERMINAL = ["SUCCEEDED", "PARTIAL", "FAILED", "CANCELLED"];
const POLL_MS = 4000;
const MAX_TICKS = 225; // ~15 min safety cap

// P2c: "Score against ICP" - pick a DIFFERENT target ICP (B) and score the selected
// leads against it (ensures the target LeadAssignments + enqueues ICP_SCORE). Lets an
// SDR pull the current people into another campaign's ICP. Mirrors the enroll dialog.
export function ScoreAgainstIcpDialog({
  leadAssignmentIds,
  icpVersions,
  triggerClassName,
  onDone,
}: {
  leadAssignmentIds: string[];
  icpVersions: ScoreIcpOption[];
  triggerClassName?: string;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetIcpVersionId, setTarget] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [execution, setExecution] = useState<ExecutionMeta | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const count = leadAssignmentIds.length;
  const noIcps = icpVersions.length === 0;
  const canSubmit = count > 0 && targetIcpVersionId && !pending;

  // Poll the scoring run so the dialog reflects the real runtime advancing X/N.
  useEffect(() => {
    if (!runId) return;
    let ticks = 0;
    let stopped = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (stopped) return;
      ticks += 1;
      try {
        const res = await fetch(`/v2/api/runtime/runs/${runId}`, { cache: "no-store" });
        if (res.ok) {
          const body = (await res.json()) as {
            view?: { run: { processedUnits: number; totalUnits: number; status: string } };
          };
          if (body.view) {
            const { processedUnits, totalUnits, status } = body.view.run;
            setProgress({ processed: processedUnits, total: totalUnits, status });
            if (TERMINAL.includes(status) && intervalId) clearInterval(intervalId);
          }
        }
      } catch {
        /* transient - keep polling */
      }
      if (ticks >= MAX_TICKS && intervalId) clearInterval(intervalId);
    }

    void poll();
    intervalId = setInterval(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [runId]);

  function submit() {
    setError(null);
    setSummary(null);
    setProgress(null);
    setExecution(null);
    setRunId(null);
    startTransition(async () => {
      try {
        const res = await fetch("/v2/workspace/leads/score-icp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ targetIcpVersionId, leadAssignmentIds }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.ok === false) {
          setError(body.message ?? "Score request failed.");
          return;
        }
        const result = body.result as Summary;
        const meta = body as Partial<ExecutionMeta>;
        setSummary(result);
        setExecution({
          executionMode: meta.executionMode ?? "db",
          executionReason: meta.executionReason ?? "bull_disabled",
          workerHealthy: Boolean(meta.workerHealthy),
          jobCreated: Boolean(meta.jobCreated),
          jobId: typeof meta.jobId === "string" ? meta.jobId : null,
          bullJobId: typeof meta.bullJobId === "string" ? meta.bullJobId : null,
          drainMode: typeof meta.drainMode === "string" ? meta.drainMode : "unknown",
        });
        if (typeof body.runId === "string" && body.runId) {
          setRunId(body.runId);
          setProgress({ processed: 0, total: result?.requested ?? count, status: "QUEUED" });
        }
        router.refresh();
      } catch {
        setError("Score request failed.");
      }
    });
  }

  function close() {
    setOpen(false);
    setError(null);
    setSummary(null);
    setProgress(null);
    setExecution(null);
    setRunId(null);
  }

  function finishAndClose() {
    onDone?.();
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={count === 0}
        className={
          triggerClassName ??
          "inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Score against ICP
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 cursor-default bg-foreground/40" onClick={close} />
          <div className="relative z-10 w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">Score against another ICP</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Scores {count} lead{count === 1 ? "" : "s"} against a different ICP so you can work them in
                  another campaign. Creates the target assignment if it does not exist; existing ones are reused.
                </p>
              </div>
              <button type="button" onClick={close} className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20" aria-label="Close dialog">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            {summary ? (
              (() => {
                const statusView = getTaskTransitionView(progress?.status ?? "QUEUED");
                const tone = taskToneClasses(statusView.tone);
                const done = progress ? statusView.terminal : false;
                const pct =
                  progress && progress.total > 0
                    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
                    : 0;
                const stuck = Boolean(progress && !done && progress.processed === 0 && (progress.status === "QUEUED" || progress.status === "RUNNING"));
                const StatusIcon = statusView.icon;
                return (
                  <div className="mt-4 space-y-3">
                    <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${tone.surface}`}>
                      <StatusIcon className={`h-5 w-5 shrink-0 ${statusView.inFlight ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                      <span>
                        {statusView.label} for <span className="font-semibold">{summary.requested}</span> lead
                        {summary.requested === 1 ? "" : "s"} ({summary.created} new, {summary.existing} reused).
                      </span>
                    </div>

                    {execution ? (
                      <div className="rounded-lg border border-border bg-secondary/50 p-3 text-xs leading-5 text-muted-foreground">
                        <div className="font-semibold text-foreground">
                          {execution.executionMode === "db"
                            ? execution.drainMode === "inline_started"
                              ? "DB fallback draining"
                              : execution.drainMode === "queued_after_inline_error"
                                ? "DB fallback needs attention"
                                : "Queued by DB fallback"
                            : execution.executionMode === "bull" ? "Worker running" : "No work needed"}
                        </div>
                        <div>
                          {execution.executionReason === "bull_worker_unhealthy"
                            ? execution.drainMode === "inline_started"
                              ? "The scoring worker was not live, so the durable DB job started inline."
                              : "The scoring worker is not live; this run is waiting in the durable DB queue."
                            : execution.executionReason === "bull_enqueue_failed"
                              ? "BullMQ did not accept the run, so the durable DB path is handling it."
                              : execution.executionReason === "bull_worker_healthy"
                                ? "A healthy worker accepted this run."
                                : "Local DB scoring is handling this run."}
                        </div>
                        {stuck ? <div className="mt-1 font-medium text-amber-700">Still waiting at 0/{progress?.total ?? summary.requested}. {execution.drainMode === "queued_until_worker" ? "Start the worker or use the DB drain path." : "Keep this open or check worker health if it does not advance."}</div> : null}
                      </div>
                    ) : null}
                    {progress ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            {done ? (
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
                            )}
                            {statusView.label} {progress.processed}/{progress.total}
                          </span>
                          <span>{pct}%</span>
                        </div>
                        <TaskProgressBar percent={pct} tone={statusView.tone} />
                      </div>
                    ) : null}

                    <div className="flex items-center gap-2">
                      <Link
                        href={`/v2/workspace/leads?icpVersionId=${encodeURIComponent(targetIcpVersionId)}`}
                        className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                      >
                        View in Leads <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <button type="button" onClick={progress && !done ? close : finishAndClose} className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center rounded-md bg-foreground px-3 text-sm font-medium text-background transition-colors hover:bg-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
                        {progress && !done ? "Close (keeps running)" : "Done"}
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="mt-4 space-y-4">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-foreground">Target ICP</span>
                  <select
                    value={targetIcpVersionId}
                    onChange={(e) => setTarget(e.target.value)}
                    disabled={noIcps}
                    className="h-9 w-full cursor-pointer rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-primary/20 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-muted/40"
                  >
                    <option value="">{noIcps ? "No published ICPs" : "Select an ICP"}</option>
                    {icpVersions.map((v) => (
                      <option key={v.id} value={v.id}>{v.label}</option>
                    ))}
                  </select>
                  {noIcps ? <span className="text-xs text-muted-foreground">Publish an ICP version first.</span> : null}
                </label>

                {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={close} className="inline-flex h-9 cursor-pointer items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">Cancel</button>
                  <button type="button" onClick={submit} disabled={!canSubmit} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary disabled:cursor-not-allowed disabled:bg-foreground">
                    {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
                    Score {count}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}