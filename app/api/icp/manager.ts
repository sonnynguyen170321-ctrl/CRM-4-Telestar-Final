import { NextResponse } from "next/server";

import { getVisibleCampaignIds, requireAuth } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { canEditProfile, canViewProfile } from "@/lib/leadgen/icpAccess";
import { IcpAuthoringError } from "@/lib/leadgen/icpAuthoring";
import {
  canManageLibraryIcp,
  canManageScoringRequest,
  hasScoringWriteScope,
} from "@/lib/leads/scoringAccess";
import { prisma } from "@/lib/prisma";

/**
 * Three doors into the ICP routes. Pick by what the route does, then check the object:
 *
 * - `requireIcpManager`: the shared library only (director, floor manager, leadgen manager).
 * - `requireIcpStaff`: team lead and up (rescore, review queue, campaign list).
 * - `requireIcpUser`: any signed-in role. A rep makes and edits their own ICP, so the role gate is
 *   only the floor; every route behind it checks the profile (`lib/leadgen/icpAccess.ts`).
 *
 * API keys need `scoring:write` through all three.
 */
export async function requireIcpManager(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!canManageLibraryIcp(user)) {
    return NextResponse.json(
      { error: "Forbidden: only directors, floor managers and leadgen managers manage the shared ICP library" },
      { status: 403 },
    );
  }
  return user;
}

export async function requireIcpStaff(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!canManageScoringRequest(user)) {
    return NextResponse.json(
      { error: "Forbidden: team lead role or above, and the scoring:write scope, required" },
      { status: 403 },
    );
  }
  return user;
}

export async function requireIcpUser(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!hasScoringWriteScope(user)) {
    return NextResponse.json(
      { error: "Forbidden: the scoring:write scope is required" },
      { status: 403 },
    );
  }
  return user;
}

/** A version with the profile facts every authorization decision needs. Tenant-scoped. */
export async function loadIcpVersion(tenantId: string, versionId: string) {
  return prisma.icpVersion.findFirst({
    where: { id: versionId, tenantId },
    select: {
      id: true,
      status: true,
      versionNumber: true,
      updatedAt: true,
      submittedById: true,
      icpProfileId: true,
      icpProfile: {
        select: { id: true, name: true, kind: true, ownerUserId: true, isDefault: true },
      },
    },
  });
}

export type LoadedIcpVersion = NonNullable<Awaited<ReturnType<typeof loadIcpVersion>>>;

/**
 * Resolve a version the caller may EDIT. Missing and invisible are both 404 (whether another rep's
 * personal ICP exists is not theirs to learn); visible but not theirs to change is 403.
 */
export async function authorizeVersionEdit(
  user: SessionUser,
  tenantId: string,
  versionId: string,
): Promise<LoadedIcpVersion | NextResponse> {
  const version = await loadIcpVersion(tenantId, versionId);
  if (!version || !(await canViewProfile(user, version.icpProfile))) {
    return NextResponse.json({ error: "ICP version not found" }, { status: 404 });
  }
  if (!canEditProfile(user, version.icpProfile)) {
    return NextResponse.json(
      {
        error:
          version.icpProfile.kind === "library"
            ? "Forbidden: shared library ICPs are edited by library managers. Copy it into a custom ICP to adjust it for your campaign."
            : "Forbidden: this is another user's custom ICP",
      },
      { status: 403 },
    );
  }
  return version;
}

/** The campaigns that follow this profile, limited to the ones the caller can see. */
export async function campaignsFollowingProfile(
  user: SessionUser,
  tenantId: string,
  icpProfileId: string,
) {
  const visible = await getVisibleCampaignIds(user);
  return prisma.campaign.findMany({
    where: {
      tenantId,
      icpProfileId,
      ...(visible === null ? {} : { id: { in: visible } }),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 100,
  });
}

export function icpAuthoringErrorResponse(error: unknown) {
  if (error instanceof IcpAuthoringError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "draft_conflict" ||
            error.code === "published_immutable" ||
            error.code === "simplification_required" ||
            error.code === "review_pending" ||
            error.code === "not_pending"
          ? 409
          : 400;
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status },
    );
  }
  if ((error as { code?: string } | null)?.code === "P2002") {
    return NextResponse.json(
      { error: "An ICP with this name already exists", code: "duplicate_name" },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: "Unable to update ICP configuration" },
    { status: 500 },
  );
}
