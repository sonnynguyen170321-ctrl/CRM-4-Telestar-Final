import "server-only";

import { summarizeJobs, type JobOpsRow, type JobsSummary } from "./jobOps";

// R3: thin tenant-scoped loader for the jobs ops surface. Loads recent V2Job rows
// + the summary (by status/type, stuck-queued). Read path only; mutations go
// through the retry/cancel server actions.

export type JobsOpsView = {
  rows: Array<JobOpsRow & { errorMessage: string | null; updatedAt: Date }>;
  summary: JobsSummary;
};

export async function queryJobsOps(organizationId: string, limit = 200): Promise<JobsOpsView> {
  const { prisma } = await import("@/lib/server/prisma");
  const rows = await prisma.$queryRawUnsafe<JobsOpsView["rows"]>(
    `SELECT "id", "jobType"::text AS "jobType", "status"::text AS "status", "retryCount",
            "createdAt", "nextAttemptAt", "errorMessage", "updatedAt"
     FROM "V2Job"
     WHERE "organizationId" = $1
     ORDER BY "updatedAt" DESC
     LIMIT ${Math.max(1, Math.min(500, limit))}`,
    organizationId
  );
  return { rows, summary: summarizeJobs(rows) };
}
