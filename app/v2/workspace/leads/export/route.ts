import { type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import {
  collectContactLeadExportRows,
  loadLeadExportOverlay,
  parseLeadWorkspaceFilters,
  serializeContactLeadCsv,
} from "@/lib/v2/crm";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Contact-first CSV export of /v2/leads. Uses the SAME contact-anchored read model
// + filters as the table, so the file equals the on-screen filtered view (Account/
// Project/ICP optional). Carries the immutable assessment snapshot + human overlay
// (open reviews / feedback). Real DB only; tenant-scoped.
export async function GET(request: NextRequest) {
  try {
    const tenantContext = await requirePermission("crm.read");
    const params = Object.fromEntries(request.nextUrl.searchParams.entries());
    const ownerUserId = typeof params.ownerUserId === "string" && params.ownerUserId.trim()
      ? params.ownerUserId.trim()
      : undefined;
    const filters = { ...parseLeadWorkspaceFilters(params), ownerUserId };

    const { rows } = await collectContactLeadExportRows({
      organizationId: tenantContext.organizationId,
      filters,
    });
    const overlay = await loadLeadExportOverlay(
      prisma,
      tenantContext.organizationId,
      rows.map((row) => row.leadAssignmentId)
    );
    const csv = serializeContactLeadCsv(rows, overlay);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${buildExportFileName()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return textError(
        error.code === "UNAUTHENTICATED"
          ? "Authentication is required."
          : "You do not have permission to export leads.",
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("V2 lead workspace export failed", error);

    return textError("Lead export failed.", 500);
  }
}

function buildExportFileName() {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return `leadger-v2-contacts-${stamp}.csv`;
}

function textError(message: string, status: number) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
