import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  loadIcpVersion,
  requireIcpStaff,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { canReviewSubmission } from "@/lib/leadgen/icpAccess";
import { rejectIcpVersion } from "@/lib/leadgen/icpReview";

const rejectSchema = z.object({ note: z.string().trim().min(3).max(500) }).strict();

/** Send a submitted custom ICP back to its owner as a draft, with the reason. Same reviewers as approve. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireIcpStaff();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = rejectSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Tell the rep what to change (3 to 500 characters)", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const target = await loadIcpVersion(tenantId, id);
  if (!target || target.status !== "pending_review") {
    return NextResponse.json(
      { error: "ICP version is not waiting for review", code: "not_pending" },
      { status: target ? 409 : 404 },
    );
  }
  if (!(await canReviewSubmission(user, target.submittedById))) {
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }

  try {
    const version = await rejectIcpVersion({
      tenantId,
      versionId: id,
      reviewerId: user.id,
      note: parsed.data.note,
    });
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.reject",
      tableName: "IcpVersion",
      recordId: id,
      targetUserId: target.submittedById ?? undefined,
      reason: parsed.data.note,
      changedFields: { profileId: target.icpProfileId, versionNumber: target.versionNumber },
    });
    return NextResponse.json({ version });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
