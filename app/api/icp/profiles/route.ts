import { NextRequest, NextResponse } from "next/server";
import { ICP_TEMPLATES_V2 } from "@telestar/core-scoring/rules/icpTemplatesV2";
import { z } from "zod";

import {
  icpAuthoringErrorResponse,
  requireIcpUser,
} from "@/app/api/icp/manager";
import { requireTenantId } from "@/lib/api/tenant";
import { getVisibleCampaignIds } from "@/lib/auth";
import { logAdminAudit } from "@/lib/audit";
import { canEditProfile, publishModeFor, visibleCustomOwnerIds } from "@/lib/leadgen/icpAccess";
import { createIcpProfile, listIcpProfiles } from "@/lib/leadgen/icpAuthoring";
import { createCustomIcp } from "@/lib/leadgen/customIcp";
import { canManageLibraryIcp } from "@/lib/leads/scoringAccess";
import { prisma } from "@/lib/prisma";

const createProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    templateId: z.string().trim().min(1).optional(),
    isDefault: z.boolean().optional(),
    /** `library` (managers only) is shared; `custom` is the caller's own, made for a campaign. */
    kind: z.enum(["library", "custom"]).optional(),
    /** Custom: the campaign it is for. Required unless the caller manages the library. */
    campaignId: z.string().min(1).max(64).optional(),
    /** Custom: copy this ICP's published rules instead of a template. */
    sourceProfileId: z.string().min(1).max(64).optional(),
  })
  .strict();

/**
 * Every ICP the caller may see. Library ICPs are visible to everyone (read-only unless they manage
 * the library); a custom ICP to its owner, the team leads above them and the library roles. Each
 * profile carries what the caller may do with it, so the UI shows the right buttons from one source.
 */
export async function GET() {
  const user = await requireIcpUser();
  if (user instanceof NextResponse) return user;
  const tenantId = requireTenantId(user);
  if (tenantId instanceof NextResponse) return tenantId;

  const profiles = await listIcpProfiles(tenantId, await visibleCustomOwnerIds(user));
  return NextResponse.json({
    profiles: profiles.map((profile) => ({
      ...profile,
      canEdit: canEditProfile(user, profile),
      publishMode: publishModeFor(user, profile),
    })),
    templates: ICP_TEMPLATES_V2.map(({ id, name, description }) => ({
      id,
      name,
      description,
    })),
    canManageLibrary: canManageLibraryIcp(user),
  });
}

export async function POST(req: NextRequest) {
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
  const parsed = createProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid ICP profile", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const body = parsed.data;
  const manager = canManageLibraryIcp(user);
  // Managers default to a library ICP (the Automation panel); everyone else can only make a custom one.
  const kind = body.kind ?? (manager ? "library" : "custom");

  try {
    if (kind === "library") {
      if (!manager) {
        return NextResponse.json(
          { error: "Forbidden: only library managers create shared ICPs. Make a custom ICP for your campaign instead." },
          { status: 403 },
        );
      }
      if (!body.name) {
        return NextResponse.json({ error: "Enter an ICP name" }, { status: 400 });
      }
      const result = await createIcpProfile({
        tenantId,
        name: body.name,
        description: body.description,
        templateId: body.templateId,
        isDefault: body.isDefault,
        kind: "library",
      });
      await logAdminAudit({
        actorId: user.id,
        action: "admin.icp.create",
        tableName: "IcpProfile",
        recordId: result.profile.id,
        changedFields: { name: body.name, templateId: body.templateId ?? null, kind: "library" },
      });
      return NextResponse.json(result, { status: 201 });
    }

    // Custom: a rep may make one for a campaign they can see; library managers need no campaign.
    let campaignName: string | null = null;
    if (body.campaignId) {
      const visible = await getVisibleCampaignIds(user);
      if (visible !== null && !visible.includes(body.campaignId)) {
        return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      }
      const campaign = await prisma.campaign.findFirst({
        where: { id: body.campaignId, tenantId },
        select: { name: true },
      });
      if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
      campaignName = campaign.name;
    } else if (!manager) {
      return NextResponse.json(
        { error: "Choose the campaign this ICP is for" },
        { status: 400 },
      );
    }

    const source = body.sourceProfileId
      ? ({ source: "library", sourceProfileId: body.sourceProfileId } as const)
      : body.templateId
        ? ({ source: "template", templateId: body.templateId } as const)
        : ({ source: "blank" } as const);
    const result = await createCustomIcp({
      tenantId,
      user,
      name: body.name,
      campaignId: body.campaignId ?? null,
      campaignName,
      source,
    });
    await logAdminAudit({
      actorId: user.id,
      action: "admin.icp.create",
      tableName: "IcpProfile",
      recordId: result.profile.id,
      changedFields: {
        name: result.profile.name,
        kind: "custom",
        source: source.source,
        campaignId: body.campaignId ?? null,
      },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return icpAuthoringErrorResponse(error);
  }
}
