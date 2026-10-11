import { NextRequest, NextResponse } from "next/server";

import { loadIcpVersion, requireIcpUser } from "@/app/api/icp/manager";
import { safeValidateIcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import { requireTenantId } from "@/lib/api/tenant";
import { getLeadWhereScope, getVisibleCampaignIds } from "@/lib/auth";
import {
  canEditProfile,
  canViewProfile,
  isScoringStaff,
} from "@/lib/leadgen/icpAccess";
import { previewIcpRules } from "@/lib/leads/icpPreview";

/**
 * Score a sample of real leads against *unsaved* ICP rules, for the scoring editor's live preview.
 *
 * Read-only by construction: `previewIcpRules` writes nothing, so the editor can call this on every
 * change without leaving rows, audit entries or moved verdicts behind. The version in the path only
 * anchors which ICP profile's leads to sample, and must belong to the caller's tenant; the rules
 * come from the body and are validated by the same schema a save would use.
 *
 * Who: whoever may edit this ICP (a rep previewing their own draft) and team lead and up (a
 * reviewer previewing a submission). With `campaignId` the sample is that campaign's leads, limited
 * to the leads the caller may see, so a rep previewing never reads a colleague's leads.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireIcpUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const body = (raw ?? {}) as { rulesJson?: unknown; campaignId?: unknown };

  const validated = safeValidateIcpVersionRulesV2(body.rulesJson);
  if (!validated.success) {
    return NextResponse.json(
      { error: "Rules are not valid yet", details: validated.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const campaignId =
    typeof body.campaignId === "string" && body.campaignId ? body.campaignId : undefined;

  const { id } = await params;
  const version = await loadIcpVersion(tenantId, id);
  if (!version || !(await canViewProfile(user, version.icpProfile))) {
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }
  if (!canEditProfile(user, version.icpProfile) && !isScoringStaff(user)) {
    return NextResponse.json(
      { error: "Forbidden: you can preview ICPs you can edit, or review" },
      { status: 403 },
    );
  }

  if (campaignId) {
    const visible = await getVisibleCampaignIds(user);
    if (visible !== null && !visible.includes(campaignId)) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
  }

  try {
    const preview = await previewIcpRules({
      tenantId,
      icpProfileId: version.icpProfileId,
      rules: validated.data,
      campaignId,
      leadScope: await getLeadWhereScope(user),
    });
    return NextResponse.json(preview);
  } catch (error) {
    console.error("[api/icp/preview-score] failed", { tenantId, versionId: id, error });
    return NextResponse.json({ error: "Preview failed" }, { status: 500 });
  }
}
