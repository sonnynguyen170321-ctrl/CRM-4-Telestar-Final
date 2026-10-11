import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  requireIcpUser,
} from "@/app/api/icp/manager";
import { getVisibleCampaignIds } from "@/lib/auth";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { invalidateList } from "@/lib/cache";
import { canAttachProfile, isScoringStaff } from "@/lib/leadgen/icpAccess";
import { assignCampaignIcp } from "@/lib/leadgen/icpAuthoring";
import { prisma } from "@/lib/prisma";

const assignmentSchema = z
  // null clears the campaign's ICP: it is then not scored (there is no default fallback).
  .object({ icpVersionId: z.string().min(1).nullable() })
  .strict();

/** The campaign's ICP facts for its ICP page: any signed-in user who can see the campaign. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireIcpUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const { id } = await params;

  const visibleCampaignIds = await getVisibleCampaignIds(user);
  if (visibleCampaignIds !== null && !visibleCampaignIds.includes(id)) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  const campaign = await prisma.campaign.findFirst({
    where: { id, tenantId },
    select: {
      id: true,
      name: true,
      icpProfileId: true,
      icpVersionId: true,
      client: { select: { name: true } },
      _count: { select: { leads: true } },
    },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json({ campaign });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireIcpUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;
  const { id } = await params;

  const visibleCampaignIds = await getVisibleCampaignIds(user);
  if (visibleCampaignIds !== null && !visibleCampaignIds.includes(id)) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = assignmentSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid campaign ICP assignment", details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Who may switch the campaign: its reps may attach a library ICP or their own approved one; team
  // lead and up any ICP they can see. Clearing the ICP stops scoring for everyone on the campaign,
  // so that is team lead and up. A version still in review (or a draft) is never attachable.
  if (parsed.data.icpVersionId === null) {
    if (!isScoringStaff(user)) {
      return NextResponse.json(
        { error: "Forbidden: only a team lead or above can stop a campaign from being scored" },
        { status: 403 },
      );
    }
  } else {
    const target = await prisma.icpVersion.findFirst({
      where: { id: parsed.data.icpVersionId, tenantId },
      select: {
        status: true,
        icpProfile: { select: { kind: true, ownerUserId: true } },
      },
    });
    if (!target) {
      return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
    }
    if (target.status === "pending_review") {
      return NextResponse.json(
        { error: "This ICP is waiting for review. It can be attached once it is approved.", code: "pending_review" },
        { status: 409 },
      );
    }
    if (target.status !== "published") {
      return NextResponse.json(
        { error: "Only a published ICP version can be attached to a campaign", code: "not_published" },
        { status: 409 },
      );
    }
    if (!(await canAttachProfile(user, target.icpProfile))) {
      return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
    }
  }

  try {
    const campaign = await assignCampaignIcp({
      tenantId,
      campaignId: id,
      icpVersionId: parsed.data.icpVersionId,
    });
    await invalidateList(tenantId, "campaigns");
    const cleared = parsed.data.icpVersionId === null;
    await logAdminAudit({
      actorId: user.id,
      action: cleared ? "admin.campaign.icp_clear" : "admin.campaign.icp_assign",
      tableName: "Campaign",
      recordId: id,
      changedFields: { icpVersionId: parsed.data.icpVersionId },
    });
    return NextResponse.json({
      campaign,
      // Assigning or clearing does not rescore: verdicts already stored stay until a rescore.
      note: cleared
        ? "This campaign no longer has an ICP, so it is not scored. Existing lead verdicts stay until you rescore the campaign, which clears them."
        : "Existing lead verdicts stay until you rescore the campaign.",
    });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
