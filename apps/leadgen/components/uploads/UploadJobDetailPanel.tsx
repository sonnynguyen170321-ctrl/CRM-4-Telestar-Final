"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, Download, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DrawerSection } from "@/components/shared/DrawerSection";
import { StatusBadge } from "@/components/shared/statusBadges";
import {
  enqueueUploadAiJobs,
  getUploadAiJobStatus,
  processNextAiJobForUpload,
  type UploadJobDetail,
  type UploadAiJobStatus,
  type UploadAiJobExample,
} from "@/lib/client/uploadJobs";

export function UploadJobDetailPanel({
  detail,
}: {
  detail: UploadJobDetail | null;
}) {
  const [aiActionStatus, setAiActionStatus] = useState<string | null>(null);
  const [aiActionError, setAiActionError] = useState<string | null>(null);
  const [aiJobStatusState, setAiJobStatusState] = useState<{
    uploadJobId: string;
    status: UploadAiJobStatus;
  } | null>(null);
  const [aiStatusLoading, setAiStatusLoading] = useState(false);
  const detailUploadJobId = detail?.uploadJob.id ?? null;

  const refreshAiStatus = useCallback(async () => {
    if (!detailUploadJobId) {
      return;
    }

    setAiStatusLoading(true);

    try {
      setAiJobStatusState({
        uploadJobId: detailUploadJobId,
        status: await getUploadAiJobStatus(detailUploadJobId),
      });
    } catch (error) {
      setAiActionError(
        error instanceof Error ? error.message : "AI status refresh failed."
      );
    } finally {
      setAiStatusLoading(false);
    }
  }, [detailUploadJobId]);

  useEffect(() => {
    const statusForPolling =
      aiJobStatusState?.uploadJobId === detailUploadJobId
        ? aiJobStatusState.status
        : detail?.aiJobStatus;

    if (!detail || !statusForPolling || isAiQueueTerminal(statusForPolling)) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void refreshAiStatus();
    }, 7000);

    return () => window.clearInterval(intervalId);
  }, [detail, detailUploadJobId, aiJobStatusState, refreshAiStatus]);

  if (!detail) {
    return (
      <aside className="rounded-xl border border-dashed bg-white p-4 text-sm text-muted-foreground">
        Select an upload job to inspect linked records, counts, and derived
        history.
      </aside>
    );
  }

  const latestExport = detail.recentExportJobs[0] ?? null;
  const currentDetail = detail;
  const currentAiStatus =
    aiJobStatusState?.uploadJobId === detail.uploadJob.id
      ? aiJobStatusState.status
      : detail.aiJobStatus;
  const queueSummary = getAiQueueSummary(currentAiStatus);
  const oldestPendingAt =
    currentAiStatus.oldestPendingAt ??
    currentAiStatus.oldestPendingJobCreatedAt;

  async function enqueueAi(
    scope: "uncertain_only" | "qualified_and_uncertain" | "all_active",
    options: {
      retryFailed?: boolean;
      retryScheduledNow?: boolean;
      maxRows?: number;
    } = {}
  ) {
    if (
      scope === "all_active" &&
      !window.confirm(
        "This will run AI in the background and may consume Gemini quota/cost. Official final export values still come from local scoring + SDR feedback. AI columns are optional second-opinion fields."
      )
    ) {
      return;
    }

    setAiActionStatus("Queueing AI jobs...");
    setAiActionError(null);

    try {
      const result = await enqueueUploadAiJobs({
        id: currentDetail.uploadJob.id,
        scope,
        retryFailed: options.retryFailed,
        retryScheduledNow: options.retryScheduledNow,
        maxRows: options.maxRows,
      });
      if (scope === "uncertain_only" && result.candidateCount === 0) {
        setAiActionStatus("No uncertain rows need AI.");
      } else {
        const queuedLabel =
          scope === "uncertain_only" ? "uncertain-row AI" : "AI";
        setAiActionStatus(
          `Queued ${(result.enqueued ?? 0).toLocaleString()} ${queuedLabel} job${
            (result.enqueued ?? 0) === 1 ? "" : "s"
          }. Requeued failed: ${(result.requeuedFailed ?? 0).toLocaleString()}; requeued retry: ${(result.requeuedRetryScheduled ?? 0).toLocaleString()}; skipped already assessed: ${(result.skippedAlreadyAssessed ?? 0).toLocaleString()}; duplicate jobs: ${(result.skippedDuplicateJob ?? 0).toLocaleString()}; cap skipped: ${(result.skippedDueToCapCount ?? 0).toLocaleString()} / max ${result.maxRowsPerUpload.toLocaleString()}.`
        );
      }
      await refreshAiStatus();
    } catch (error) {
      setAiActionError(
        error instanceof Error ? error.message : "AI enqueue failed."
      );
      setAiActionStatus(null);
    }
  }

  async function processNextAiJob() {
    setAiActionStatus("Processing next due AI job for this upload...");
    setAiActionError(null);

    try {
      const result = (await processNextAiJobForUpload(
        currentDetail.uploadJob.id
      )) as {
        processed?: number;
        succeeded?: number;
        failed?: number;
        retryScheduled?: number;
        cacheHits?: number;
        quotaPaused?: boolean;
        stoppedReason?: string | null;
        nextRetryAt?: string | null;
        total?: number;
        pending?: number;
        succeededTotal?: number;
      };
      const pauseCopy = result.quotaPaused
        ? ` AI paused: ${formatPausedReason(
            result.stoppedReason ?? "provider_quota_or_rate_limit"
          )}.`
        : "";
      setAiActionStatus(
        `Worker cycle processed ${(result.processed ?? 0).toLocaleString()} job(s): succeeded ${(result.succeeded ?? 0).toLocaleString()}, failed ${(result.failed ?? 0).toLocaleString()}, retry scheduled ${(result.retryScheduled ?? 0).toLocaleString()}. Cumulative succeeded ${(result.succeededTotal ?? 0).toLocaleString()} / ${(result.total ?? 0).toLocaleString()}.${pauseCopy}`
      );
      await refreshAiStatus();
    } catch (error) {
      setAiActionError(
        error instanceof Error ? error.message : "AI process-next failed."
      );
      setAiActionStatus(null);
    }
  }

  return (
    <aside className="space-y-4 rounded-xl border bg-white p-4 shadow-sm xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{detail.uploadJob.fileName}</h3>
          <p className="mt-1 break-all text-xs text-muted-foreground">
            Upload job ID: {detail.uploadJob.id}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge
            tone={detail.uploadJob.status === "FAILED" ? "danger" : "info"}
          >
            {detail.uploadJob.status.toLowerCase()}
          </StatusBadge>
          {detail.uploadJob.archivedAt && (
            <Badge variant="secondary">Archived</Badge>
          )}
          {detail.uploadJob.deletedAt && (
            <Badge variant="destructive">Deleted</Badge>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <Button asChild className="bg-blue-600 text-white hover:bg-blue-700">
          <a href={`/companies?uploadJobId=${detail.uploadJob.id}`}>
            <ExternalLink className="h-4 w-4" />
            Open Companies ({detail.counts.companyRecords.toLocaleString()})
          </a>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline">
            <a href={`/api/companies/export?uploadJobId=${detail.uploadJob.id}`}>
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => enqueueAi("uncertain_only")}
            disabled={!currentAiStatus.aiEnabled}
          >
            <Bot className="h-4 w-4" />
            Run AI for uncertain rows
          </Button>
        </div>
      </div>

      <div className="grid gap-2 text-sm">
        <SnapshotRow
          label="Rows"
          value={`${detail.uploadJob.processedRows.toLocaleString()} / ${detail.uploadJob.totalRows.toLocaleString()}`}
        />
        <SnapshotRow
          label="Created"
          value={formatDateTime(detail.uploadJob.createdAt)}
        />
        <SnapshotRow
          label="Updated"
          value={formatDateTime(detail.uploadJob.updatedAt)}
        />
        <SnapshotRow
          label="Uncertain rows"
          value={detail.uploadJob.uncertainRows.toLocaleString()}
        />
      </div>

      {detail.uploadJob.errorMessage && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
          <p className="text-sm font-medium text-destructive">Upload failed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.uploadJob.errorMessage}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Inspect details or delete this failed test upload. To redo the
            upload, upload the CSV again.
          </p>
        </div>
      )}

      <DrawerSection title="Linked counts" contentClassName="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <CountBox label="Companies" value={detail.counts.companyRecords} />
          <CountBox label="Scores" value={detail.counts.companyScoreResults} />
          <CountBox
            label="Research"
            value={detail.counts.websiteResearchResults}
          />
          <CountBox label="Feedback" value={detail.counts.feedbackExamples} />
          <CountBox label="Exports" value={detail.counts.exportJobs} />
        </div>
      </DrawerSection>

      <DrawerSection
        title="AI usage summary"
        description="AI assessments are second opinions. They do not replace local scoring or SDR feedback."
      >
        <div className="grid gap-2 text-sm md:grid-cols-2">
          <SnapshotRow
            label="AI assessments used"
            value={`${detail.aiUsageSummary.successfulAssessmentCount.toLocaleString()} / ${detail.aiUsageSummary.maxRowsPerUpload.toLocaleString()}`}
          />
          <SnapshotRow
            label="Remaining capacity"
            value={detail.aiUsageSummary.remainingCapacity.toLocaleString()}
          />
          <SnapshotRow
            label="Cap reached"
            value={detail.aiUsageSummary.capReached ? "Yes" : "No"}
          />
          <SnapshotRow
            label="Failed assessments"
            value={detail.aiUsageSummary.failedAssessmentCount.toLocaleString()}
          />
          <SnapshotRow
            label="Total tokens"
            value={formatNullableNumber(detail.aiUsageSummary.totalTokens)}
          />
          <SnapshotRow
            label="Average latency"
            value={
              detail.aiUsageSummary.averageLatencyMs === null
                ? "Not available"
                : `${detail.aiUsageSummary.averageLatencyMs.toLocaleString()} ms`
            }
          />
          <SnapshotRow label="Provider" value={detail.aiUsageSummary.provider} />
          <SnapshotRow label="Model" value={detail.aiUsageSummary.model} />
        </div>
      </DrawerSection>

      <DrawerSection title="AI assessment batch">
        <div className="space-y-4 rounded-xl border border-blue-100 bg-blue-50/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={queueSummary.tone}>
                  {queueSummary.label}
                </StatusBadge>
                <StatusBadge tone={getHealthTone(currentAiStatus.healthStatus)}>
                  {currentAiStatus.healthLabel ?? "Queue health"}
                </StatusBadge>
                <Badge variant="outline">
                  {currentAiStatus.provider} / {currentAiStatus.model}
                </Badge>
                <Badge variant="outline">{formatAiMode(currentAiStatus.mode)}</Badge>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {queueSummary.description} AI is second opinion only. Official
                results still come from local scoring + SDR review.
              </p>
              {!currentAiStatus.aiEnabled && currentAiStatus.aiStatusReason && (
                <p className="rounded-md border bg-white p-3 text-sm text-muted-foreground">
                  {currentAiStatus.aiStatusReason}
                </p>
              )}
              {(currentAiStatus.healthMessage ||
                currentAiStatus.recommendedAction) && (
                <div className="rounded-md border bg-white p-3 text-sm leading-6 text-muted-foreground">
                  {currentAiStatus.healthMessage && (
                    <p>{currentAiStatus.healthMessage}</p>
                  )}
                  {currentAiStatus.recommendedAction && (
                    <p className="font-medium text-slate-700">
                      Recommended: {currentAiStatus.recommendedAction}
                    </p>
                  )}
                </div>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshAiStatus()}
              disabled={aiStatusLoading}
            >
              {aiStatusLoading ? "Refreshing..." : "Refresh AI status"}
            </Button>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {currentAiStatus.succeeded.toLocaleString()} /{" "}
                {currentAiStatus.total.toLocaleString()} succeeded
              </span>
              <span>{currentAiStatus.progressPercent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-blue-600"
                style={{ width: `${Math.min(currentAiStatus.progressPercent, 100)}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {getAiProgressCopy(currentAiStatus)}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <CountChip
              label="Uncertain rows"
              value={currentDetail.uploadJob.uncertainRows}
            />
            <CountChip label="Total" value={currentAiStatus.total} />
            <CountChip label="Pending" value={currentAiStatus.pending} />
            <CountChip label="Running" value={currentAiStatus.running} />
            <CountChip label="Succeeded" value={currentAiStatus.succeeded} />
            <CountChip label="Retry" value={currentAiStatus.retryScheduled} />
            <CountChip label="Failed" value={currentAiStatus.failed} />
            <CountChip label="Skipped" value={currentAiStatus.skipped} />
            <CountChip label="Cache hits" value={currentAiStatus.cacheHitCount} />
          </div>

          {currentAiStatus.cap && (
            <div className="grid gap-2 text-sm md:grid-cols-3">
              <SnapshotRow
                label="AI cap used"
                value={`${currentAiStatus.cap.used.toLocaleString()} / ${currentAiStatus.cap.cap.toLocaleString()}`}
              />
              <SnapshotRow
                label="AI cap remaining"
                value={currentAiStatus.cap.remaining.toLocaleString()}
              />
              <SnapshotRow
                label="Cap reached"
                value={currentAiStatus.cap.capReached ? "Yes" : "No"}
              />
            </div>
          )}

          {currentAiStatus.budgetPaused && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              AI paused: daily request budget reached. Jobs are not failed and
              can continue when the budget window resets.
            </div>
          )}
          {currentAiStatus.quotaPaused && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              AI paused: provider quota/rate limit. Retry-scheduled jobs remain
              recoverable and will run when due.
            </div>
          )}
          {currentAiStatus.dailyRequestBudget !== undefined && (
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <SnapshotRow
                label="Daily AI budget"
                value={`${(
                  currentAiStatus.dailyRequestBudgetRemaining ?? 0
                ).toLocaleString()} / ${currentAiStatus.dailyRequestBudget.toLocaleString()} remaining`}
              />
              <SnapshotRow
                label="Paused reason"
                value={
                  currentAiStatus.pausedReason
                    ? formatPausedReason(currentAiStatus.pausedReason)
                    : "None"
                }
              />
            </div>
          )}
          {(currentAiStatus.nextAttemptAt ||
            currentAiStatus.lastErrorCode ||
            currentAiStatus.lastErrorMessage) && (
            <div className="grid gap-2 text-sm md:grid-cols-2">
              <SnapshotRow
                label="Next retry"
                value={
                  currentAiStatus.nextAttemptAt
                    ? formatDateTime(currentAiStatus.nextAttemptAt)
                    : "Not scheduled"
                }
              />
              <SnapshotRow
                label="Oldest pending"
                value={
                  oldestPendingAt
                    ? formatDateTime(oldestPendingAt)
                    : "None"
                }
              />
              <SnapshotRow
                label="Latest success"
                value={
                  currentAiStatus.latestSucceededAt
                    ? formatDateTime(currentAiStatus.latestSucceededAt)
                    : "None"
                }
              />
              <SnapshotRow
                label="Latest activity"
                value={
                  currentAiStatus.latestJobActivityAt
                    ? formatDateTime(currentAiStatus.latestJobActivityAt)
                    : "None"
                }
              />
              <SnapshotRow
                label="Last error code"
                value={
                  currentAiStatus.latestErrorCode ??
                  currentAiStatus.lastErrorCode ??
                  "None"
                }
              />
              <SnapshotRow
                label="Last error"
                value={
                  currentAiStatus.latestErrorMessage ??
                  currentAiStatus.lastErrorMessage ??
                  "None"
                }
              />
            </div>
          )}

          <details className="rounded-md border bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              AI job examples
            </summary>
            <div className="grid gap-3 border-t p-3">
              <AiJobExampleList
                title="Next pending jobs"
                empty="No pending jobs."
                jobs={currentAiStatus.latestPendingJobs}
              />
              <AiJobExampleList
                title="Running jobs"
                empty="No running jobs."
                jobs={currentAiStatus.latestRunningJobs}
              />
              <AiJobExampleList
                title="Recently completed"
                empty="No completed jobs yet."
                jobs={currentAiStatus.latestCompletedJobs}
              />
              <AiJobExampleList
                title="Failed / retry jobs"
                empty="No failed or retry jobs."
                jobs={currentAiStatus.latestFailedJobs}
              />
            </div>
          </details>

          <details className="rounded-md border bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              Worker hint
            </summary>
            <div className="border-t p-3 text-xs leading-5 text-muted-foreground">
              <code className="block break-all rounded bg-slate-100 px-2 py-1 text-slate-800">
                {currentAiStatus.workerHint}
              </code>
              <p className="mt-2">
                Queue means jobs are waiting. Worker means actual Gemini calls.
              </p>
              <div className="mt-3 space-y-2">
                <WorkerCommand
                  label="Local one-shot for this upload"
                  command={`npm run ai:worker -- --uploadJobId=${currentDetail.uploadJob.id} --once`}
                />
                <WorkerCommand
                  label="Local continuous for this upload"
                  command={`npm run ai:worker -- --uploadJobId=${currentDetail.uploadJob.id}`}
                />
                <WorkerCommand
                  label="Global continuous"
                  command="npm run ai:worker"
                />
              </div>
            </div>
          </details>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => enqueueAi("uncertain_only")}
              disabled={!currentAiStatus.aiEnabled}
            >
              <Bot className="h-4 w-4" />
              Run AI for uncertain rows
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                enqueueAi("all_active", {
                  retryFailed: true,
                  maxRows: 0,
                })
              }
              disabled={currentAiStatus.failed === 0}
            >
              Retry failed jobs
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                enqueueAi("all_active", {
                  retryScheduledNow: true,
                  maxRows: 0,
                })
              }
              disabled={currentAiStatus.retryScheduled === 0}
            >
              Requeue retry jobs now
            </Button>
            {currentAiStatus.adminProcessUiEnabled ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void processNextAiJob()}
              >
                Process next AI job now
              </Button>
            ) : (
              <span className="rounded-md border bg-white px-3 py-2 text-xs text-muted-foreground">
                Processing is handled by the background worker. Start it with
                the upload-specific command below.
              </span>
            )}
          </div>
        </div>
        {aiActionStatus && (
          <p className="text-xs font-medium text-emerald-700">{aiActionStatus}</p>
        )}
        {aiActionError && (
          <p className="text-xs font-medium text-destructive">{aiActionError}</p>
        )}
      </DrawerSection>

      <details className="rounded-md border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          History / updates
        </summary>
        <div className="grid gap-2 border-t p-4 text-sm">
            <SnapshotRow label="Uploaded at" value={formatDateTime(detail.uploadJob.createdAt)} />
            <SnapshotRow label="Completed at" value="Not tracked yet" />
            <SnapshotRow
              label="Archived at"
              value={formatOptionalDateTime(detail.uploadJob.archivedAt)}
            />
            <SnapshotRow
              label="Deleted at"
              value={formatOptionalDateTime(detail.uploadJob.deletedAt)}
            />
            <SnapshotRow
              label="Latest score result"
              value={
                detail.latestScoreResult
                  ? formatDateTime(detail.latestScoreResult.createdAt)
                  : "No score result saved"
              }
            />
            <SnapshotRow
              label="Latest feedback"
              value={
                detail.latestFeedbackExample
                  ? formatDateTime(detail.latestFeedbackExample.createdAt)
                  : "No feedback saved"
              }
            />
            <SnapshotRow
              label="Latest export"
              value={
                latestExport
                  ? `${latestExport.fileName} at ${formatDateTime(latestExport.createdAt)}`
                  : "No export job saved"
              }
            />
        </div>
      </details>

      <details className="rounded-md border bg-background">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Recent company records
        </summary>
        <div className="border-t p-4">
        {detail.recentCompanyRecords.length > 0 ? (
          <div className="grid gap-2">
            {detail.recentCompanyRecords.map((record) => (
              <div key={record.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap justify-between gap-3">
                  <span className="font-medium">{record.companyName}</span>
                  <span className="text-xs text-muted-foreground">
                    Row{" "}
                    {record.sourceRowIndex === null
                      ? "unknown"
                      : record.sourceRowIndex + 1}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {record.website || "No website"} /{" "}
                  {record.companyCountry || "No country"} /{" "}
                  {record.companyIndustry || "No industry"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No company records saved for this upload.
          </p>
        )}
        </div>
      </details>
    </aside>
  );
}

function SnapshotRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 rounded-md border px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function CountBox({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value.toLocaleString()}</p>
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-md border bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
      {label}: {value.toLocaleString()}
    </span>
  );
}

function WorkerCommand({
  label,
  command,
}: {
  label: string;
  command: string;
}) {
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-500">{label}</p>
      <code className="mt-1 block break-all rounded bg-slate-100 px-2 py-1 text-slate-800">
        {command}
      </code>
    </div>
  );
}

function AiJobExampleList({
  title,
  empty,
  jobs,
}: {
  title: string;
  empty: string;
  jobs: UploadAiJobExample[];
}) {
  return (
    <div className="rounded-md border bg-white p-3">
      <p className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </p>
      {jobs.length > 0 ? (
        <div className="mt-2 space-y-2">
          {jobs.map((job) => (
            <div
              key={`${job.companyRecordId}-${job.status}-${job.updatedAt}`}
              className="rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{job.companyName}</span>
                <div className="flex flex-wrap gap-1">
                  <StatusBadge tone={getJobTone(job.status)}>
                    {formatJobStatus(job.status)}
                  </StatusBadge>
                  {job.cacheHit && (
                    <StatusBadge tone="success">Cache hit</StatusBadge>
                  )}
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatJobTimestamp(job)}
              </p>
              {(job.lastErrorCode || job.lastErrorMessage) && (
                <p className="mt-1 line-clamp-2 text-xs text-amber-700">
                  {[job.lastErrorCode, job.lastErrorMessage]
                    .filter(Boolean)
                    .join(": ")}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function formatOptionalDateTime(value: string | null) {
  return value ? formatDateTime(value) : "Not set";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatNullableNumber(value: number | null) {
  return value === null ? "Not available" : value.toLocaleString();
}

function getAiQueueSummary(status: UploadJobDetail["aiJobStatus"]): {
  label: string;
  description: string;
  tone: "success" | "warning" | "danger" | "neutral" | "info";
} {
  if (status.actionableState === "disabled") {
    return {
      label: "AI disabled",
      description: "AI is disabled in runtime settings.",
      tone: "neutral",
    };
  }

  if (status.actionableState === "quota_blocked") {
    if (status.budgetPaused) {
      return {
        label: "Budget paused",
        description: "AI paused: daily request budget reached.",
        tone: "warning",
      };
    }

    return {
      label: "Quota/rate limited",
      description: "AI paused: provider quota/rate limit.",
      tone: "warning",
    };
  }

  if (status.total > 0 && status.succeeded === status.total && status.pending === 0 && status.running === 0 && status.retryScheduled === 0) {
    return {
      label: "AI completed",
      description: "All queued AI jobs for this upload have completed.",
      tone: "success",
    };
  }

  if (status.running > 0) {
    return {
      label: "AI processing",
      description: "One or more AI jobs are currently running.",
      tone: "info",
    };
  }

  if (status.retryScheduled > 0) {
    return {
      label: "AI waiting for retry",
      description:
        "Some AI jobs are waiting for provider quota or rate-limit recovery.",
      tone: "warning",
    };
  }

  if (status.failed > 0) {
    return {
      label: "AI failed for some rows",
      description: "Some AI jobs failed. Local scoring and SDR review still work.",
      tone: "danger",
    };
  }

  if (status.succeeded > 0 && status.pending > 0) {
    return {
      label: "AI partially completed",
      description: "Some AI jobs completed and others are still waiting.",
      tone: "info",
    };
  }

  if (status.pending > 0) {
    return {
      label: "AI queued",
      description: "AI jobs were created and are waiting to process.",
      tone: "info",
    };
  }

  return {
    label: "No AI jobs",
    description: "No AI queue jobs exist for this upload yet.",
    tone: "neutral",
  };
}

function getAiProgressCopy(status: UploadJobDetail["aiJobStatus"]) {
  if (status.total === 0) {
    if (status.aiEnabled && status.uploadJobId) {
      return "No AI jobs yet. Run AI for uncertain rows after local scoring is saved.";
    }

    return "AI has not been requested for this upload yet.";
  }

  if (status.budgetPaused) {
    return "AI paused by daily budget.";
  }

  if (status.quotaPaused) {
    return "AI paused by provider quota/rate limit.";
  }

  if (status.pending > 0 && status.succeeded === 0 && status.running === 0) {
    return "Queued, waiting for background worker.";
  }

  if (status.running > 0) {
    return "AI is processing.";
  }

  if (status.succeeded > 0 && status.pending > 0) {
    return "Partially completed.";
  }

  if (
    status.total > 0 &&
    status.succeeded === status.total &&
    status.pending === 0 &&
    status.running === 0 &&
    status.retryScheduled === 0
  ) {
    return "AI completed.";
  }

  if (status.retryScheduled > 0) {
    return "Waiting for retry.";
  }

  if (status.failed > 0) {
    return "AI failed for some rows.";
  }

  return "AI queue status is available.";
}

function formatAiMode(value: string) {
  if (value === "all_companies") return "all companies";
  if (value === "uncertain_only") return "uncertain only";

  return value.replaceAll("_", " ");
}

function formatPausedReason(value: string) {
  if (value === "daily_request_budget_reached") {
    return "Daily request budget reached";
  }

  if (value === "provider_quota_or_rate_limit") {
    return "Provider quota/rate limit";
  }

  return value.replaceAll("_", " ");
}

function getJobTone(status: string) {
  if (status === "succeeded") return "success";
  if (status === "failed") return "danger";
  if (status === "retry_scheduled") return "warning";
  if (status === "running") return "info";

  return "neutral";
}

function getHealthTone(
  status: UploadJobDetail["aiJobStatus"]["healthStatus"]
) {
  if (status === "healthy") return "success";
  if (status === "busy") return "info";
  if (status === "quota_paused") return "warning";
  if (status === "budget_paused") return "warning";
  if (status === "worker_likely_not_running") return "warning";
  if (status === "blocked") return "danger";
  if (status === "needs_manual_retry") return "danger";

  return "neutral";
}

function formatJobStatus(status: string) {
  if (status === "retry_scheduled") return "retry";
  return status.replaceAll("_", " ");
}

function formatJobTimestamp(job: UploadAiJobExample) {
  if (job.completedAt) return `Completed ${formatDateTime(job.completedAt)}`;
  if (job.startedAt) return `Started ${formatDateTime(job.startedAt)}`;
  if (job.nextAttemptAt) return `Next attempt ${formatDateTime(job.nextAttemptAt)}`;

  return `Created ${formatDateTime(job.createdAt)}`;
}

function isAiQueueTerminal(status: UploadJobDetail["aiJobStatus"]) {
  return (
    status.total > 0 &&
    status.succeeded === status.total &&
    status.pending === 0 &&
    status.running === 0 &&
    status.retryScheduled === 0
  );
}
