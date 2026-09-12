import { NextResponse } from "next/server";

import { requireAuth } from "@/lib/auth";
import type { SessionUser } from "@/lib/auth";
import { IcpAuthoringError } from "@/lib/leadgen/icpAuthoring";
import { canManageScoringRequest } from "@/lib/leads/scoringAccess";

export async function requireIcpManager(): Promise<SessionUser | NextResponse> {
  const user = await requireAuth();
  if (user instanceof NextResponse) return user;
  if (!canManageScoringRequest(user)) {
    return NextResponse.json(
      { error: "Forbidden: manager role and scoring:write scope required" },
      { status: 403 },
    );
  }
  return user;
}

export function icpAuthoringErrorResponse(error: unknown) {
  if (error instanceof IcpAuthoringError) {
    const status =
      error.code === "not_found"
        ? 404
        : error.code === "draft_conflict" ||
            error.code === "published_immutable" ||
            error.code === "simplification_required"
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
