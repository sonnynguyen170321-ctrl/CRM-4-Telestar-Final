import { NextResponse } from "next/server";

import {
  campaignsFollowingProfile,
  icpAuthoringErrorResponse,
  loadIcpVersion,
  requireIcpStaff,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { canReviewSubmission } from "@/lib/leadgen/icpAccess";
import { approveIcpVersion } from "@/lib/leadgen/icpReview";

/**
 * Approve a submitted custom ICP: it becomes the profile's published version, the previous one is
 * archived, and every campaign on the profile follows it. Existing verdicts stay until the reviewer
 * rescores, so the response lists the campaigns for a rescore preview.
 *
 * Only a team lead whose pod includes the submitter, or a library manager. Nobody approves their own.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireIcpStaff();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const { id } = await params;

  const target = await loadIcpVersion(tenantId, id);
  if (!target || target.status !== "pending_review") {
    return NextResponse.json(
      { error: "ICP version is not waiting for review", code: "not_pending" },
      { status: target ? 409 : 404 },
    );
  }
  if (!(await canReviewSubmission(user, target.submittedById))) {
    // Not in their chain: indistinguishable from not existing.
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }

  try {
    const version = await approveIcpVersion({ tenantId, versionId: id, reviewerId: user.id });
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.approve",
      tableName: "IcpVersion",
      recordId: id,
      targetUserId: target.submittedById ?? undefined,
      changedFields: { profileId: target.icpProfileId, versionNumber: target.versionNumber },
    });
    const campaigns = await campaignsFollowingProfile(user, tenantId, target.icpProfileId);
    return NextResponse.json({ version, campaigns });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
