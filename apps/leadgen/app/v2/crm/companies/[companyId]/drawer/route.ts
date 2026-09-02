import { NextResponse, type NextRequest } from "next/server";

import { getCompanyDetail } from "@/lib/v2/company-intelligence/readModel";
import { queryCompanyIcpBestMatch } from "@/lib/v2/crm";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Tenant-scoped, session-dependent read — never statically collected at build.
export const dynamic = "force-dynamic";

// Company drawer hydrate endpoint. The client drawer opens instantly from the row snapshot,
// then GETs this for the heavy detail (company + snapshot + profile + cross-ICP leads) so the
// companies page no longer blocks its render on getCompanyDetail. Tenant-scoped (Invariant 5);
// the org comes from the session, never from the client.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ companyId: string }> }
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

  const { companyId } = await params;
  if (!companyId) {
    return NextResponse.json({ ok: false, error: "companyId is required" }, { status: 400 });
  }

  const leadPageRaw = Number(request.nextUrl.searchParams.get("leadPage"));
  const leadPage = Number.isFinite(leadPageRaw) && leadPageRaw >= 1 ? Math.floor(leadPageRaw) : 1;

  try {
    const [detail, bestMatch] = await Promise.all([
      getCompanyDetail({ organizationId: tenantContext.organizationId, companyId, leadPage }),
      queryCompanyIcpBestMatch(tenantContext.organizationId, companyId),
    ]);

    if (!detail) {
      return NextResponse.json({ ok: false, error: "Company not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, detail, bestMatch });
  } catch (error) {
    console.error("COMPANY_DRAWER_READ_MODEL_FAILED", { companyId, error });
    return NextResponse.json({ ok: false, error: "Failed to load company detail" }, { status: 500 });
  }
}
