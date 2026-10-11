import { NextResponse } from "next/server";

import {
  icpAuthoringErrorResponse,
  loadIcpVersion,
  requireIcpUser,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { withdrawIcpSubmission } from "@/lib/leadgen/icpReview";

/** The submitter takes their ICP back out of review (it returns to a draft). Nobody else may. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireIcpUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const { id } = await params;

  const target = await loadIcpVersion(tenantId, id);
  if (!target || target.icpProfile.ownerUserId !== user.id) {
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }
  if (target.status !== "pending_review") {
    return NextResponse.json(
      { error: "ICP version is not waiting for review", code: "not_pending" },
      { status: 409 },
    );
  }

  try {
    const version = await withdrawIcpSubmission({ tenantId, versionId: id });
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.withdraw",
      tableName: "IcpVersion",
      recordId: id,
      changedFields: { profileId: target.icpProfileId, versionNumber: target.versionNumber },
    });
    return NextResponse.json({ version });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
