import { NextResponse } from "next/server";

import { requireAuth, type SessionUser } from "@/lib/auth";
import { DEFAULT_SCORING_RULES } from "@/lib/leads/scoring";
import { canManageScoringRequest } from "@/lib/leads/scoringAccess";

export const dynamic = "force-dynamic";

export async function GET() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId)
    return NextResponse.json({ error: "No tenant context" }, { status: 403 });

  return NextResponse.json({
    mode: "fixed",
    rules: DEFAULT_SCORING_RULES,
    explanation: {
      hot: ["Meeting booked = 100", "Reply received = 80"],
      warm: ["Email open = 10 each, maximum 40"],
      cold: ["No recorded engagement = 0"],
    },
  });
}

export async function PUT() {
  const userOrRes = await requireAuth();
  if (userOrRes instanceof NextResponse) return userOrRes;
  const user = userOrRes as SessionUser;
  if (!user.tenantId)
    return NextResponse.json({ error: "No tenant context" }, { status: 403 });
  if (!canManageScoringRequest(user)) {
    return NextResponse.json(
      { error: "Forbidden: manager role and scoring:write scope required" },
      { status: 403 },
    );
  }

  return NextResponse.json(
    {
      error: "engagement_rules_are_fixed",
      message:
        "Engagement uses fixed activity rules and cannot be weighted or edited.",
      rules: DEFAULT_SCORING_RULES,
    },
    { status: 409 },
  );
}
