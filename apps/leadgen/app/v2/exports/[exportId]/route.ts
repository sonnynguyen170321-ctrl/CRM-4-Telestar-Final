import { type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import {
  collectLeadWorkspaceExportRows,
  loadLeadExportOverlay,
  parseExportGenerateJobPayload,
  serializeLeadWorkspaceCsv,
} from "@/lib/v2/crm";
import { parsePayloadEnvelope } from "@/lib/v2/jobs/payloadEnvelope";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = {
  params: Promise<unknown>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("crm.read");
    const exportId = getExportId(await context.params);

    if (!exportId?.trim()) {
      return jsonError("INVALID_EXPORT_ID", "Export id is required.", 400);
    }

    const jobRows = await prisma.$queryRawUnsafe<
      Array<{ id: string; payloadSnapshotJson: unknown }>
    >(
      `
        SELECT "id", "payloadSnapshotJson"
        FROM "V2Job"
        WHERE "id" = $1
          AND "organizationId" = $2
          AND "jobType" = 'EXPORT_GENERATE'
        LIMIT 1
      `,
      exportId.trim(),
      tenantContext.organizationId
    );

    const job = jobRows[0];

    if (!job) {
      return jsonError("EXPORT_NOT_FOUND", "Export was not found.", 404);
    }

    const parsedEnvelope = parsePayloadEnvelope(job.payloadSnapshotJson);

    if (!parsedEnvelope.ok) {
      return jsonError(
        "MALFORMED_EXPORT_PAYLOAD",
        "Export job payload is malformed.",
        500
      );
    }

    const payload = parseExportGenerateJobPayload(parsedEnvelope.envelope.payload);

    if (payload.organizationId !== tenantContext.organizationId) {
      // Tenant isolation: never serve another org's export.
      return jsonError("EXPORT_NOT_FOUND", "Export was not found.", 404);
    }

    // Regenerate from the SAME filter contract (queryLeadWorkspace) so the
    // download always equals the current filtered CRM result and reruns match.
    const { rows } = await collectLeadWorkspaceExportRows({
      organizationId: tenantContext.organizationId,
      filters: payload.filters,
    });
    const overlay = await loadLeadExportOverlay(
      prisma,
      tenantContext.organizationId,
      rows.map((row) => row.leadAssignmentId)
    );
    const csv = serializeLeadWorkspaceCsv(rows, overlay);

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lead-export-${exportId.trim()}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return jsonError(
        error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
        error.code === "UNAUTHENTICATED"
          ? "Authentication is required."
          : "You do not have permission to download this export.",
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("V2 export download failed", error);

    return jsonError("EXPORT_DOWNLOAD_FAILED", "Export download failed.", 500);
  }
}

function getExportId(params: unknown) {
  if (!params || typeof params !== "object") {
    return undefined;
  }

  const value = (params as { exportId?: unknown }).exportId;

  return typeof value === "string" ? value : undefined;
}

function jsonError(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
