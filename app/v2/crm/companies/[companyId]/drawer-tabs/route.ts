import { NextResponse } from "next/server";

import { getTenantErrorMessage, requirePermission, V2TenantError } from "@/lib/v2/tenant";
import { queryCompanyContacts, queryCompanyActivity } from "@/lib/v2/company-intelligence/companyTabs";
import { queryCompanyResearchHistory } from "@/lib/v2/company-intelligence/readModel";

export async function GET(request: Request, { params }: { params: Promise<{ companyId: string }> }) {
  try {
    const context = await requirePermission("crm.read");
    const { companyId } = await params;
    const tab = new URL(request.url).searchParams.get("tab");

    if (tab === "contacts") {
      const contacts = await queryCompanyContacts(context.organizationId, companyId);
      return NextResponse.json({ contacts });
    }

    if (tab === "activity") {
      const activity = await queryCompanyActivity(context.organizationId, companyId);
      return NextResponse.json({ activity });
    }

    if (tab === "history") {
      const researchHistory = await queryCompanyResearchHistory(context.organizationId, companyId);
      return NextResponse.json({ researchHistory });
    }

    return NextResponse.json({ error: "Unknown drawer tab." }, { status: 400 });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return NextResponse.json({ error: getTenantErrorMessage(error) }, { status: 403 });
    }
    throw error;
  }
}
