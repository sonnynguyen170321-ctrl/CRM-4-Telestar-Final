import { prisma } from "@/lib/server/prisma";
import type { V2IngestionJobStatus } from "@/app/generated/prisma/enums";

export type UploadsDashboardMetrics = {
  totalUploads: { value: number; trendPct: number };
  processing: { value: number; queued: number };
  completed: { value: number; trendPct: number };
  failed: { value: number; trendPct: number };
  archived: { value: number };
  rowsProcessed: { value: number; trendPct: number };
};

export type UploadJobInfo = {
  id: string;
  originalFileName: string;
  uploadedBy: string | null;
  uploadedByInitials: string;
  rowsCount: number;
  createdAt: Date;
  status: V2IngestionJobStatus;
  statusPercent: number; // mock for now
  websiteResearchReady: number;
  localScoringReady: number;
  aiStatusReady: number;
  reviewed: number;
};

export async function queryUploadsDashboard(organizationId: string) {
  // 1. Fetch metrics
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    allJobs,
    pastJobs,
  ] = await Promise.all([
    prisma.v2IngestionJob.findMany({
      where: { organizationId },
      include: { uploadedByUser: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.v2IngestionJob.count({
      where: { organizationId, createdAt: { lte: thirtyDaysAgo } }
    })
  ]);

  const totalUploads = allJobs.length;
  const processingJobs = allJobs.filter(j => j.status === "PENDING" || j.status === "PROCESSING");
  const completedJobs = allJobs.filter(j => j.status === "COMPLETED" || j.status === "PARTIAL");
  const failedJobs = allJobs.filter(j => j.status === "FAILED");
  const archivedJobs = allJobs.filter(j => j.status === "ABANDONED");

  // we can parse rowCountsJson if we want true row counts
  let rowsProcessedTotal = 0;
  for (const job of allJobs) {
    if (job.rowCountsJson && typeof job.rowCountsJson === "object") {
      const counts = job.rowCountsJson as { total?: number };
      if (counts.total) rowsProcessedTotal += counts.total;
    }
  }

  // derive trends (very simplified mock trend math for demo purposes)
  const calcTrend = (current: number, past: number) => {
    if (past === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - past) / past) * 100);
  };

  const metrics: UploadsDashboardMetrics = {
    totalUploads: { value: totalUploads, trendPct: calcTrend(totalUploads, pastJobs) },
    processing: { value: processingJobs.length, queued: processingJobs.filter(j => j.status === "PENDING").length },
    completed: { value: completedJobs.length, trendPct: calcTrend(completedJobs.length, pastJobs / 2) },
    failed: { value: failedJobs.length, trendPct: calcTrend(failedJobs.length, pastJobs / 10) },
    archived: { value: archivedJobs.length },
    rowsProcessed: { value: rowsProcessedTotal, trendPct: calcTrend(rowsProcessedTotal, 100) },
  };

  const jobs: UploadJobInfo[] = allJobs.map(job => {
    let rowsCount = 0;
    if (job.rowCountsJson && typeof job.rowCountsJson === "object") {
      rowsCount = (job.rowCountsJson as { total?: number }).total || 0;
    }

    const userName = job.uploadedByUser?.name || "Unknown User";
    const initials = userName.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase();

    // mock stats for the table columns (Website Research, Local Scoring, AI Status)
    const isCompleted = job.status === "COMPLETED";
    const isProcessing = job.status === "PROCESSING";

    return {
      id: job.id,
      originalFileName: job.originalFileName,
      uploadedBy: job.uploadedByUser?.name || null,
      uploadedByInitials: initials,
      rowsCount,
      createdAt: job.createdAt,
      status: job.status,
      statusPercent: isCompleted ? 100 : (isProcessing ? 32 : 0),
      websiteResearchReady: isCompleted ? rowsCount : (isProcessing ? Math.floor(rowsCount * 0.3) : 0),
      localScoringReady: isCompleted ? rowsCount : 0,
      aiStatusReady: isCompleted ? rowsCount : 0,
      reviewed: isCompleted ? Math.floor(rowsCount * 0.8) : 0,
    };
  });

  return { metrics, jobs };
}
