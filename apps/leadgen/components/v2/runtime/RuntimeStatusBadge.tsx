import type { RuntimeRunStatusView, RuntimeStatus } from "@/lib/v2/runtime/types";
import { getTaskTransitionView, TaskProgressBar, TaskStatusPill } from "@/components/v2/shared/taskTransition";

// R2 (precursor to P6): presentational runtime status. Given a run view, render a
// status pill + a progress bar. No data fetching here.

export function RuntimeStatusBadge({ view }: { view: RuntimeRunStatusView }) {
  const { run, chunks, progressPercent } = view;
  const status = getTaskTransitionView(run.status as RuntimeStatus);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <TaskStatusPill status={run.status} />
        <span className="text-sm tabular-nums text-muted-foreground">
          {run.processedUnits.toLocaleString()} / {run.totalUnits.toLocaleString()} processed
        </span>
      </div>
      <TaskProgressBar percent={progressPercent} tone={status.tone} className="h-2.5" />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{progressPercent}%</span>
        <span>{chunks.succeeded} completed</span>
        {chunks.running > 0 ? <span>{chunks.running} running</span> : null}
        {chunks.queued > 0 ? <span>{chunks.queued} queued</span> : null}
        {chunks.failed > 0 ? <span className="text-red-600">{chunks.failed} failed</span> : null}
      </div>
    </div>
  );
}