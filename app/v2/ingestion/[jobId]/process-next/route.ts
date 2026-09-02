import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission } from "@/lib/v2/tenant/requireTenantContext";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";

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

    const result = await processNextV2Job(prisma as unknown as V2JobDatabase, {
      organizationId: context.organizationId,
      ingestionJobId: jobId,
    });

    if (result.kind === "no_job") {
      return NextResponse.json({ ok: true, result: "no_job" });
    }

    return NextResponse.json({
      ok: true,
      result: result.kind,
      job: {
        id: result.job.id,
        jobType: result.job.jobType,
        finalStatus: result.job.status,
        errorCode: result.job.errorCode,
        errorMessage: result.job.errorMessage,
      },
    });
  } catch (error) {
    console.error("processNextV2Job error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
