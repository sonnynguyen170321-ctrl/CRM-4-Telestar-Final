"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Copy,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { humanizeTaskToken, TaskProgressBar, TaskStatusPill } from "@/components/v2/shared/taskTransition";

type ProgressPanelProps = {
  ingestionJobId: string;
};

type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "RETRY_SCHEDULED"
  | string;

type ProgressPayload = {
  ok: true;
  ingestionJob: {
    id: string;
    status: string;
    jobType: string;
    originalFileName: string;
    updatedAt: string;
  };
  jobs: Array<{
    id: string;
    jobType: string;
    status: JobStatus;
    progressCurrent: number;
    progressTotal: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    updatedAt: string;
  }>;
  rowStatusCounts: Record<"RAW" | "NORMALIZED" | "MATCHED" | "APPLIED" | "ERROR", number>;
  identityCounts: Record<"matched" | "ambiguous" | "none" | "error" | "raw", number>;
  enrichmentCounts: Record<
    "enriched" | "partial" | "parked" | "blocked" | "no_website" | "not_run" | "queued",
    number
  >;
  qualificationCounts: Record<
    | "QUALIFIED"
    | "COMPANY_QUALIFIED_NEEDS_CONTACT"
    | "NEEDS_REVIEW"
    | "UNQUALIFIED"
    | "NOT_SCORED",
    number
  >;
  groupedStages: Array<{
    stage: string;
    label: string;
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    retryScheduled: number;
    cancelled: number;
    progressCurrent: number;
    progressTotal: number | null;
    latestErrorCode: string | null;
    latestErrorMessage: string | null;
    jobs: Array<{
      id: string;
      jobType: string;
      status: JobStatus;
      progressCurrent: number;
      progressTotal: number | null;
      errorCode: string | null;
      errorMessage: string | null;
      updatedAt: string;
    }>;
  }>;
  diagnostics: {
    scoreJobLinkState: "linked" | "missing" | "malformed";
    unknownNonCanonicalQualificationCount: number;
  };
  polling: {
    terminal: boolean;
    intervalMs: number | null;
  };
};

type PanelState =
  | { kind: "loading" }
  | { kind: "ready"; payload: ProgressPayload; updatedAt: number }
  | { kind: "error"; message: string; payload?: ProgressPayload };

const TERMINAL_STATUSES = new Set(["SUCCEEDED", "FAILED", "CANCELLED"]);

