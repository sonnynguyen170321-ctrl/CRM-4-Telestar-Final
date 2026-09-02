import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { batchEnroll } from "@/lib/v2/outreach/sequences/batchEnroll";
import { drainAfterResponse } from "@/lib/v2/jobs/drainIfNoWorker";
import type { V2JobDatabase } from "@/lib/v2/jobs/types";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Batch "add to sequence" from the lead workspace (single lead or a selection).
// Gated on workflow.update. Delegates to batchEnroll (validates + idempotent per
// lead) then drains the just-kicked SEQUENCE_STEP_EXECUTE jobs inline so the first
// step fires while the SDR is still looking. The suppression gate still runs inside
// the EMAIL_SEND the step enqueues — nothing here sends directly.
export async function POST(request: NextRequest) {
  try {
    const tenant = await requirePermission("workflow.update");
    const body = (await request.json().catch(() => null)) as {
      sequenceId?: string;
      senderAccountId?: string;
      leadAssignmentIds?: unknown;
    } | null;

    const sequenceId = body?.sequenceId?.trim();
    const senderAccountId = body?.senderAccountId?.trim();
    const leadAssignmentIds = Array.isArray(body?.leadAssignmentIds)
      ? body!.leadAssignmentIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : [];

    if (!sequenceId || !senderAccountId) {
      return NextResponse.json(
        { ok: false, code: "INVALID_INPUT", message: "A sequence and a sender are required." },
        { status: 400 }
      );
    }
    if (leadAssignmentIds.length === 0) {
      return NextResponse.json(
        { ok: false, code: "INVALID_INPUT", message: "Select at least one lead." },
        { status: 400 }
      );
    }

    const result = await batchEnroll(prisma as unknown as V2JobDatabase, {
      organizationId: tenant.organizationId,
      sequenceId,
      senderAccountId,
      leadAssignmentIds,
      enrolledByUserId: tenant.userId,
    });

    // Worker-aware + off-request (Deep D2): a live worker advances step 1 async; with no worker we
    // still drain inline, but AFTER the response flushes so the SDR gets the enroll count instantly
    // and step 1 fires in the background (GlobalJobWatcher toasts on finish). Suppression still runs
    // synchronously inside each EMAIL_SEND the step enqueues — only moved off the request thread.
    drainAfterResponse(prisma as unknown as V2JobDatabase, {
      organizationId: tenant.organizationId,
      jobType: "SEQUENCE_STEP_EXECUTE",
      max: Math.min(20, result.enrolled + 2),
    });

    return NextResponse.json({ ok: true, code: "ENROLLED", result });
  } catch (error) {
    if (error instanceof V2TenantError) {
      const unauth = error.code === "UNAUTHENTICATED";
      return NextResponse.json(
        {
          ok: false,
          code: unauth ? "UNAUTHENTICATED" : "FORBIDDEN",
          message: unauth ? "Authentication is required." : "You do not have permission to enroll leads.",
        },
        { status: unauth ? 401 : 403 }
      );
    }
    console.error("V2 enroll failed", error);
    return NextResponse.json({ ok: false, code: "ENROLL_FAILED", message: "Enrollment failed." }, { status: 500 });
  }
}
