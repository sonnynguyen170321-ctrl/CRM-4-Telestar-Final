"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Pause, Play, RefreshCcw } from "lucide-react";

import { notifyV2 } from "@/components/v2/notifications/notificationClient";
import { getTaskTransitionView, taskToneClasses, TaskProgressBar } from "@/components/v2/shared/taskTransition";
import type { ResearchProgressPayload } from "@/lib/v2/research/progress";

// Self-driving run monitor. While a run has queries left, it auto-POSTs the process route until
// terminal; no manual clicking. With a healthy worker the process route returns fast and this panel
// tracks progress. With no worker, the same loop drains the run from the open page.

const TICK_MS = 1600;
const STALL_LIMIT = 2;
const REQUEST_TIMEOUT_MS = 30_000;
const ERROR_LIMIT = 3;

function isTerminal(kind: ResearchProgressPayload["nextAction"]["kind"]): boolean {
  return kind === "complete" || kind === "review" || kind === "open_leads";
}
function isDriveable(p: ResearchProgressPayload): boolean {
  return p.providerConfigured && (p.nextAction.kind === "process" || p.jobs.running > 0 || p.jobs.queued > 0);
}

function researchLifecycleStatus(progress: ResearchProgressPayload, paused: boolean, clientError: string | null): string {
  if (progress.nextAction.kind === "failed" || progress.nextAction.kind === "provider_error") return "FAILED";
  if (clientError || !progress.providerConfigured || paused) return "RETRY_SCHEDULED";
  if (isTerminal(progress.nextAction.kind) && progress.jobs.queued === 0 && progress.jobs.running === 0) return "SUCCEEDED";
  if (isDriveable(progress)) return "RUNNING";
  return "QUEUED";
}

