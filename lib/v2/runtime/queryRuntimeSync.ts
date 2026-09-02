import "server-only";

import { prisma } from "@/lib/server/prisma";

// Shared tenant-scoped runtime-sync query behind BOTH the poll route (/v2/api/runtime/sync) and the
// SSE stream route (/v2/api/runtime/stream). Keeping it in one place means the two transports can
// never drift on what "a mutation happened" means or which terminal jobs to surface.
//
// V2Job and V2RuntimeRun are runtime tables with NO soft-delete column — do NOT filter deletedAt
// (that was a live P0: the column doesn't exist, so every poll 500'd and broke notifications).

export type RuntimeSyncJob = {
  id: string;
  jobType: string;
  status: string;
  progressTotal: number | null;
};

export type RuntimeSyncState = {
  lastMutationTimestamp: number;
  completedJobs: RuntimeSyncJob[];
};

/**
 * Highest `updatedAt` across V2Job + V2RuntimeRun for the org (the "something changed" clock), plus
 * the terminal (SUCCEEDED/FAILED) jobs updated since `since` (for completion toasts). When `since`
 * is null we return only the clock, no jobs — the caller uses it to establish a baseline without
 * toasting pre-existing terminal jobs.
 */
export async function queryRuntimeSync(
  organizationId: string,
  since: Date | null
): Promise<RuntimeSyncState> {
  const [jobRows, runRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ maxAt: Date | null }>>(
      `SELECT MAX("updatedAt") as "maxAt" FROM "V2Job" WHERE "organizationId" = $1`,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ maxAt: Date | null }>>(
      `SELECT MAX("updatedAt") as "maxAt" FROM "V2RuntimeRun" WHERE "organizationId" = $1`,
      organizationId
    ),
  ]);

  const jobMax = jobRows[0]?.maxAt?.getTime() ?? 0;
  const runMax = runRows[0]?.maxAt?.getTime() ?? 0;
  const lastMutationTimestamp = Math.max(jobMax, runMax);

  let completedJobs: RuntimeSyncJob[] = [];
  if (since) {
    completedJobs = await prisma.$queryRawUnsafe<RuntimeSyncJob[]>(
      `SELECT id, "jobType", status, "progressTotal" FROM "V2Job"
       WHERE "organizationId" = $1 AND "updatedAt" > $2 AND status IN ('SUCCEEDED', 'FAILED')`,
      organizationId,
      since
    );
  }

  return { lastMutationTimestamp, completedJobs };
}
