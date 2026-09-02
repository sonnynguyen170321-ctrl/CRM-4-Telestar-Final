import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  try {
    const tenantContext = await requirePermission("ingestion.apply");
    const { contactId } = await params;
    const body = await request.json();

    const { companyId, title, isCurrent, startDate, endDate } = body;

    if (!companyId) {
      return NextResponse.json(
        { ok: false, error: "companyId is required" },
        { status: 400 }
      );
    }

    // verify contact belongs to organization
    const contact = await prisma.v2Contact.findFirst({
      where: {
        id: contactId,
        organizationId: tenantContext.organizationId,
      },
    });

    if (!contact) {
      return NextResponse.json(
        { ok: false, error: "Contact not found" },
        { status: 404 }
      );
    }

    // verify company belongs to organization
    const company = await prisma.v2Company.findFirst({
      where: {
        id: companyId,
        organizationId: tenantContext.organizationId,
      },
    });

    if (!company) {
      return NextResponse.json(
        { ok: false, error: "Company not found" },
        { status: 404 }
      );
    }

    const employment = await prisma.v2ContactEmployment.create({
      data: {
        organizationId: tenantContext.organizationId,
        contactId,
        companyId,
        title,
        isCurrent: isCurrent ?? true,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
    });

    return NextResponse.json({ ok: true, employment });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 403 }
      );
    }

    console.error("Failed to link contact to company", error);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
