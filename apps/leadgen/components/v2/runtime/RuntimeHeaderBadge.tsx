import Link from "next/link";

import type { RuntimeRunStatusView, RuntimeStatus } from "@/lib/v2/runtime/types";
import { getTaskTransitionView, taskToneClasses } from "@/components/v2/shared/taskTransition";

// P6: a compact runtime pill for a page header. Shows the latest run's status + progress
// and links to the full score-run status page. Presentational only; the page queries
// queryLatestRuntimeRun and passes the view (or null = render nothing).

export function RuntimeHeaderBadge({ view }: { view: RuntimeRunStatusView | null }) {
  if (!view) return null;
  const { run, chunks, progressPercent } = view;
  const status = getTaskTransitionView(run.status as RuntimeStatus);
  const tone = taskToneClasses(status.tone);

  return (
    <Link
      href={`/v2/workspace/leads/score-run?runId=${run.id}`}
      title={`${run.processedUnits}/${run.totalUnits} processed${chunks.failed > 0 ? ` - ${chunks.failed} failed` : ""}`}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20 ${tone.pill}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {status.inFlight ? <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${tone.dot} opacity-60 motion-reduce:animate-none`} /> : null}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      </span>
      <span>{status.label}</span>
      {status.inFlight ? <span className="tabular-nums opacity-80">{progressPercent}%</span> : null}
      {chunks.failed > 0 ? <span className="tabular-nums text-red-600">- {chunks.failed} failed</span> : null}
    </Link>
  );
}