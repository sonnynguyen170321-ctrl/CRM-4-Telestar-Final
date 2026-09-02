// R3: jobs operations read-model + safe retry/cancel decisions. Pure; the route
// loads tenant-scoped V2Job rows and applies the decisions.

export type JobOpsRow = {
  id: string;
  jobType: string;
  status: string;
  retryCount: number;
  createdAt: Date | string;
  nextAttemptAt?: Date | string | null;
};

export type JobsSummary = {
  byStatus: Record<string, number>;
  byType: Record<string, { total: number; failed: number; queued: number; running: number; retry: number }>;
  totals: { total: number; queued: number; running: number; failed: number; retryScheduled: number; succeeded: number };
  stuckQueued: number; // QUEUED older than the stale threshold
};

const STUCK_QUEUED_MS = 15 * 60 * 1000;

export function summarizeJobs(rows: readonly JobOpsRow[], now: Date = new Date()): JobsSummary {
  const byStatus: Record<string, number> = {};
  const byType: JobsSummary["byType"] = {};
  const totals = { total: 0, queued: 0, running: 0, failed: 0, retryScheduled: 0, succeeded: 0 };
  let stuckQueued = 0;

  for (const r of rows) {
    totals.total++;
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byType[r.jobType] ??= { total: 0, failed: 0, queued: 0, running: 0, retry: 0 };
    byType[r.jobType].total++;

    if (r.status === "QUEUED") {
      totals.queued++;
      byType[r.jobType].queued++;
      const created = r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt);
      if (now.getTime() - created.getTime() > STUCK_QUEUED_MS) stuckQueued++;
    } else if (r.status === "RUNNING") {
      totals.running++;
      byType[r.jobType].running++;
    } else if (r.status === "FAILED") {
      totals.failed++;
      byType[r.jobType].failed++;
    } else if (r.status === "RETRY_SCHEDULED") {
      totals.retryScheduled++;
      byType[r.jobType].retry++;
    } else if (r.status === "SUCCEEDED") {
      totals.succeeded++;
    }
  }

  return { byStatus, byType, totals, stuckQueued };
}

export type JobActionResult = { ok: boolean; reason?: string; nextStatus?: "QUEUED" | "CANCELLED" };

/** FAILED / RETRY_SCHEDULED / CANCELLED jobs may be retried (reset to QUEUED). Cancelling stays
 *  limited to QUEUED / RETRY_SCHEDULED (see decideCancel), so a deliberately cancelled job can be
 *  intentionally re-run. */
export function decideRetry(job: Pick<JobOpsRow, "status">): JobActionResult {
  if (job.status === "FAILED" || job.status === "RETRY_SCHEDULED" || job.status === "CANCELLED") {
    return { ok: true, nextStatus: "QUEUED" };
  }
  return { ok: false, reason: `cannot retry a ${job.status} job` };
}

/** Only QUEUED / RETRY_SCHEDULED jobs may be cancelled. Never cancel RUNNING. */
export function decideCancel(job: Pick<JobOpsRow, "status">): JobActionResult {
  if (job.status === "QUEUED" || job.status === "RETRY_SCHEDULED") {
    return { ok: true, nextStatus: "CANCELLED" };
  }
  return { ok: false, reason: `cannot cancel a ${job.status} job` };
}
