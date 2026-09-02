import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { ensureResearchRunHasQueuedBatch, getResearchRunProgress } from "@/lib/v2/research/progress";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

const PROCESS_BUDGET_MS = 8000;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const ctx = await requirePermission("ingestion.apply");
    const { runId } = await params;
    const initial = await ensureResearchRunHasQueuedBatch(ctx.organizationId, runId);
    if (!initial) return NextResponse.json({ ok: false, error: "Research run not found." }, { status: 404 });

    const started = Date.now();
    let processed = 0;
    while (Date.now() - started < PROCESS_BUDGET_MS - 1200) {
      // Drain discovery batches first, then the auto-enrich jobs they queued — both scoped to
      // this run so other runs stay untouched.
      let result = await processNextV2Job(prisma as unknown as V2JobDatabase, {
        organizationId: ctx.organizationId,
        jobType: "RESEARCH_DISCOVERY",
        sourceType: "MANUAL",
        sourceId: runId,
      });
      if (result.kind === "no_job") {
        result = await processNextV2Job(prisma as unknown as V2JobDatabase, {
          organizationId: ctx.organizationId,
          jobType: "RESEARCH_ENRICH",
          sourceType: "MANUAL",
          sourceId: runId,
        });
      }
      if (result.kind === "no_job") break;
      processed += 1;
      if (result.kind === "failed" || result.kind === "retry_scheduled") break;
    }

    const progress = await getResearchRunProgress(ctx.organizationId, runId);
    return NextResponse.json({ ...progress, processed });
  } catch (error) {
    if (error instanceof V2TenantError) {
      const msg = getTenantErrorMessage(error);
      return NextResponse.json({ ok: false, error: msg.message }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: "Failed to process research run." }, { status: 500 });
  }
}