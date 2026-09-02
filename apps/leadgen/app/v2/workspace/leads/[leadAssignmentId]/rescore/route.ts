import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { enqueueIcpScoreJob } from "@/lib/v2/scoring/runtime/enqueueScoringJobs";
import type { V2ScoreRuntimeDatabase } from "@/lib/v2/scoring/runtime/types";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = { params: Promise<{ leadAssignmentId?: string }> };

// Re-score a lead assignment on demand (SDR runtime button). Enqueues an
// ICP_SCORE job for this lead and drains it inline so the new assessment is
// visible immediately. Scoring is immutable + fingerprinted (reuses the same
// assessment when nothing changed; a new one when ICP/evidence changed).
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const tenant = await requirePermission("workflow.update");
    const { leadAssignmentId } = await context.params;
    if (!leadAssignmentId?.trim()) {
      return NextResponse.json({ ok: false, code: "INVALID_INPUT", message: "Lead assignment id is required." }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT "id" FROM "V2LeadAssignment" WHERE "id" = $1 AND "organizationId" = $2 AND "deletedAt" IS NULL`,
      leadAssignmentId.trim(),
      tenant.organizationId
    );
    if (!rows[0]) {
      return NextResponse.json({ ok: false, code: "NOT_FOUND", message: "Lead assignment was not found." }, { status: 404 });
    }

    const enqueueResult = await enqueueIcpScoreJob(prisma as unknown as V2ScoreRuntimeDatabase, {
      organizationId: tenant.organizationId,
      selection: { kind: "lead_assignment_ids", leadAssignmentIds: [leadAssignmentId.trim()] },
      createdByUserId: tenant.userId,
    });

    // Drain the score job(s) inline (bounded) so the SDR sees the result now.
    let processed = 0;
    const counts = { selected: 0, scored: 0, created: 0, reused: 0, failed: 0 };
    for (let i = 0; i < 4; i++) {
      const result = await processNextV2Job(prisma as unknown as V2JobDatabase, {
        organizationId: tenant.organizationId,
        jobType: "ICP_SCORE",
      });
      if (!result || result.kind === "no_job") break;
      processed++;
      if (result.kind === "succeeded") {
        mergeScoreCounts(counts, result.job.resultSnapshotJson);
      }
    }

    return NextResponse.json({ ok: true, code: "RESCORED", enqueue: enqueueResult.kind, processed, counts });
  } catch (error) {
    if (error instanceof V2TenantError) {
      const unauth = error.code === "UNAUTHENTICATED";
      return NextResponse.json(
        { ok: false, code: unauth ? "UNAUTHENTICATED" : "FORBIDDEN", message: unauth ? "Authentication is required." : "You do not have permission to re-score." },
        { status: unauth ? 401 : 403 }
      );
    }
    console.error("V2 re-score failed", error);
    return NextResponse.json({ ok: false, code: "RESCORE_FAILED", message: "Re-score failed." }, { status: 500 });
  }
}

function mergeScoreCounts(
  target: { selected: number; scored: number; created: number; reused: number; failed: number },
  snapshot: unknown
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return;
  const counts = (snapshot as { counts?: unknown }).counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return;
  target.selected += readCount(counts, "selected");
  target.scored += readCount(counts, "scored");
  target.created += readCount(counts, "created");
  target.reused += readCount(counts, "reused");
  target.failed += readCount(counts, "failed");
}

function readCount(value: object, key: string) {
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}
