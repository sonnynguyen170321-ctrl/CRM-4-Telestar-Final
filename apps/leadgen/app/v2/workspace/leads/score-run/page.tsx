import Link from "next/link";
import { ChevronLeft, RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/shared/PageHeader";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { RuntimeStatusBadge } from "@/components/v2/runtime/RuntimeStatusBadge";
import { queryRuntimeRun } from "@/lib/v2/runtime/queryRuntimeStatus";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { retryScoringRunAction } from "./actions";

// R2 SEE-IT: async scoring-run status. The rescore action no longer drains jobs inline —
// it plans a run + enqueues, then redirects here. This page polls the V2RuntimeRun mirror
// (meta-refresh while in flight) so the SDR watches progress without a frozen request.

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ScoreRunPage({ searchParams }: Props) {
  const params = await searchParams;
  const runId = first(params.runId);
  const projectId = first(params.projectId);
  const icpVersionId = first(params.icpVersionId);

  const context = await getContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-border bg-white p-6">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const view = runId ? await queryRuntimeRun(context.organizationId, runId) : null;
  const inFlight = view ? view.run.status === "RUNNING" || view.run.status === "QUEUED" : false;
  const leadsHref = projectId && icpVersionId
    ? `/v2/workspace/leads?projectId=${projectId}&icpVersionId=${icpVersionId}`
    : "/v2/workspace/leads";

  return (
    <WorkspaceFrame>
      {/* While in flight, refresh every 3s to poll the mirror (no client JS needed). */}
      {inFlight ? <meta httpEquiv="refresh" content="3" /> : null}
      <PageHeader eyebrow="Leadger" title="Scoring run" description="Async ICP scoring. Progress streams from the runtime mirror." />
      <main className="mt-6">
        <div className="mx-auto max-w-lg rounded-xl border border-border bg-white p-6 shadow-sm">
          {!view ? (
            <div className="text-sm text-muted-foreground">Run not found.</div>
          ) : (
            <>
              <RuntimeStatusBadge view={view} />
              <p className="mt-4 text-xs text-muted-foreground">
                {inFlight
                  ? "This page refreshes automatically while scoring runs."
                  : "Scoring finished. Open the leads workspace to review results."}
              </p>
              {/* Re-fan failed chunks (bull path). Only offered once the run has settled
                  with failures — retrying mid-flight would race the live workers. */}
              {!inFlight && view.chunks.failed > 0 ? (
                <form action={retryScoringRunAction} className="mt-4 rounded-lg border border-red-100 bg-red-50/60 p-3">
                  <div className="text-xs font-medium text-red-700">
                    {view.chunks.failed} chunk{view.chunks.failed === 1 ? "" : "s"} failed.
                  </div>
                  <input type="hidden" name="runId" value={view.run.id} />
                  {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
                  {icpVersionId ? <input type="hidden" name="icpVersionId" value={icpVersionId} /> : null}
                  <button
                    type="submit"
                    className="mt-2 inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-red-700"
                  >
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Retry failed chunks
                  </button>
                </form>
              ) : null}
            </>
          )}
          <div className="mt-6 flex items-center justify-between">
            <Link href={leadsHref} className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" /> Back to leads
            </Link>
            <Link href={leadsHref} className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-white hover:bg-primary">
              View leads
            </Link>
          </div>
        </div>
      </main>
    </WorkspaceFrame>
  );
}

async function getContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
