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
import { consumeAttempt } from "@/lib/security/attemptLimit";

/** Largest request body the ICP routes read. A real rule set is a few KB; this is generous. */
export const ICP_BODY_MAX_BYTES = 64 * 1024;

/**
 * Read a JSON body, refusing anything over the cap before it is parsed. `Content-Length` can lie,
 * so the text itself is measured too.
 */
export async function readBoundedJson(
  req: Request,
  maxBytes: number = ICP_BODY_MAX_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; response: NextResponse }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  const tooLarge = () => ({
    ok: false as const,
    response: NextResponse.json(
      { error: "Request body too large", code: "body_too_large" },
      { status: 413 },
    ),
  });
  if (declared > maxBytes) return tooLarge();
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) return tooLarge();
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }) };
  }
}

/** Per-user limit for an ICP action. Returns a 429 response when the caller is over it. */
export async function icpRateLimit(
  user: SessionUser,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<NextResponse | null> {
  const attempt = await consumeAttempt({ bucket: `icp-${bucket}`, subject: user.id, limit, windowSeconds });
  if (attempt.allowed) return null;
  return NextResponse.json(
    { error: "Too many requests. Try again shortly.", code: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } },
  );
}

export const ICP_LIMITS = {
  preview: { limit: 30, windowSeconds: 60 },
  save: { limit: 60, windowSeconds: 60 },
  createCustom: { limit: 20, windowSeconds: 24 * 60 * 60 },
} as const;

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
            error.code === "not_a_draft" ||
            error.code === "version_archived" ||
            error.code === "simplification_required" ||
            error.code === "review_pending" ||
            error.code === "not_pending" ||
            error.code === "changed_since_opened"
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
