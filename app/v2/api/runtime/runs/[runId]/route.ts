import { NextResponse, type NextRequest } from "next/server";

import { queryRuntimeRun } from "@/lib/v2/runtime/queryRuntimeStatus";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// P6: pollable runtime run status. Lets any surface (the score-run page, a future
// leads-header badge) poll a run's progress without a full page render. Tenant-scoped
// (Invariant 5) — the run is only visible to its own org.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  let tenantContext;
  try {
    tenantContext = await requirePermission("crm.read");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  const { runId } = await params;
  if (!runId) {
    return NextResponse.json({ ok: false, error: "runId is required" }, { status: 400 });
  }

  const view = await queryRuntimeRun(tenantContext.organizationId, runId);
  if (!view) {
    return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, view });
}
