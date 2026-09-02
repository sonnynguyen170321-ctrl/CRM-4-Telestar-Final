import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { scoreLeadsAgainstIcp, type FanOutScoringDb } from "@/lib/v2/scoring/runtime";
import { drainAfterResponse } from "@/lib/v2/jobs/drainIfNoWorker";
import { processNextV2Job } from "@/lib/v2/jobs/processJob";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { withSpan } from "@/lib/v2/observability/trace";

// P2c: score the selected leads against a chosen target ICP (B). Gated on
// score.enqueue. Ensures the target LeadAssignments (idempotent) + enqueues one
// ICP_SCORE job. A live worker processes it async; only with no worker do we drain inline.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let context;
  try {
    context = await requirePermission("score.enqueue");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return NextResponse.json(
        { ok: false, message: error.code === "UNAUTHENTICATED" ? "Authentication required." : "You cannot run scoring." },
        { status: error.code === "UNAUTHENTICATED" ? 401 : 403 }
      );
    }
    throw error;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request body." }, { status: 400 });
  }
  const raw = (body ?? {}) as { targetIcpVersionId?: unknown; leadAssignmentIds?: unknown };
  const targetIcpVersionId = typeof raw.targetIcpVersionId === "string" ? raw.targetIcpVersionId.trim() : "";
  const leadAssignmentIds = Array.isArray(raw.leadAssignmentIds)
    ? raw.leadAssignmentIds.filter((id): id is string => typeof id === "string")
    : [];

  if (!targetIcpVersionId) {
    return NextResponse.json({ ok: false, message: "A target ICP is required." }, { status: 400 });
  }
  if (leadAssignmentIds.length === 0) {
    return NextResponse.json({ ok: false, message: "Select at least one lead." }, { status: 400 });
  }

  const result = await withSpan("score-icp.submit", () => scoreLeadsAgainstIcp(prisma as unknown as FanOutScoringDb, {
    organizationId: context.organizationId,
    actorUserId: context.userId,
    targetIcpVersionId,
    sourceLeadAssignmentIds: leadAssignmentIds,
    ownerUserId: context.role === "SDR" ? context.userId : null,
  }));

  if (!result.ok) {
    return NextResponse.json({ ok: false, code: result.code, message: result.message }, { status: 400 });
  }

  let drainMode = result.mode === "db" ? "queued_until_worker" : "not_applicable";
  let immediateDrainResult: string | null = null;
  if (result.mode === "db") {
    // DB fallback must be executable immediately in zero-worker mode. Claim the exact
    // job created for this runtime run so an older queued ICP_SCORE cannot mask a stuck run.
    if (result.jobCreated && result.jobId) {
      try {
        const drained = await processNextV2Job(prisma as unknown as V2JobDatabase, {
          organizationId: context.organizationId,
          jobId: result.jobId,
        });
        immediateDrainResult = drained.kind;
        drainMode = drained.kind === "no_job" ? "queued_until_worker" : "inline_started";
      } catch (error) {
        console.error("SCORE_ICP_INLINE_DRAIN_FAILED", { jobId: result.jobId, error });
        drainMode = "queued_after_inline_error";
      }
    }

    drainAfterResponse(prisma as unknown as V2JobDatabase, {
      organizationId: context.organizationId,
      jobType: "ICP_SCORE",
      max: 9,
    });
  }

  return NextResponse.json({
    ok: true,
    runId: result.runId,
    mode: result.mode,
    executionMode: result.mode,
    executionReason: result.executionReason,
    workerHealthy: result.workerHealthy,
    jobCreated: result.jobCreated,
    jobId: result.jobId,
    bullJobId: result.bullJobId,
    drainMode,
    immediateDrainResult,
    result: {
      requested: result.requested,
      created: result.created,
      existing: result.existing,
      ownerAssigned: result.ownerAssigned,
      enqueued: result.enqueued,
    },
  });
}
