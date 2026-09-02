import { NextResponse } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

type RouteContext = {
  params: Promise<unknown>;
};

type IngestionJobProgressRow = {
  id: string;
  status: string;
  jobType: string;
  originalFileName: string;
  createdAt: Date;
  updatedAt: Date;
};

type JobProgressRow = {
  id: string;
  jobType: string;
  status: string;
  progressCurrent: number;
  progressTotal: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  idempotencyKey: string;
  resultSnapshotJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type StageGroupJob = {
  id: string;
  jobType: string;
  status: string;
  progressCurrent: number;
  progressTotal: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type StageGroup = {
  stage: string;
  label: string;
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  retryScheduled: number;
  cancelled: number;
  progressCurrent: number;
  progressTotal: number | null;
  latestErrorCode: string | null;
  latestErrorMessage: string | null;
  jobs: StageGroupJob[];
};

type RowStatusCount = {
  rowStatus: string;
  count: number;
};

type IdentityBucketCount = {
  bucket: string;
  count: number;
};

type QualificationBucketCount = {
  qualification: string | null;
  isNotScored: boolean;
  count: number;
};

type ResearchSnapshotStatusCount = {
  status: string;
  count: number;
};

const ACTIVE_JOB_STATUSES = new Set(["QUEUED", "RUNNING", "RETRY_SCHEDULED"]);
type CanonicalQualification =
  | "QUALIFIED"
  | "COMPANY_QUALIFIED_NEEDS_CONTACT"
  | "NEEDS_REVIEW"
  | "UNQUALIFIED"
  | "NOT_SCORED";

export async function GET(_request: Request, context: RouteContext) {
  try {
    const tenantContext = await requirePermission("ingestion.apply");
    const ingestionJobId = getJobId(await context.params);

    if (!ingestionJobId) {
      return progressJson(
        errorBody("INGESTION_JOB_REQUIRED", "Ingestion job id is required."),
        400
      );
    }

    const [
      jobRows,
      directJobs,
      rowStatusRows,
      identityRows,
      qualificationRows,
      researchSnapshotRows,
    ] = await Promise.all([
        prisma.$queryRaw<IngestionJobProgressRow[]>`
          SELECT "id", "status", "jobType", "originalFileName", "createdAt", "updatedAt"
          FROM "V2IngestionJob"
          WHERE "id" = ${ingestionJobId}
            AND "organizationId" = ${tenantContext.organizationId}
          LIMIT 1
        `,
        prisma.$queryRaw<JobProgressRow[]>`
          SELECT
            "id",
            "jobType"::text AS "jobType",
            "status"::text AS "status",
            "progressCurrent",
            "progressTotal",
            "errorCode",
            "errorMessage",
            "idempotencyKey",
            "resultSnapshotJson",
            "createdAt",
            "updatedAt"
          FROM "V2Job"
          WHERE "organizationId" = ${tenantContext.organizationId}
            AND "sourceType" = 'INGESTION_JOB'
            AND "sourceId" = ${ingestionJobId}
          ORDER BY "createdAt" ASC
        `,
        prisma.$queryRaw<RowStatusCount[]>`
          SELECT "rowStatus"::text AS "rowStatus", COUNT(*)::int AS "count"
          FROM "V2IngestionRow"
          WHERE "organizationId" = ${tenantContext.organizationId}
            AND "jobId" = ${ingestionJobId}
          GROUP BY "rowStatus"
        `,
        prisma.$queryRaw<IdentityBucketCount[]>`
          SELECT
            CASE
              WHEN "rowStatus" = 'ERROR' THEN 'error'
              WHEN "rowStatus" = 'MATCHED' THEN 'matched'
              WHEN "normalizedRowJson"->'identityMatch'->>'kind' = 'candidate' THEN 'ambiguous'
              WHEN "normalizedRowJson"->'identityMatch'->>'kind' = 'none' THEN 'none'
              ELSE 'raw'
            END AS "bucket",
            COUNT(*)::int AS "count"
          FROM "V2IngestionRow"
          WHERE "organizationId" = ${tenantContext.organizationId}
            AND "jobId" = ${ingestionJobId}
          GROUP BY "bucket"
        `,
        prisma.$queryRaw<QualificationBucketCount[]>`
          WITH linked_leads AS (
            SELECT DISTINCT
              "normalizedRowJson"->'leadAssignmentUpsert'->>'leadAssignmentId' AS "leadAssignmentId"
            FROM "V2IngestionRow"
            WHERE "organizationId" = ${tenantContext.organizationId}
              AND "jobId" = ${ingestionJobId}
              AND "normalizedRowJson"->'leadAssignmentUpsert'->>'leadAssignmentId' IS NOT NULL
          )
          SELECT
            assessment."qualification"::text AS "qualification",
            (lead."latestHardRuleAssessmentId" IS NULL) AS "isNotScored",
            COUNT(*)::int AS "count"
          FROM linked_leads
          INNER JOIN "V2LeadAssignment" lead
            ON lead."id" = linked_leads."leadAssignmentId"
            AND lead."organizationId" = ${tenantContext.organizationId}
            AND lead."status" = 'ACTIVE'
            AND lead."deletedAt" IS NULL
          LEFT JOIN "V2HardRuleAssessment" assessment
            ON assessment."id" = lead."latestHardRuleAssessmentId"
            AND assessment."organizationId" = lead."organizationId"
          GROUP BY assessment."qualification", lead."latestHardRuleAssessmentId"
        `,
        prisma.$queryRaw<ResearchSnapshotStatusCount[]>`
          WITH linked_companies AS (
            SELECT DISTINCT "matchedCompanyId" AS "companyId"
            FROM "V2IngestionRow"
            WHERE "organizationId" = ${tenantContext.organizationId}
              AND "jobId" = ${ingestionJobId}
              AND "matchedCompanyId" IS NOT NULL
          ),
          latest_snapshot AS (
            SELECT DISTINCT ON (snapshot."companyId")
              snapshot."companyId",
              snapshot."status"::text AS "status"
            FROM "V2CompanyResearchSnapshot" snapshot
            INNER JOIN linked_companies
              ON linked_companies."companyId" = snapshot."companyId"
            WHERE snapshot."organizationId" = ${tenantContext.organizationId}
            ORDER BY snapshot."companyId", snapshot."createdAt" DESC, snapshot."researchVersion" DESC, snapshot."id" DESC
          )
          SELECT "status", COUNT(*)::int AS "count"
          FROM latest_snapshot
          GROUP BY "status"
        `,
      ]);
    const ingestionJob = jobRows[0];

    if (!ingestionJob) {
      return progressJson(
        errorBody("INGESTION_JOB_NOT_FOUND", "Ingestion job was not found."),
        404
      );
    }

    const enrichmentJobLink = deriveEnrichmentJobLink(directJobs);
    const enrichmentJobs =
      enrichmentJobLink.idempotencyKeys.length > 0
        ? await prisma.$queryRaw<JobProgressRow[]>`
            SELECT
              "id",
              "jobType"::text AS "jobType",
              "status"::text AS "status",
              "progressCurrent",
              "progressTotal",
              "errorCode",
              "errorMessage",
              "idempotencyKey",
              "resultSnapshotJson",
              "createdAt",
              "updatedAt"
            FROM "V2Job"
            WHERE "organizationId" = ${tenantContext.organizationId}
              AND "jobType" = 'COMPANY_ENRICHMENT'
              AND "idempotencyKey" = ANY(${enrichmentJobLink.idempotencyKeys}::text[])
            ORDER BY "createdAt" ASC
          `
        : [];
    const scoreJobLink = deriveScoreJobLink([...directJobs, ...enrichmentJobs]);
    const scoreJobs =
      scoreJobLink.idempotencyKeys.length > 0
        ? await prisma.$queryRaw<JobProgressRow[]>`
            SELECT
              "id",
              "jobType"::text AS "jobType",
              "status"::text AS "status",
              "progressCurrent",
              "progressTotal",
              "errorCode",
              "errorMessage",
              "idempotencyKey",
              "resultSnapshotJson",
              "createdAt",
              "updatedAt"
            FROM "V2Job"
            WHERE "organizationId" = ${tenantContext.organizationId}
              AND "jobType" = 'ICP_SCORE'
              AND "idempotencyKey" = ANY(${scoreJobLink.idempotencyKeys}::text[])
            ORDER BY "createdAt" ASC
          `
        : [];
    const allJobs = dedupeJobs([...directJobs, ...enrichmentJobs, ...scoreJobs]);
    const terminal = allJobs.every((job) => !ACTIVE_JOB_STATUSES.has(job.status));
    const qualificationCounts = buildQualificationCounts(qualificationRows);

    return progressJson({
      ok: true,
      ingestionJob: {
        id: ingestionJob.id,
        status: ingestionJob.status,
        jobType: ingestionJob.jobType,
        originalFileName: ingestionJob.originalFileName,
        createdAt: ingestionJob.createdAt.toISOString(),
        updatedAt: ingestionJob.updatedAt.toISOString(),
      },
      jobs: allJobs.map((job) => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        progressCurrent: job.progressCurrent,
        progressTotal: job.progressTotal,
        errorCode: job.errorCode,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
      rowStatusCounts: buildRowStatusCounts(rowStatusRows),
      identityCounts: buildIdentityCounts(identityRows),
      enrichmentCounts: buildEnrichmentCounts(
        researchSnapshotRows,
        enrichmentJobs
      ),
      qualificationCounts: qualificationCounts.counts,
      groupedStages: buildGroupedStages(allJobs),
      diagnostics: {
        scoreJobLinkState: scoreJobLink.state,
        unknownNonCanonicalQualificationCount:
          qualificationCounts.unknownNonCanonical,
      },
      polling: {
        terminal,
        intervalMs: terminal ? null : 2500,
      },
    });
  } catch (error) {
    if (error instanceof V2TenantError) {
      return progressJson(
        errorBody(
          error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
          "You do not have permission to view this ingestion progress."
        ),
        error.code === "UNAUTHENTICATED" ? 401 : 403
      );
    }

    console.error("INGESTION_PROGRESS_FAILED", error);

    return progressJson(
      errorBody("INGESTION_PROGRESS_FAILED", "Progress request failed."),
      500
    );
  }
}

function deriveScoreJobLink(jobs: JobProgressRow[]) {
  const upsertJobs = jobs.filter((job) =>
    job.jobType === "LEAD_ASSIGNMENT_UPSERT" ||
    job.jobType === "COMPANY_ENRICHMENT"
  );
  const idempotencyKeys = new Set<string>();
  let malformed = false;

  for (const job of upsertJobs) {
    const key = readScoreJobIdempotencyKey(job.resultSnapshotJson);

    if (key === undefined) {
      malformed = true;
      continue;
    }

    if (key) {
      idempotencyKeys.add(key);
    }
  }

  return {
    state:
      idempotencyKeys.size > 0
        ? "linked"
        : malformed
          ? "malformed"
          : "missing",
    idempotencyKeys: Array.from(idempotencyKeys).sort(),
  };
}

function deriveEnrichmentJobLink(jobs: JobProgressRow[]) {
  const upsertJobs = jobs.filter((job) => job.jobType === "LEAD_ASSIGNMENT_UPSERT");
  const idempotencyKeys = new Set<string>();

  for (const job of upsertJobs) {
    for (const key of readEnrichmentJobIdempotencyKeys(job.resultSnapshotJson)) {
      idempotencyKeys.add(key);
    }
  }

  return {
    idempotencyKeys: Array.from(idempotencyKeys).sort(),
  };
}

function readScoreJobIdempotencyKey(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const scoreJob = (value as { scoreJob?: unknown }).scoreJob;

  if (scoreJob === null || scoreJob === undefined) {
    return null;
  }

  if (typeof scoreJob !== "object" || Array.isArray(scoreJob)) {
    return undefined;
  }

  const key = (scoreJob as { idempotencyKey?: unknown }).idempotencyKey;

  return typeof key === "string" && key.trim() ? key.trim() : undefined;
}

function readEnrichmentJobIdempotencyKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const enrichmentJobs = (value as { enrichmentJobs?: unknown }).enrichmentJobs;

  if (!Array.isArray(enrichmentJobs)) {
    return [];
  }

  return enrichmentJobs
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const key = (item as { idempotencyKey?: unknown }).idempotencyKey;

      return typeof key === "string" && key.trim() ? key.trim() : null;
    })
    .filter((key): key is string => key !== null);
}

