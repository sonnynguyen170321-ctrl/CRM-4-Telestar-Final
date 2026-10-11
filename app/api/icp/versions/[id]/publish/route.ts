import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  campaignsFollowingProfile,
  icpAuthoringErrorResponse,
  loadIcpVersion,
  requireIcpUser,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { logAdminAudit } from "@/lib/audit";
import { canViewProfile, publishModeFor } from "@/lib/leadgen/icpAccess";
import { publishIcpDraft } from "@/lib/leadgen/icpAuthoring";
import { submitIcpDraftForReview } from "@/lib/leadgen/icpReview";

const publishSchema = z
  .object({ expectedUpdatedAt: z.string().datetime() })
  .strict();

/**
 * Publish a draft. What that means depends on who presses it:
 *
 * - a library ICP, by a library manager: published now;
 * - a custom ICP by its owner at team lead or above: published now;
 * - a custom ICP by its owner below team lead (an SDR): SUBMITTED for review. It scores nothing
 *   until a team lead of theirs or a manager approves it.
 *
 * `outcome` says which happened, and `campaigns` lists the campaigns that follow this ICP so the
 * caller can offer a rescore preview.
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
  const parsed = publishSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid publish request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { id } = await params;
  const target = await loadIcpVersion(tenantId, id);
  if (!target || !(await canViewProfile(user, target.icpProfile))) {
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }
  const mode = publishModeFor(user, target.icpProfile);
  if (!mode) {
    return NextResponse.json(
      {
        error:
          target.icpProfile.kind === "library"
            ? "Forbidden: only library managers publish shared ICPs"
            : "Forbidden: only the owner of a custom ICP publishes it",
      },
      { status: 403 },
    );
  }

  try {
    if (mode === "submit") {
      const version = await submitIcpDraftForReview({
        tenantId,
        versionId: id,
        submittedById: user.id,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      });
      await logAdminAudit({
        actorId: user.id,
        action: "admin.icp.submit",
        tableName: "IcpVersion",
        recordId: id,
        changedFields: { profileId: target.icpProfileId, versionNumber: target.versionNumber },
      });
      return NextResponse.json({ version, outcome: "submitted", campaigns: [] });
    }

    const version = await publishIcpDraft({
      tenantId,
      versionId: id,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
    });
    // Publishing is the moment an ICP starts scoring real prospects — the action a reviewer
    // of the Audit Log actually wants to find.
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.publish",
      tableName: "IcpVersion",
      recordId: id,
      changedFields: { profileId: target.icpProfileId, kind: target.icpProfile.kind },
    });
    const campaigns = await campaignsFollowingProfile(user, tenantId, target.icpProfileId);
    return NextResponse.json({ version, outcome: "published", campaigns });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
