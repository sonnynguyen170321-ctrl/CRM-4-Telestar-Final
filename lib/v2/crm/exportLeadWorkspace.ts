import { createHash } from "node:crypto";

import { createNonRetryableJobError } from "@/lib/v2/jobs/errors";
import type { V2JobHandler } from "@/lib/v2/jobs/types";

import { queryLeadWorkspace, type LeadWorkspaceDb } from "./queryLeadWorkspace";
import type {
  LeadWorkspaceFilters,
  LeadWorkspaceQueryResult,
  LeadWorkspaceRow,
} from "./types";

export const EXPORT_GENERATE_JOB_SCHEMA_VERSION = "v2.export.lead-workspace.v1";
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_ROWS = 100_000;

export type ExportGenerateJobPayload = {
  schemaVersion: typeof EXPORT_GENERATE_JOB_SCHEMA_VERSION;
  organizationId: string;
  filters: LeadWorkspaceFilters;
  requestId: string;
};

export type LeadExportOverlay = Map<
  string,
  { openReviewCount: number; feedbackCount: number }
>;

export type CollectLeadExportDeps = {
  // Injectable for tests; defaults to the real tenant-scoped CRM query so the
  // export reuses the SAME filter contract as the lead workspace (no parallel
  // lead query — M4 contract).
  fetchPage?: (
    input: {
      organizationId: string;
      page: number;
      pageSize: number;
      filters: LeadWorkspaceFilters;
    },
    db?: LeadWorkspaceDb
  ) => Promise<LeadWorkspaceQueryResult>;
  db?: LeadWorkspaceDb;
};

/**
 * Collect EVERY lead row matching the filters by paging the existing
 * `queryLeadWorkspace`. The returned `total` is the CRM count for the same
 * filters, so the export row count equals the filtered CRM count by
 * construction (M4 exit proof).
 */
export async function collectLeadWorkspaceExportRows(
  input: { organizationId: string; filters: LeadWorkspaceFilters },
  deps: CollectLeadExportDeps = {}
): Promise<{ rows: LeadWorkspaceRow[]; total: number }> {
  const fetchPage = deps.fetchPage ?? queryLeadWorkspace;
  const rows: LeadWorkspaceRow[] = [];
  let page = 1;
  let total = 0;

  // Page until we have collected the reported total (or hit the safety cap).
  for (;;) {
    const result = await fetchPage(
      {
        organizationId: input.organizationId,
        page,
        pageSize: EXPORT_PAGE_SIZE,
        filters: input.filters,
      },
      deps.db
    );

    total = result.pagination.total;
    rows.push(...result.rows);

    if (
      result.rows.length === 0 ||
      rows.length >= total ||
      rows.length >= EXPORT_MAX_ROWS ||
      page >= result.pagination.totalPages
    ) {
      break;
    }

    page += 1;
  }

  return { rows, total };
}

export const LEAD_EXPORT_COLUMNS = [
  "leadAssignmentId",
  "companyName",
  "companyDomain",
  "companyCountry",
  "contactName",
  "contactTitle",
  "assignmentLevel",
  "workflowStatus",
  "qualification",
  "accountPreRank",
  "fitScore",
  "confidence",
  "latestAssessmentId",
  "scoringVersion",
  "inputFingerprint",
  "icpRulesHash",
  "assessmentCreatedAt",
  "sourceIngestionJobId",
  "openReviewCount",
  "feedbackCount",
] as const;

/**
 * Serialize export rows to CSV. Includes the immutable assessment snapshot
 * identity (`latestAssessmentId`, `scoringVersion`, `inputFingerprint`,
 * `icpRulesHash`) and an explicit human-overlay (`openReviewCount`,
 * `feedbackCount`). Every row is a LeadAssignment — there is no global company
 * export (Invariant 2).
 */
export function serializeLeadWorkspaceCsv(
  rows: LeadWorkspaceRow[],
  overlay: LeadExportOverlay = new Map()
): string {
  const lines = [LEAD_EXPORT_COLUMNS.map(csvCell).join(",")];

  for (const row of rows) {
    const a = row.latestAssessment;
    const o = overlay.get(row.leadAssignmentId);
    const values = [
      row.leadAssignmentId,
      row.companyName,
      row.companyDomain ?? "",
      row.companyCountry ?? "",
      row.contactName ?? "",
      row.contactTitle ?? "",
      row.assignmentLevel,
      row.workflowStatus,
      row.qualification,
      row.accountPreRank ?? "",
      a ? String(a.fitScore) : "",
      a ? String(a.confidence) : "",
      a?.id ?? "",
      a?.scoringVersion ?? "",
      a?.inputFingerprint ?? "",
      a?.icpRulesHash ?? "",
      a?.createdAt ?? "",
      row.sourceIngestionJobId ?? "",
      String(o?.openReviewCount ?? 0),
      String(o?.feedbackCount ?? 0),
    ];
    lines.push(values.map(csvCell).join(","));
  }

  return lines.join("\r\n");
}

function csvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);

  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function buildExportFilterHash(filters: LeadWorkspaceFilters): string {
  return createHash("sha256").update(stableSerialize(filters)).digest("hex");
}

export function buildExportGenerateIdempotencyKey(
  organizationId: string,
  filters: LeadWorkspaceFilters,
  requestId: string
): string {
  return `export:${organizationId}:${buildExportFilterHash(filters)}:${requestId}`;
}

