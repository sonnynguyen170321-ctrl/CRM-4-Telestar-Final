import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  requireIcpManager,
} from "@/app/api/icp/manager";
import { getVisibleCampaignIds } from "@/lib/auth";
import { requireTenantId } from "@/lib/api/tenant";
import { invalidateList } from "@/lib/cache";
import { assignCampaignIcp } from "@/lib/leadgen/icpAuthoring";

const assignmentSchema = z
  .object({ icpVersionId: z.string().min(1) })
  .strict();

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireIcpManager();
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

  try {
    const campaign = await assignCampaignIcp({
      tenantId,
      campaignId: id,
      icpVersionId: parsed.data.icpVersionId,
    });
    await invalidateList(tenantId, "campaigns");
    return NextResponse.json({ campaign });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
