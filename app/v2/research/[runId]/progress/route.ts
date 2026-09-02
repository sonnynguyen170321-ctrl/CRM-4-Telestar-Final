import { NextResponse } from "next/server";

import { getResearchRunProgress } from "@/lib/v2/research/progress";
import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const ctx = await requirePermission("ingestion.apply");
    const { runId } = await params;
    const progress = await getResearchRunProgress(ctx.organizationId, runId);
    if (!progress) return NextResponse.json({ ok: false, error: "Research run not found." }, { status: 404 });
    return NextResponse.json(progress);
  } catch (error) {
    if (error instanceof V2TenantError) {
      const msg = getTenantErrorMessage(error);
      return NextResponse.json({ ok: false, error: msg.message }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: "Failed to load research progress." }, { status: 500 });
  }
}
