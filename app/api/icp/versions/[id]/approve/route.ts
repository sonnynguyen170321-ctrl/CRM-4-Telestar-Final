import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

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

const approveSchema = z.object({ expectedSubmittedAt: z.string().datetime() }).strict();

/**
 * Approve a submitted custom ICP: it becomes the profile's published version, the previous one is
 * archived, and every campaign on the profile follows it. Existing verdicts stay until the reviewer
 * rescores, so the response lists the campaigns for a rescore preview.
 *
 * Only a team lead whose pod includes the submitter, or a library manager. Nobody approves their own.
 */
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
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Say which submission you reviewed (expectedSubmittedAt)", details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Chain first: someone outside it learns nothing, not even the version's status.
  const target = await loadIcpVersion(tenantId, id);
  if (!target || !(await canReviewSubmission(user, target.submittedById))) {
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }
  if (target.status !== "pending_review") {
    return NextResponse.json(
      { error: "ICP version is not waiting for review", code: "not_pending" },
      { status: 409 },
    );
  }

  try {
    const { version, archivedVersionIds } = await approveIcpVersion({
      tenantId,
      versionId: id,
      reviewerId: user.id,
      expectedSubmittedAt: parsed.data.expectedSubmittedAt,
    });
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.approve",
      tableName: "IcpVersion",
      recordId: id,
      targetUserId: target.submittedById ?? undefined,
      changedFields: { profileId: target.icpProfileId, versionNumber: target.versionNumber, archivedVersionIds },
    });
    const campaigns = await campaignsFollowingProfile(user, tenantId, target.icpProfileId);
    return NextResponse.json({ version, campaigns });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
