import { PageHeader } from "@/components/shared/PageHeader";
import { ImportNav } from "@/components/v2/shell/WorkspaceClusterNav";
import { PanelCard } from "@/components/shared/PanelCard";
import { MetricCard } from "@/components/shared/MetricCard";
import { WorkspaceFrame } from "@/components/shared/WorkspaceFrame";
import { WorkspaceMetricGrid } from "@/components/shared/WorkspaceMetricGrid";
import { JobsTable } from "@/components/v2/jobs/JobsTable";
import { queryJobsOps } from "@/lib/v2/jobs/ops/queryJobsOps";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

// R3 / U2 surface: Jobs operations. Binds queryJobsOps (summary + recent rows);
// retry/cancel via safe server actions (only valid state transitions).

export default async function V2JobsPage() {
  const context = await getJobsContext();
  if (context instanceof V2TenantError) {
    const msg = getTenantErrorMessage(context);
    return (
      <WorkspaceFrame>
        <div className="max-w-xl rounded-lg border border-hairline bg-surface p-6 shadow-sm">
          <div className="text-sm font-semibold text-foreground">{msg.title}</div>
          <p className="mt-2 text-sm text-muted-foreground">{msg.message}</p>
        </div>
      </WorkspaceFrame>
    );
  }

  const { rows, summary } = await queryJobsOps(context.organizationId);

  return (
    <WorkspaceFrame className="p-0 sm:p-0 lg:px-0 lg:py-0">
      <PageHeader
        title="Jobs"
        description="Async pipeline jobs — drained by the run control / O5s worker (no daemon by default)."
      />

      <div className="space-y-5 p-5 sm:p-6">
        <ImportNav />
        <WorkspaceMetricGrid>
          <MetricCard label="Total (recent)" value={summary.totals.total} />
          <MetricCard label="Queued" value={summary.totals.queued} description={summary.stuckQueued > 0 ? `${summary.stuckQueued} stuck` : undefined} />
          <MetricCard label="Failed" value={summary.totals.failed} />
          <MetricCard label="Retry scheduled" value={summary.totals.retryScheduled} />
        </WorkspaceMetricGrid>

        <PanelCard title="Recent jobs" description="Retry a failed, cancelled, or retry-scheduled job; cancel only queued work. Running jobs are never cancelled." contentClassName="p-0">
          <JobsTable rows={rows.map((r) => ({ id: r.id, jobType: r.jobType, status: r.status, retryCount: r.retryCount, updatedAt: new Date(r.updatedAt).toISOString(), errorMessage: r.errorMessage }))} />
        </PanelCard>
      </div>
    </WorkspaceFrame>
  );
}

async function getJobsContext() {
  try {
    return await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) return error;
    throw error;
  }
}
