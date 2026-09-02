import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import {
  enqueueIngestionNormalizeJob,
  V2_CANONICAL_MAPPING_FIELDS,
  V2IngestionColumnMappingSchema,
  V2IngestionMappingContextSchema,
  type V2IngestionDatabase,
} from "@/lib/v2/ingestion";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = {
  params: Promise<unknown>;
};

type IngestionJobRow = {
  id: string;
  organizationId: string;
  uploadedByUserId: string | null;
  mappingJson: unknown;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("ingestion.apply");
    const ingestionJobId = getJobId(await context.params);

    if (!ingestionJobId) {
      return mappingJson(errorBody("INGESTION_JOB_REQUIRED", "Ingestion job id is required."), 400);
    }

    const body = await request.json().catch(() => null);
    const parsedMapping = parseColumnMapping(body);

    if (!parsedMapping.ok) {
      return mappingJson(errorBody(parsedMapping.code, parsedMapping.message), 400);
    }

    const job = await loadIngestionJob({
      organizationId: tenantContext.organizationId,
      ingestionJobId,
    });

    if (!job) {
      return mappingJson(errorBody("INGESTION_JOB_NOT_FOUND", "Ingestion job was not found."), 404);
    }

    const currentMapping = V2IngestionMappingContextSchema.safeParse(job.mappingJson);

    if (!currentMapping.success || currentMapping.data.runMode !== "manual_mapping") {
      return mappingJson(errorBody("INGESTION_MAPPING_NOT_ALLOWED", "This ingestion job does not require manual mapping."), 409);
    }

    const uploadHeaders = currentMapping.data.uploadIntake?.headers ?? [];
    const validation = validateMapping(parsedMapping.mapping.fields, uploadHeaders);

    if (!validation.ok) {
      return mappingJson(errorBody(validation.code, validation.message), 400);
    }

    const nextMappingJson = V2IngestionMappingContextSchema.parse({
      ...currentMapping.data,
      columnMapping: parsedMapping.mapping,
      notes: Array.from(new Set([...currentMapping.data.notes, "P1.S4 manual column mapping saved."])),
    });

    await prisma.$queryRaw`
      UPDATE "V2IngestionJob"
      SET "mappingJson" = ${JSON.stringify(nextMappingJson)}::jsonb,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${ingestionJobId}
        AND "organizationId" = ${tenantContext.organizationId}
    `;
    const parseJob = await prisma.v2Job.findFirst({
      where: {
        organizationId: tenantContext.organizationId,
        sourceId: ingestionJobId,
        jobType: "INGESTION_PARSE",
      }
    });

    let normalizeJobKind = "delayed";
    // The parse V2Job is SUCCEEDED when done (row-level validation errors live on
    // the ingestion rows, not the job). VALIDATED_WITH_ERRORS is an ingestion-job
    // status, not a V2Job status, so it can never match here.
    if (parseJob?.status === "SUCCEEDED") {
      const normalizeJob = await enqueueIngestionNormalizeJob(
        prisma as unknown as V2IngestionDatabase,
        {
          organizationId: tenantContext.organizationId,
          ingestionJobId,
          createdByUserId: job.uploadedByUserId ?? tenantContext.userId,
        }
      );
      normalizeJobKind = normalizeJob.kind;
    }

    return mappingJson({
      ok: true,
      code: "INGESTION_MAPPING_SAVED",
      ingestionJobId,
      normalizeJob: normalizeJobKind,
      links: {
        ingestion: `/v2/ingestion/${ingestionJobId}`,
        status: `/v2/ingestion/${ingestionJobId}/status`,
        leads: "/v2/workspace/leads",
      },
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return mappingJson(
        errorBody(error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "You do not have permission to map this ingestion job."),
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("INGESTION_MAPPING_FAILED", error);

    return mappingJson(errorBody("INGESTION_MAPPING_FAILED", "Mapping request failed."), 500);
  }
}

async function loadIngestionJob(input: {
  organizationId: string;
  ingestionJobId: string;
}) {
  const rows = await prisma.$queryRaw<IngestionJobRow[]>`
    SELECT "id", "organizationId", "uploadedByUserId", "mappingJson"
    FROM "V2IngestionJob"
    WHERE "id" = ${input.ingestionJobId}
      AND "organizationId" = ${input.organizationId}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

function parseColumnMapping(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false as const,
      code: "INVALID_COLUMN_MAPPING",
      message: "Column mapping input is invalid.",
    };
  }

  const fields = (value as { fields?: unknown }).fields;
  const parsed = V2IngestionColumnMappingSchema.safeParse({
    schemaVersion: "v2.ingestion.column-mapping.v1",
    fields,
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      code: "INVALID_COLUMN_MAPPING",
      message: "Column mapping input is invalid.",
    };
  }

  return { ok: true as const, mapping: parsed.data };
}

function validateMapping(
  fields: Record<string, string | null>,
  uploadHeaders: string[]
) {
  const headerSet = new Set(uploadHeaders);
  const usedHeaders = new Set<string>();

  if (!fields.company && !fields.website && !fields.domain) {
    return {
      ok: false as const,
      code: "COMPANY_IDENTITY_MAPPING_REQUIRED",
      message: "Map at least one of company, website, or domain.",
    };
  }

  for (const field of V2_CANONICAL_MAPPING_FIELDS) {
    const sourceHeader = fields[field];

    if (!sourceHeader) {
      continue;
    }

    if (!headerSet.has(sourceHeader)) {
      return {
        ok: false as const,
        code: "MAPPED_HEADER_NOT_FOUND",
        message: `Mapped header ${sourceHeader} was not found in the uploaded CSV.`,
      };
    }

    if (usedHeaders.has(sourceHeader)) {
      return {
        ok: false as const,
        code: "DUPLICATE_COLUMN_MAPPING",
        message: "A source column can only be mapped once.",
      };
    }

    usedHeaders.add(sourceHeader);
  }

  return { ok: true as const };
}

function getJobId(params: unknown) {
  if (!params || typeof params !== "object") {
    return null;
  }

  const value = (params as { jobId?: unknown }).jobId;

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorBody(code: string, message: string) {
  return { ok: false, code, message };
}

function mappingJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