function buildRowStatusCounts(rows: RowStatusCount[]) {
  const counts = {
    RAW: 0,
    NORMALIZED: 0,
    MATCHED: 0,
    APPLIED: 0,
    ERROR: 0,
  };

  for (const row of rows) {
    if (row.rowStatus in counts) {
      counts[row.rowStatus as keyof typeof counts] = Number(row.count);
    }
  }

  return counts;
}

function buildIdentityCounts(rows: IdentityBucketCount[]) {
  const counts = {
    matched: 0,
    ambiguous: 0,
    none: 0,
    error: 0,
    raw: 0,
  };

  for (const row of rows) {
    if (row.bucket in counts) {
      counts[row.bucket as keyof typeof counts] = Number(row.count);
    }
  }

  return counts;
}

function buildEnrichmentCounts(
  rows: ResearchSnapshotStatusCount[],
  enrichmentJobs: JobProgressRow[]
) {
  const counts = {
    enriched: 0,
    partial: 0,
    parked: 0,
    blocked: 0,
    no_website: 0,
    not_run: 0,
    queued: 0,
  };

  for (const row of rows) {
    const count = Number(row.count);

    if (row.status === "SUCCESS") {
      counts.enriched += count;
    } else if (row.status === "PARTIAL" || row.status === "JS_RENDER_REQUIRED") {
      counts.partial += count;
    } else if (row.status === "PARKED") {
      counts.parked += count;
    } else if (row.status === "BLOCKED") {
      counts.blocked += count;
    } else if (row.status === "NO_WEBSITE") {
      counts.no_website += count;
    } else if (row.status === "NOT_RUN") {
      counts.not_run += count;
    }
  }

  counts.queued = enrichmentJobs.filter((job) =>
    ACTIVE_JOB_STATUSES.has(job.status)
  ).length;

  return counts;
}

