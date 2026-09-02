import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/v2/tenant";
import { queryRuntimeSync } from "@/lib/v2/runtime/queryRuntimeSync";

export const dynamic = "force-dynamic";

// Poll transport for background-job completion (fallback for the SSE stream route). Shares the exact
// tenant-scoped query with /v2/api/runtime/stream via queryRuntimeSync so the two can't drift.
export async function GET(request: Request) {
  let context;
  try {
    context = await requirePermission("crm.read");
  } catch {
    return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const sinceParam = searchParams.get("since");
    const since = sinceParam ? new Date(parseInt(sinceParam, 10)) : null;

    const { lastMutationTimestamp, completedJobs } = await queryRuntimeSync(context.organizationId, since);

    return NextResponse.json({ ok: true, lastMutationTimestamp, completedJobs });
  } catch {
    return NextResponse.json({ ok: false, message: "Sync query failed" }, { status: 500 });
  }
}
