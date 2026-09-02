import { NextResponse, type NextRequest } from "next/server";

import { queryLeadDrawerReadModel } from "@/lib/v2/crm/queryLeadDrawerReadModel";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Tenant-scoped, session-dependent read — never statically collected at build.
export const dynamic = "force-dynamic";

// P5: the drawer hydrate endpoint. A client-side drawer opens instantly from the row
// snapshot, then GETs this for the deep detail (timeline / notes / tasks / enrollments /
// contact / assignable members). Tenant-scoped (Invariant 5); never trusts a client org.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leadAssignmentId: string }> }
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

  const { leadAssignmentId } = await params;
  if (!leadAssignmentId) {
    return NextResponse.json({ ok: false, error: "leadAssignmentId is required" }, { status: 400 });
  }

  try {
    const model = await queryLeadDrawerReadModel({
      organizationId: tenantContext.organizationId,
      leadAssignmentId,
    });

    if (!model) {
      return NextResponse.json({ ok: false, error: "Lead not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, model });
  } catch (error) {
    // A read-model query throwing was surfacing as an unhandled 500 with no signal —
    // the client drawer just showed a permanent "couldn't load" retry loop. Log the real
    // cause (server-side only) and return a structured error the drawer can render.
    console.error("LEAD_DRAWER_READ_MODEL_FAILED", { leadAssignmentId, error });
    return NextResponse.json({ ok: false, error: "Failed to load lead detail" }, { status: 500 });
  }
}
