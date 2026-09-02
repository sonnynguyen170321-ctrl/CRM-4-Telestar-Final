import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import type { V2JobDatabase, V2JobType } from "@/lib/v2/jobs/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const context = await requirePermission("ingestion.apply");
    const { jobId } = await params;

    // Verify ingestion job belongs to tenant
    const ingestionJob = await prisma.v2IngestionJob.findUnique({
      where: {
        id: jobId,
        organizationId: context.organizationId,
      },
    });

    if (!ingestionJob) {
      return NextResponse.json({ error: "Ingestion job not found" }, { status: 404 });
    }

    const MAX_LOOP = 200;
    const TIME_LIMIT_MS = 10000; // 10 seconds limit to avoid Vercel timeout
    const WORKER_COUNT = 5;
    const startTime = Date.now();
    const db = prisma as unknown as V2JobDatabase;
    let processed = 0;
    let stoppedReason: "idle" | "max_reached" | "timeout_approaching" = "idle";
    const summary: Record<string, { succeeded: number; failed: number; retry_scheduled: number }> = {};

    // Drain the WHOLE pipeline for this run, in claim scopes that together cover
    // every stage: (1) jobs bound to this ingestion job (parse->...->upsert, plus
    // enrichment+scoring now bound to this batch), then the (2) COMPANY_ENRICHMENT
    // and (3) ICP_SCORE tail by org — which also drains legacy MANUAL-scoped
    // enrichment/scoring jobs that predate the ingestion binding. Without (2)/(3)
    // the enrichment->scoring tail is unreachable from the run control and every
    // lead stays unscored (the pipeline-linkage leak this route now closes).
    const drainScopes: Array<{ ingestionJobId?: string; jobType?: V2JobType }> = [
      { ingestionJobId: jobId },
      { jobType: "COMPANY_ENRICHMENT" },
      { jobType: "ICP_SCORE" },
    ];

    for (const scope of drainScopes) {
      if (stoppedReason !== "idle") break;

      const workers = Array(WORKER_COUNT).fill(0).map(async () => {
        for (;;) {
          if (processed >= MAX_LOOP) {
            stoppedReason = "max_reached";
            break;
          }
          if (Date.now() - startTime > TIME_LIMIT_MS) {
            stoppedReason = "timeout_approaching";
            break;
          }

          const result = await processNextV2Job(db, {
            organizationId: context.organizationId,
            ...scope,
          });

          if (!result || result.kind === "no_job") {
            break; // this scope is idle for this worker; move to the next drain scope
          }

          processed++;
          const jobType = result.job.jobType;
          if (!summary[jobType]) {
            summary[jobType] = { succeeded: 0, failed: 0, retry_scheduled: 0 };
          }
          if (result.kind === "succeeded") summary[jobType].succeeded++;
          if (result.kind === "failed") summary[jobType].failed++;
          if (result.kind === "retry_scheduled") summary[jobType].retry_scheduled++;
        }
      });

      await Promise.all(workers);
    }

    return NextResponse.json({
      ok: true,
      processed,
      stoppedReason,
      summary,
    });
  } catch (error) {
    console.error("runUntilIdle error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
