import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { queryRuntimeRun } from "@/lib/v2/runtime/queryRuntimeStatus";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

const PROCESS_BUDGET_MS = 8000;

// Page-driven drain for a bulk ENRICHMENT run. Mirrors the research process route: drains the
// run's COMPANY_ENRICHMENT jobs (scoped by sourceId = runId) inline so the bar advances 1→N with
// NO worker, then reconciles the runtime run's counters from the authoritative V2Job statuses
// (works whether the page or a Bull worker did the processing). Tenant-scoped.
export async function POST(_request: Request, { params }: { params: Promise<{ runId: string }> }) {
  try {
    const ctx = await requirePermission("score.enqueue");
    const { runId } = await params;

    const view = await queryRuntimeRun(ctx.organizationId, runId);
    if (!view) return NextResponse.json({ ok: false, error: "Run not found." }, { status: 404 });

    const started = Date.now();
    let processed = 0;
    while (Date.now() - started < PROCESS_BUDGET_MS - 1500) {
      const result = await processNextV2Job(prisma as unknown as V2JobDatabase, {
        organizationId: ctx.organizationId,
        jobType: "COMPANY_ENRICHMENT",
        sourceType: "MANUAL",
        sourceId: runId,
      });
      if (result.kind === "no_job") break;
      processed += 1;
      if (result.kind === "retry_scheduled") break;
    }

    await reconcileEnrichmentRun(ctx.organizationId, runId);
    const refreshed = await queryRuntimeRun(ctx.organizationId, runId);
    return NextResponse.json({ ok: true, processed, view: refreshed });
  } catch (error) {
    if (error instanceof V2TenantError) {
      const msg = getTenantErrorMessage(error);
      return NextResponse.json({ ok: false, error: msg.message }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: "Failed to process enrichment run." }, { status: 500 });
  }
}

/** Authoritative: set the run's counters from the terminal COMPANY_ENRICHMENT job statuses for
 *  this run, so the bar is correct regardless of whether the page or a worker drained the jobs. */
async function reconcileEnrichmentRun(organizationId: string, runId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `UPDATE "V2RuntimeRun" r SET
       "processedUnits" = c.done,
       "succeededUnits" = c.succ,
       "failedUnits" = c.fail + c.cancelled,
       "status" = CASE
         WHEN r."totalUnits" > 0 AND c.done >= r."totalUnits"
           THEN (CASE
             WHEN c.cancelled >= r."totalUnits" THEN 'CANCELLED'
             WHEN c.fail > 0 OR c.cancelled > 0 THEN 'PARTIAL'
             ELSE 'SUCCEEDED'
           END)
         ELSE 'RUNNING' END,
       "finishedAt" = CASE
         WHEN r."totalUnits" > 0 AND c.done >= r."totalUnits" THEN CURRENT_TIMESTAMP
         ELSE r."finishedAt" END,
       "updatedAt" = CURRENT_TIMESTAMP
     FROM (
       SELECT
         COUNT(*) FILTER (WHERE "status" IN ('SUCCEEDED','FAILED','CANCELLED'))::int AS done,
         COUNT(*) FILTER (WHERE "status" = 'SUCCEEDED')::int AS succ,
         COUNT(*) FILTER (WHERE "status" = 'FAILED')::int AS fail,
         COUNT(*) FILTER (WHERE "status" = 'CANCELLED')::int AS cancelled
       FROM "V2Job"
       WHERE "organizationId" = $1 AND "sourceType" = 'MANUAL' AND "sourceId" = $2
         AND "jobType" = 'COMPANY_ENRICHMENT'
     ) c
     WHERE r."id" = $2 AND r."organizationId" = $1`,
    organizationId,
    runId
  );
}