export function RunProgressPanel({ initialProgress }: { initialProgress: ResearchProgressPayload }) {
  const router = useRouter();
  const [progress, setProgress] = useState(initialProgress);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const progressRef = useRef(progress);
  const pausedRef = useRef(paused);
  const busyRef = useRef(false);
  const stallsRef = useRef(0);
  const errorsRef = useRef(0);
  const startNotifiedRef = useRef(false);
  const terminalNotifiedRef = useRef<string | null>(null);
  useEffect(() => { progressRef.current = progress; }, [progress]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  const apply = useCallback((next: ResearchProgressPayload) => {
    const previous = progressRef.current;
    const wasProcessing = !isTerminal(previous.nextAction.kind);
    setProgress(next);
    if (
      (next.nextAction.kind === "failed" || next.nextAction.kind === "provider_error") &&
      terminalNotifiedRef.current !== `${next.runId}:${next.nextAction.kind}`
    ) {
      terminalNotifiedRef.current = `${next.runId}:${next.nextAction.kind}`;
      const providerErr = next.nextAction.kind === "provider_error";
      notifyV2({
        type: "research.stage.failed",
        kind: "error",
        title: providerErr ? "Search provider rejected the run" : "Research run failed",
        description: next.errorMessage ?? next.nextAction.detail,
        href: `/v2/research?runId=${next.runId}`,
        actionLabel: providerErr ? "Check keys" : "Inspect",
      });
    }
    if (wasProcessing && isTerminal(next.nextAction.kind)) {
      router.refresh();
      const key = `${next.runId}:${next.nextAction.kind}`;
      if (terminalNotifiedRef.current !== key) {
        terminalNotifiedRef.current = key;
        const openLeads = next.nextAction.kind === "open_leads";
        notifyV2({
          type: openLeads ? "lead.created" : "research.stage.completed",
          kind: "success",
          title: openLeads ? "Promoted leads are ready" : "Research run is ready for review",
          description: next.nextAction.detail,
          href: openLeads ? "/v2/workspace/leads" : `/v2/research?runId=${next.runId}`,
          actionLabel: openLeads ? "Open leads" : "Review",
        });
      }
    }
  }, [router]);

  const tick = useCallback(async () => {
    if (busyRef.current || pausedRef.current) return;
    const current = progressRef.current;
    if (!isDriveable(current) || current.nextAction.kind === "failed") return;
    busyRef.current = true;
    setBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const isProcess = current.nextAction.kind === "process";
      const res = isProcess
        ? await fetch(`/v2/research/${current.runId}/process`, { method: "POST", signal: controller.signal })
        : await fetch(`/v2/research/${current.runId}/progress`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const next = (await res.json()) as ResearchProgressPayload & { processed?: number };
      errorsRef.current = 0;
      setClientError(null);
      if (isProcess && typeof next.processed === "number") {
        stallsRef.current = next.processed === 0 ? stallsRef.current + 1 : 0;
      }
      apply(next);
      if (stallsRef.current >= STALL_LIMIT) setPaused(true);
    } catch (err) {
      errorsRef.current += 1;
      if (errorsRef.current >= ERROR_LIMIT) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        setClientError(
          aborted
            ? "The run stopped responding. Retry to resume."
            : "Could not reach the research runtime. Retry to resume."
        );
        setPaused(true);
      }
    } finally {
      window.clearTimeout(timeout);
      busyRef.current = false;
      setBusy(false);
    }
  }, [apply]);

  useEffect(() => {
    if (!startNotifiedRef.current && isDriveable(progress)) {
      startNotifiedRef.current = true;
      notifyV2({ type: "research.run.started", kind: "info", title: "Research run started", description: progress.nextAction.detail, href: `/v2/research?runId=${progress.runId}`, actionLabel: "Open" });
    }
  }, [progress]);

  useEffect(() => {
    const id = window.setInterval(() => { void tick(); }, TICK_MS);
    return () => window.clearInterval(id);
  }, [tick]);

  function retry() {
    stallsRef.current = 0;
    errorsRef.current = 0;
    setClientError(null);
    setPaused(false);
    void tick();
  }

  const status = getTaskTransitionView(researchLifecycleStatus(progress, paused, clientError));
  const tone = taskToneClasses(status.tone);
  const failed = status.tone === "danger";
  const done = status.terminal && status.tone === "success";
  const driving = isDriveable(progress) && !paused && !failed && !clientError;
  const Icon = status.icon;

  return (
    <section className={`rounded-lg border p-4 ${tone.surface}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`flex h-8 w-8 items-center justify-center rounded-md ${tone.iconTile}`}>
              <Icon className={`h-4 w-4 ${status.inFlight && driving ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">{status.label}</h2>
              <p className="text-xs opacity-80">{progress.nextAction.detail}</p>
            </div>
          </div>
          {progress.errorMessage ? <p className="mt-2 text-xs font-medium text-red-700">{progress.errorMessage}</p> : null}
          {clientError ? (
            <div className="mt-2 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs font-medium text-red-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{clientError}</span>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ProgressPill label="Queries" value={`${progress.cursor}/${progress.totalQueries}`} />
          <ProgressPill label="Found" value={`${progress.candidates.discovered}`} />
          <ProgressPill label="Known" value={`${progress.candidates.duplicate}`} />
          {driving ? (
            <button type="button" onClick={() => setPaused(true)} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              <Pause className="h-3.5 w-3.5" /> Pause
            </button>
          ) : failed || paused ? (
            !done ? (
              <button type="button" onClick={retry} disabled={busy || !progress.providerConfigured} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" /> : <Play className="h-3.5 w-3.5" />} Resume
              </button>
            ) : null
          ) : null}
          <button type="button" onClick={() => void tick()} disabled={busy} className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-md border border-hairline bg-surface px-3 text-xs font-semibold text-foreground transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50">
            <RefreshCcw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>
      <TaskProgressBar percent={progress.percent} tone={status.tone} className="mt-4" />
    </section>
  );
}

function ProgressPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-xs">
      <span className="font-medium opacity-70">{label}</span>
      <span className="ml-1 font-semibold">{value}</span>
    </span>
  );
}