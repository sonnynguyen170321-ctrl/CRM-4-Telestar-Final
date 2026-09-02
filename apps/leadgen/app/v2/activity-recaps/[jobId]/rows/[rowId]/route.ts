import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import {
  cacheGetJson,
  cacheSetJson,
  ingestionRowCacheKey,
} from "@/lib/v2/cache/rowCache";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

// Fast row-inspector API for the activity-recap drawer. The wizard opens the drawer
// client-side (no full-page navigation) and fetches this endpoint; a short-TTL Redis
// cache makes repeat / hover-prefetch opens instant. Tenant-scoped by the session org
// (invariant #5) — the rowId alone never crosses tenants.

const ROW_CACHE_TTL_SECONDS = 30;

type RouteContext = {
  params: Promise<{ jobId: string; rowId: string }>;
};

type IngestionRowRecord = {
  id: string;
  jobId: string;
  sourceRowNumber: number;
  rowStatus: string;
  rawRowJson: unknown;
  normalizedRowJson: unknown;
  matchedCompanyId: string | null;
  matchedContactId: string | null;
  errorMessage: string | null;
  matchedCompanyName: string | null;
  matchedContactName: string | null;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("ingestion.apply");
    const { jobId, rowId } = await context.params;

    if (!jobId || !rowId) {
      return rowJson(errorBody("INGESTION_ROW_REQUIRED", "Job id and row id are required."), 400);
    }

    const cacheKey = ingestionRowCacheKey(tenantContext.organizationId, rowId);
    const cached = await cacheGetJson<{ row: IngestionRowRecord }>(cacheKey);
    if (cached) {
      return rowJson({ ok: true, cached: true, row: cached.row });
    }

    const rows = await prisma.$queryRaw<IngestionRowRecord[]>`
      SELECT
        r."id",
        r."jobId",
        r."sourceRowNumber",
        r."rowStatus"::text AS "rowStatus",
        r."rawRowJson",
        r."normalizedRowJson",
        r."matchedCompanyId",
        r."matchedContactId",
        r."errorMessage",
        c."name" AS "matchedCompanyName",
        ct."fullName" AS "matchedContactName"
      FROM "V2IngestionRow" r
      LEFT JOIN "V2Company" c
        ON c."id" = r."matchedCompanyId" AND c."organizationId" = r."organizationId"
        AND c."status" = 'ACTIVE' AND c."deletedAt" IS NULL
      LEFT JOIN "V2Contact" ct
        ON ct."id" = r."matchedContactId" AND ct."organizationId" = r."organizationId"
        AND ct."status" = 'ACTIVE' AND ct."deletedAt" IS NULL
      WHERE r."organizationId" = ${tenantContext.organizationId}
        AND r."jobId" = ${jobId}
        AND r."id" = ${rowId}
      LIMIT 1
    `;

    const row = rows[0];

    if (!row) {
      return rowJson(errorBody("INGESTION_ROW_NOT_FOUND", "Ingestion row was not found."), 404);
    }

    // Only cache terminal-ish payloads briefly; the short TTL keeps in-flight rows fresh.
    await cacheSetJson(cacheKey, { row }, ROW_CACHE_TTL_SECONDS);

    return rowJson({ ok: true, cached: false, row });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return rowJson(
        errorBody(
          error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
          "You do not have permission to view this ingestion row."
        ),
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("INGESTION_ROW_FETCH_FAILED", error);

    return rowJson(errorBody("INGESTION_ROW_FETCH_FAILED", "Row request failed."), 500);
  }
}

function errorBody(code: string, message: string) {
  return { ok: false, code, message };
}

function rowJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
