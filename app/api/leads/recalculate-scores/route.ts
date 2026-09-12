import { NextRequest, NextResponse } from "next/server";

import { requireAuth, type SessionUser } from "@/lib/auth";
import { recalculateTenantEngagement } from "@/lib/leads/recalculateEngagement";
import { canManageScoringRequest } from "@/lib/leads/scoringAccess";
import { tenantStorage } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
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

  const tenantId = user.tenantId;

  try {
    return await tenantStorage.run({ tenantId, bypassRls: true }, async () => {
      const summary = await recalculateTenantEngagement(tenantId);
      return NextResponse.json({
        success: true,
        mode: "fixed",
        updatedCount: summary.updatedCount,
        distribution: {
          hot: summary.hotCount,
          warm: summary.warmCount,
          cold: summary.coldCount,
        },
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Failed to recalculate engagement" },
      { status: 500 },
    );
  }
}
