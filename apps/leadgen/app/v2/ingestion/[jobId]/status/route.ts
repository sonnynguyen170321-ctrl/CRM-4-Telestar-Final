import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = {
  params: Promise<unknown>;
};

type IngestionJobStatusRow = {
  id: string;
  status: string;
  jobType: string;
  originalFileName: string;
  mappingJson: unknown;
  rowCountsJson: unknown;
  errorSummaryJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ChildJobStatusRow = {
  id: string;
  jobType: string;
  status: string;
  progressCurrent: number;
  progressTotal: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("ingestion.apply");
    const ingestionJobId = getJobId(await context.params);

    if (!ingestionJobId) {
      return statusJson(errorBody("INGESTION_JOB_REQUIRED", "Ingestion job id is required."), 400);
    }

    const [jobRows, childJobs] = await Promise.all([
      prisma.$queryRaw<IngestionJobStatusRow[]>`
        SELECT "id", "status", "jobType", "originalFileName", "mappingJson", "rowCountsJson", "errorSummaryJson", "createdAt", "updatedAt"
        FROM "V2IngestionJob"
        WHERE "id" = ${ingestionJobId}
          AND "organizationId" = ${tenantContext.organizationId}
        LIMIT 1
      `,
      prisma.$queryRaw<ChildJobStatusRow[]>`
        SELECT "id", "jobType", "status", "progressCurrent", "progressTotal", "errorCode", "errorMessage", "createdAt", "updatedAt"
        FROM "V2Job"
        WHERE "organizationId" = ${tenantContext.organizationId}
          AND "sourceType" = 'INGESTION_JOB'
          AND "sourceId" = ${ingestionJobId}
        ORDER BY "createdAt" ASC
      `,
    ]);
    const job = jobRows[0];

    if (!job) {
      return statusJson(errorBody("INGESTION_JOB_NOT_FOUND", "Ingestion job was not found."), 404);
    }

    return statusJson({
      ok: true,
      ingestionJob: {
        id: job.id,
        status: job.status,
        jobType: job.jobType,
        originalFileName: job.originalFileName,
        rowCountsJson: job.rowCountsJson,
        errorSummaryJson: job.errorSummaryJson,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
      mappingState: deriveMappingState(job.mappingJson, childJobs),
      childJobs: childJobs.map((childJob) => ({
        id: childJob.id,
        jobType: childJob.jobType,
        status: childJob.status,
        progressCurrent: childJob.progressCurrent,
        progressTotal: childJob.progressTotal,
        errorCode: childJob.errorCode,
        errorMessage: childJob.errorMessage,
        createdAt: childJob.createdAt.toISOString(),
        updatedAt: childJob.updatedAt.toISOString(),
      })),
      nextUiState: deriveNextUiState(job.mappingJson, childJobs),
      links: {
        ingestion: `/v2/ingestion/${ingestionJobId}`,
        leads: "/v2/workspace/leads",
      },
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return statusJson(
        errorBody(error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "You do not have permission to view this ingestion job."),
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("INGESTION_STATUS_FAILED", error);

    return statusJson(errorBody("INGESTION_STATUS_FAILED", "Status request failed."), 500);
  }
}

function deriveMappingState(mappingJson: unknown, childJobs: ChildJobStatusRow[]) {
  const mapping = readObject(mappingJson);
  const runMode = mapping.runMode;
  const hasColumnMapping = Boolean(mapping.columnMapping);
  const parseSucceeded = childJobs.some(
    (job) => job.jobType === "INGESTION_PARSE" && job.status === "SUCCEEDED"
  );

  if (childJobs.some((job) => job.status === "FAILED")) {
    return "failed";
  }

  if (runMode === "manual_mapping" && parseSucceeded && !hasColumnMapping) {
    return "mapping_required";
  }

  if (hasColumnMapping) {
    return childJobs.some((job) => ["QUEUED", "RUNNING", "RETRY_SCHEDULED"].includes(job.status))
      ? "running"
      : "ready";
  }

  return "running";
}

function deriveNextUiState(mappingJson: unknown, childJobs: ChildJobStatusRow[]) {
  const state = deriveMappingState(mappingJson, childJobs);

  if (state === "mapping_required") {
    return "map_columns";
  }

  if (state === "failed") {
    return "show_errors";
  }

  if (childJobs.some((job) => ["QUEUED", "RUNNING", "RETRY_SCHEDULED"].includes(job.status))) {
    return "wait_for_worker";
  }

  return "open_ingestion_detail";
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function statusJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