function buildQualificationCounts(rows: QualificationBucketCount[]) {
  const counts: Record<CanonicalQualification, number> = {
    QUALIFIED: 0,
    COMPANY_QUALIFIED_NEEDS_CONTACT: 0,
    NEEDS_REVIEW: 0,
    UNQUALIFIED: 0,
    NOT_SCORED: 0,
  };
  let unknownNonCanonical = 0;

  for (const row of rows) {
    const count = Number(row.count);

    if (row.isNotScored) {
      counts.NOT_SCORED += count;
      continue;
    }

    if (isCanonicalQualification(row.qualification)) {
      counts[row.qualification] += count;
    } else {
      unknownNonCanonical += count;
    }
  }

  return { counts, unknownNonCanonical };
}

function isCanonicalQualification(
  value: string | null
): value is Exclude<CanonicalQualification, "NOT_SCORED"> {
  return (
    value === "QUALIFIED" ||
    value === "COMPANY_QUALIFIED_NEEDS_CONTACT" ||
    value === "NEEDS_REVIEW" ||
    value === "UNQUALIFIED"
  );
}

function dedupeJobs(jobs: JobProgressRow[]) {
  const byId = new Map<string, JobProgressRow>();

  for (const job of jobs) {
    byId.set(job.id, job);
  }

  return Array.from(byId.values()).sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime()
  );
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

function progressJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function buildGroupedStages(jobs: JobProgressRow[]) {
  const groups = new Map<string, StageGroup>();
  const STAGES = [
    "INGESTION_PARSE",
    "INGESTION_NORMALIZE",
    "IDENTITY_MATCH",
    "LEAD_ASSIGNMENT_UPSERT",
    "COMPANY_ENRICHMENT",
    "ICP_SCORE",
  ];

  for (const job of jobs) {
    const stage = STAGES.includes(job.jobType) ? job.jobType : "OTHER";
    
    if (!groups.has(stage)) {
      groups.set(stage, {
        stage,
        label: formatLabel(job.jobType),
        total: 0,
        queued: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        retryScheduled: 0,
        cancelled: 0,
        progressCurrent: 0,
        progressTotal: null as number | null,
        latestErrorCode: null as string | null,
        latestErrorMessage: null as string | null,
        jobs: [],
      });
    }

    const group = groups.get(stage)!;
    group.total += 1;
    
    if (job.status === "QUEUED") group.queued += 1;
    else if (job.status === "RUNNING") group.running += 1;
    else if (job.status === "SUCCEEDED") group.succeeded += 1;
    else if (job.status === "FAILED") group.failed += 1;
    else if (job.status === "RETRY_SCHEDULED") group.retryScheduled += 1;
    else if (job.status === "CANCELLED") group.cancelled += 1;

    group.progressCurrent += job.progressCurrent;
    if (job.progressTotal !== null) {
      group.progressTotal = (group.progressTotal || 0) + job.progressTotal;
    }

    if (job.errorCode) {
      group.latestErrorCode = job.errorCode;
      group.latestErrorMessage = job.errorMessage;
    }

    group.jobs.push({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      progressCurrent: job.progressCurrent,
      progressTotal: job.progressTotal,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    });
  }

  // Ensure stages are returned in order
  const result: StageGroup[] = [];
  for (const stage of STAGES) {
    const group = groups.get(stage);
    if (group) {
      result.push(group);
      groups.delete(stage);
    }
  }
  
  for (const remaining of Array.from(groups.values())) {
    result.push(remaining);
  }

  return result;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

