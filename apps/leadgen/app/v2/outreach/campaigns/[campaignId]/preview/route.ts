import { NextResponse, type NextRequest } from "next/server";

import { renderTemplatePreview } from "@/lib/v2/outreach/templates/renderTemplatePreview";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

export async function POST(request: NextRequest) {
  let tenant;
  try {
    tenant = await requirePermission("outreach.admin");
  } catch (error) {
    if (error instanceof V2TenantError) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    throw error;
  }

  let payload: { subjectTemplate?: unknown; bodyTemplate?: unknown; leadAssignmentId?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const subjectTemplate = typeof payload.subjectTemplate === "string" ? payload.subjectTemplate : "";
  const bodyTemplate = typeof payload.bodyTemplate === "string" ? payload.bodyTemplate : "";
  const leadAssignmentId = typeof payload.leadAssignmentId === "string" ? payload.leadAssignmentId.trim() : "";
  const preview = await renderTemplatePreview({
    organizationId: tenant.organizationId,
    subjectTemplate,
    bodyTemplate,
    leadAssignmentId,
  });

  if (!preview) {
    return NextResponse.json({ ok: false, error: "Preview contact not found for this campaign tenant." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...preview });
}