export function parseExportGenerateJobPayload(
  payload: unknown
): ExportGenerateJobPayload {
  if (!payload || typeof payload !== "object") {
    throw new Error("EXPORT_GENERATE payload must be an object.");
  }

  const raw = payload as Record<string, unknown>;

  if (raw.schemaVersion !== EXPORT_GENERATE_JOB_SCHEMA_VERSION) {
    throw new Error(
      `EXPORT_GENERATE payload schemaVersion must be ${EXPORT_GENERATE_JOB_SCHEMA_VERSION}.`
    );
  }

  if (typeof raw.organizationId !== "string" || !raw.organizationId) {
    throw new Error("EXPORT_GENERATE payload organizationId is required.");
  }

  if (typeof raw.requestId !== "string" || !raw.requestId) {
    throw new Error("EXPORT_GENERATE payload requestId is required.");
  }

  return {
    schemaVersion: EXPORT_GENERATE_JOB_SCHEMA_VERSION,
    organizationId: raw.organizationId,
    filters: (raw.filters ?? {}) as LeadWorkspaceFilters,
    requestId: raw.requestId,
  };
}

/**
 * Per-lead human overlay: count of active manager-review items and feedback
 * examples. Tenant-scoped; additive to the lead rows (not a parallel lead
 * query). Soft-delete respected on the review table.
 */
export async function loadLeadExportOverlay(
  db: LeadWorkspaceDb,
  organizationId: string,
  leadAssignmentIds: string[]
): Promise<LeadExportOverlay> {
  const overlay: LeadExportOverlay = new Map();
  const uniqueIds = Array.from(new Set(leadAssignmentIds.filter(Boolean)));

  if (uniqueIds.length === 0) {
    return overlay;
  }

  const rows = await db.$queryRawUnsafe<
    Array<{
      leadAssignmentId: string;
      openReviewCount: bigint | number;
      feedbackCount: bigint | number;
    }>
  >(
    `
      WITH visible_leads("leadAssignmentId") AS (
        SELECT unnest($2::text[])
      )
      SELECT
        vl."leadAssignmentId",
        COALESCE(reviews."openReviewCount", 0) AS "openReviewCount",
        COALESCE(feedback."feedbackCount", 0) AS "feedbackCount"
      FROM visible_leads vl
      LEFT JOIN (
        SELECT "leadAssignmentId", COUNT(*) AS "openReviewCount"
        FROM "V2ManagerReviewItem"
        WHERE "organizationId" = $1
          AND "deletedAt" IS NULL
          AND "status" IN ('OPEN', 'IN_PROGRESS', 'SNOOZED')
          AND "leadAssignmentId" IS NOT NULL
        GROUP BY "leadAssignmentId"
      ) reviews ON reviews."leadAssignmentId" = vl."leadAssignmentId"
      LEFT JOIN (
        SELECT "leadAssignmentId", COUNT(*) AS "feedbackCount"
        FROM "V2FeedbackExample"
        WHERE "organizationId" = $1
        GROUP BY "leadAssignmentId"
      ) feedback ON feedback."leadAssignmentId" = vl."leadAssignmentId"
    `,
    organizationId,
    uniqueIds
  );

  for (const row of rows) {
    overlay.set(row.leadAssignmentId, {
      openReviewCount: Number(row.openReviewCount),
      feedbackCount: Number(row.feedbackCount),
    });
  }

  return overlay;
}

/**
 * Generate the export deterministically and record a summary (rowCount +
 * contentHash + filterHash) in the job result. The CSV itself is regenerated
 * on download from the SAME filter contract, so reruns are safe and the export
 * count always equals the filtered CRM count.
 */
export const exportGenerateJobHandler: V2JobHandler = async (context) => {
  if (context.organizationId !== context.job.organizationId) {
    throw createNonRetryableJobError(
      "TENANT_MISMATCH",
      "Export job context organization did not match the job organization."
    );
  }

  const payload = parseExportGenerateJobPayload(context.payload);

  if (payload.organizationId !== context.organizationId) {
    throw createNonRetryableJobError(
      "TENANT_MISMATCH",
      "Export payload organization did not match the job organization."
    );
  }

  const { rows, total } = await collectLeadWorkspaceExportRows({
    organizationId: context.organizationId,
    filters: payload.filters,
  });

  await context.updateProgress({ current: rows.length, total });

  const overlay = await loadLeadExportOverlay(
    await getDefaultExportDb(),
    context.organizationId,
    rows.map((row) => row.leadAssignmentId)
  );
  const csv = serializeLeadWorkspaceCsv(rows, overlay);

  return {
    resultSnapshotJson: {
      schemaVersion: "v2.export.result.v1",
      requestId: payload.requestId,
      filterHash: buildExportFilterHash(payload.filters),
      rowCount: rows.length,
      crmTotal: total,
      contentHash: createHash("sha256").update(csv).digest("hex"),
      byteSize: Buffer.byteLength(csv, "utf8"),
      generatedAt: new Date().toISOString(),
    },
    progressCurrent: rows.length,
    progressTotal: total,
  };
};

async function getDefaultExportDb(): Promise<LeadWorkspaceDb> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableSerialize(v)}`)
    .join(",")}}`;
}