export function ProgressPanel({ ingestionJobId }: ProgressPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  const [refreshToken, setRefreshToken] = useState(0);
  const payload = state.kind === "ready" || state.kind === "error" ? state.payload : undefined;
  const pollInterval = payload?.polling.terminal ? null : (payload?.polling.intervalMs ?? 2500);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let controller: AbortController | null = null;

    async function load() {
      controller?.abort();
      controller = new AbortController();

      try {
        const response = await fetch(`/v2/ingestion/${ingestionJobId}/progress`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();

        if (!response.ok || body.ok === false) {
          throw new Error(
            typeof body.message === "string" ? body.message : "Progress request failed."
          );
        }

        if (disposed) {
          return;
        }

        setState({
          kind: "ready",
          payload: body as ProgressPayload,
          updatedAt: Date.now(),
        });

        if (!body.polling?.terminal) {
          timer = setTimeout(load, body.polling?.intervalMs ?? 2500);
        }
      } catch (error) {
        if (disposed || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }

        setState((current) => ({
          kind: "error",
          message: error instanceof Error ? error.message : "Progress request failed.",
          payload:
            current.kind === "ready" || current.kind === "error"
              ? current.payload
              : undefined,
        }));
      }
    }

    load();

    return () => {
      disposed = true;
      controller?.abort();

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [ingestionJobId, refreshToken]);

  const [isProcessing, setIsProcessing] = useState(false);
  // Auto-drain: while the job page is open and there is pending work, keep calling
  // run-until-idle until the pipeline is idle - so the operator does not have to
  // click repeatedly (there is no background worker yet; that is O5s / Link D).
  // Stops when a drain pass makes no progress (stalled: failures / future retries),
  // so it never tight-loops; the operator can resume manually.
  const [autoRun, setAutoRun] = useState(true);
  const [autoStalled, setAutoStalled] = useState(false);
  const autoInFlight = useRef(false);

  async function handleProcessNext() {
    setIsProcessing(true);
    setAutoStalled(false);
    try {
      await fetch(`/v2/ingestion/${ingestionJobId}/process-next`, { method: "POST" });
      setRefreshToken((r) => r + 1);
    } finally {
      setIsProcessing(false);
    }
  }

  // Returns how many jobs this drain pass processed (0 => no progress / stalled).
  async function runUntilIdleOnce(): Promise<number> {
    setIsProcessing(true);
    try {
      const response = await fetch(`/v2/ingestion/${ingestionJobId}/run-until-idle`, {
        method: "POST",
      });
      const body = await response.json().catch(() => ({}));
      setRefreshToken((r) => r + 1);
      return typeof body?.processed === "number" ? body.processed : 0;
    } catch {
      setRefreshToken((r) => r + 1);
      return 0;
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRunUntilIdle() {
    setAutoStalled(false);
    await runUntilIdleOnce();
  }

  const summary = useMemo(() => (payload ? buildSummary(payload) : null), [payload]);

  const activeJobs = summary?.activeJobs ?? 0;
  const terminal = payload?.polling.terminal ?? false;

  // Auto-drain loop: re-fires after each progress refresh while work remains.
  useEffect(() => {
    if (!autoRun || autoStalled || terminal) return;
    if (activeJobs <= 0) return;
    if (isProcessing || autoInFlight.current) return;

    autoInFlight.current = true;
    let cancelled = false;
    (async () => {
      const processed = await runUntilIdleOnce();
      autoInFlight.current = false;
      if (!cancelled && processed === 0) {
        // a full pass moved nothing while work remains -> stop auto, let the
        // operator retry (likely network-throttled fetches or scheduled retries)
        setAutoStalled(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, autoStalled, terminal, activeJobs, isProcessing]);

  return (
    <section className="rounded-md border border-border bg-surface shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border bg-muted/40 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-foreground">Ingestion progress</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live stage progress, row quality, and the next recovery step for this upload.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {payload ? <StatusBadge status={payload.ingestionJob.status} /> : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="cursor-pointer"
            onClick={() => {
              setState({ kind: "loading" });
              setRefreshToken((value) => value + 1);
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
          <details className="group relative">
            <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20">
              Advanced runtime controls
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-[min(92vw,420px)] rounded-lg border border-border bg-surface p-3 shadow-lg">
              {payload && summary?.activeJobs !== undefined && summary.activeJobs > 0 ? (
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={autoRun}
                      onChange={(event) => {
                        setAutoRun(event.target.checked);
                        if (event.target.checked) setAutoStalled(false);
                      }}
                    />
                    Auto-run this upload while the page is open
                  </label>
                  {autoRun && !autoStalled ? (
                    <span className="inline-flex items-center text-xs text-muted-foreground">
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
                      Running automatically
                    </span>
                  ) : null}
                  {autoStalled ? (
                    <span className="block text-xs text-amber-700">
                      Auto-run paused because the last pass made no progress. Retry the drain controls when the worker is ready.
                    </span>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={handleProcessNext} disabled={isProcessing}>
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                      Process next stage
                    </Button>
                    <Button size="sm" variant="default" onClick={handleRunUntilIdle} disabled={isProcessing}>
                      {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : null}
                      Run until idle
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No active worker controls are needed for this upload right now.</p>
              )}
              {payload ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                    alert("Runtime details copied to clipboard");
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
                  Copy runtime details
                </Button>
              ) : null}
            </div>
          </details>
        </div>
      </div>

      <div className="space-y-4 p-4">
        {state.kind === "loading" ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading progress
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.message}
          </div>
        ) : null}

        {payload && summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
              <Metric label="Rows" value={summary.totalRows} detail={`${summary.appliedRows} applied`} />
              <Metric label="Jobs" value={payload.jobs.length} detail={`${summary.activeJobs} active`} />
              <Metric
                label="Enrichment"
                value={payload.enrichmentCounts.enriched}
                detail={`${payload.enrichmentCounts.partial} partial`}
              />
              <Metric label="Scored" value={summary.scoredLeads} detail={`${summary.notScoredLeads} not scored`} />
              <Metric label="Errors" value={payload.rowStatusCounts.ERROR} detail="Row errors" tone="danger" />
              <Metric
                label="Score link"
                value={formatLabel(payload.diagnostics.scoreJobLinkState)}
                detail="Best effort"
                tone={payload.diagnostics.scoreJobLinkState === "malformed" ? "warning" : "neutral"}
              />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-foreground">Overall job progress</span>
                <span className="text-muted-foreground">{summary.overallPercent}%</span>
              </div>
              <TaskProgressBar percent={summary.overallPercent} tone={payload.ingestionJob.status === "FAILED" ? "danger" : payload.polling.terminal ? "success" : "info"} />
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <div className="overflow-hidden rounded-md border border-border bg-surface">
                <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                  Job stages
                </div>
                <div className="divide-y divide-border">
                  {payload.groupedStages && payload.groupedStages.length > 0 ? (
                    payload.groupedStages.map((stageGroup) => (
                      <StageGroupRow key={stageGroup.stage} stageGroup={stageGroup} />
                    ))
                  ) : (
                    <div className="px-4 py-4 text-sm text-muted-foreground">
                      No child jobs have been queued yet.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <BucketGroup
                  title="Row status"
                  rows={[
                    ["RAW", payload.rowStatusCounts.RAW],
                    ["NORMALIZED", payload.rowStatusCounts.NORMALIZED],
                    ["MATCHED", payload.rowStatusCounts.MATCHED],
                    ["APPLIED", payload.rowStatusCounts.APPLIED],
                    ["ERROR", payload.rowStatusCounts.ERROR],
                  ]}
                />
                <BucketGroup
                  title="Identity buckets"
                  rows={[
                    ["matched", payload.identityCounts.matched],
                    ["ambiguous", payload.identityCounts.ambiguous],
                    ["none", payload.identityCounts.none],
                    ["raw", payload.identityCounts.raw],
                    ["error", payload.identityCounts.error],
                  ]}
                />
                <BucketGroup
                  title="Enrichment buckets"
                  rows={[
                    ["enriched", payload.enrichmentCounts.enriched],
                    ["partial", payload.enrichmentCounts.partial],
                    ["parked", payload.enrichmentCounts.parked],
                    ["blocked", payload.enrichmentCounts.blocked],
                    ["no_website", payload.enrichmentCounts.no_website],
                    ["not_run", payload.enrichmentCounts.not_run],
                    ["queued", payload.enrichmentCounts.queued],
                  ]}
                />
              </div>
            </div>

            <BucketGroup
              title="Qualification counts"
              rows={[
                ["QUALIFIED", payload.qualificationCounts.QUALIFIED],
                [
                  "COMPANY_QUALIFIED_NEEDS_CONTACT",
                  payload.qualificationCounts.COMPANY_QUALIFIED_NEEDS_CONTACT,
                ],
                ["NEEDS_REVIEW", payload.qualificationCounts.NEEDS_REVIEW],
                ["UNQUALIFIED", payload.qualificationCounts.UNQUALIFIED],
                ["NOT_SCORED", payload.qualificationCounts.NOT_SCORED],
              ]}
            />

            {payload.diagnostics.unknownNonCanonicalQualificationCount > 0 ? (
              <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {payload.diagnostics.unknownNonCanonicalQualificationCount} linked lead
                assignments have non-canonical qualification values.
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Last refreshed {formatTime(state.kind === "ready" ? state.updatedAt : Date.now())}</span>
              <span>
                {pollInterval
                  ? `Polling every ${Math.round(pollInterval / 1000)}s`
                  : "Polling stopped after terminal state"}
              </span>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function buildSummary(payload: ProgressPayload) {
  const totalRows = Object.values(payload.rowStatusCounts).reduce(
    (total, count) => total + count,
    0
  );
  const appliedRows = payload.rowStatusCounts.APPLIED;
  const activeJobs = payload.jobs.filter((job) => !TERMINAL_STATUSES.has(job.status)).length;
  const scoredLeads =
    payload.qualificationCounts.QUALIFIED +
    payload.qualificationCounts.COMPANY_QUALIFIED_NEEDS_CONTACT +
    payload.qualificationCounts.NEEDS_REVIEW +
    payload.qualificationCounts.UNQUALIFIED;
  const notScoredLeads = payload.qualificationCounts.NOT_SCORED;
  const weightedJobs = payload.jobs.filter((job) => job.progressTotal !== null);
  const total = weightedJobs.reduce((sum, job) => sum + (job.progressTotal ?? 0), 0);
  const current = weightedJobs.reduce((sum, job) => sum + job.progressCurrent, 0);
  const fallbackPercent = totalRows > 0 ? Math.round((appliedRows / totalRows) * 100) : 0;
  const overallPercent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : fallbackPercent;

  return {
    activeJobs,
    appliedRows,
    notScoredLeads,
    overallPercent,
    scoredLeads,
    totalRows,
  };
}

function StageGroupRow({ stageGroup }: { stageGroup: ProgressPayload["groupedStages"][number] }) {
  const percent =
    stageGroup.progressTotal && stageGroup.progressTotal > 0
      ? Math.min(100, Math.round((stageGroup.progressCurrent / stageGroup.progressTotal) * 100))
      : null;

  const isComplete = stageGroup.total > 0 && stageGroup.total === (stageGroup.succeeded + stageGroup.failed + stageGroup.cancelled);
  const isRunning = stageGroup.running > 0;
  const isFailed = stageGroup.failed > 0;
  
  let status = "QUEUED";
  if (isComplete && !isFailed) status = "SUCCEEDED";
  else if (isComplete && isFailed) status = "FAILED";
  else if (isRunning) status = "RUNNING";
  else if (stageGroup.failed > 0 || stageGroup.retryScheduled > 0) status = "FAILED";

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {stageGroup.label}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground flex gap-2">
            <span>{stageGroup.total} jobs</span>
            {stageGroup.succeeded > 0 && <span className="text-emerald-600">{stageGroup.succeeded} ok</span>}
            {stageGroup.failed > 0 && <span className="text-red-600">{stageGroup.failed} failed</span>}
            {stageGroup.running > 0 && <span className="text-primary">{stageGroup.running} running</span>}
            {stageGroup.queued > 0 && <span>{stageGroup.queued} queued</span>}
          </div>
        </div>
        <StatusBadge status={status} />
      </div>
      {percent !== null ? <TaskProgressBar percent={percent} tone={status === "FAILED" ? "danger" : status === "SUCCEEDED" ? "success" : "info"} className="mt-3 h-1.5" /> : null}
      {stageGroup.latestErrorMessage ? (
        <div className="mt-2 text-xs text-red-700">
          {stageGroup.latestErrorCode ? `${stageGroup.latestErrorCode}: ` : ""}
          {stageGroup.latestErrorMessage}
        </div>
      ) : null}
    </div>
  );
}

function BucketGroup({
  rows,
  title,
}: {
  rows: Array<[string, number]>;
  title: string;
}) {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
        {title}
      </div>
      <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-md bg-muted/40 px-3 py-2">
            <div className="text-[11px] font-medium text-muted-foreground">
              {formatLabel(label)}
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({
  detail,
  label,
  tone = "neutral",
  value,
}: {
  detail: string;
  label: string;
  tone?: "danger" | "neutral" | "warning";
  value: number | string;
}) {
  const toneClass = {
    danger: "border-red-200 bg-red-50 text-red-900",
    neutral: "border-border bg-muted/40 text-foreground",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone];

  return (
    <div className={`rounded-md border px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)] ${toneClass}`}>
      <div className="text-[11px] font-semibold">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold">{value}</div>
      <div className="mt-1 text-xs opacity-80">{detail}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <TaskStatusPill status={status} className="rounded-md" />;
}

function formatLabel(value: string) {
  return humanizeTaskToken(value);
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
