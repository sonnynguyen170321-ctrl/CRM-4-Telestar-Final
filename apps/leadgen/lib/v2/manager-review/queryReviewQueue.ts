import "server-only";

import {
  getDefaultManagerReviewDb,
  isManagerReviewPriority,
  isManagerReviewSourceType,
  mapReviewItem,
  type ManagerReviewDb,
  type ManagerReviewPriority,
  type ManagerReviewQueueRow,
  type ManagerReviewSourceType,
  type ManagerReviewStatus,
  type ManagerReviewSqlRow,
} from "./types";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

export type QueryReviewQueueInput = {
  organizationId: string;
  page?: number;
  pageSize?: number;
  filters?: {
    reviewItemId?: string;
    status?: ManagerReviewStatus;
    priority?: ManagerReviewPriority;
    assignedToUserId?: string | null;
    sourceType?: ManagerReviewSourceType;
    leadAssignmentId?: string;
    createdFrom?: Date | string;
    createdTo?: Date | string;
    includeDeleted?: boolean;
  };
};

export type QueryReviewQueueResult = {
  rows: ManagerReviewQueueRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type ReviewQueueSqlRow = ManagerReviewSqlRow & {
  assigneeName: string | null;
  assigneeEmailNormalized: string | null;
  createdByName: string | null;
  createdByEmailNormalized: string | null;
  resolvedByName: string | null;
  resolvedByEmailNormalized: string | null;
  assignmentLevel: string | null;
  workflowStatus: string | null;
  latestHardRuleAssessmentId: string | null;
  companyName: string | null;
  companyDomain: string | null;
  companyWebsiteUrl: string | null;
  contactName: string | null;
  contactTitle: string | null;
  projectName: string | null;
  icpVersionNumber: number | null;
  icpProfileName: string | null;
  assessmentId: string | null;
  assessmentFitScore: number | null;
  assessmentConfidence: string | number | null;
  assessmentQualification: string | null;
  assessmentCompanyType: string | null;
  assessmentReason: string | null;
  assessmentCreatedAt: Date | string | null;
  contextCompanyId: string | null;
  contextContactId: string | null;
  contextProjectId: string | null;
  contextIcpVersionId: string | null;
};

export async function queryReviewQueue(
  input: QueryReviewQueueInput,
  db?: ManagerReviewDb
): Promise<QueryReviewQueueResult> {
  const activeDb = db ?? (await getDefaultManagerReviewDb());
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  const builder = createReviewQueueWhereBuilder(input);
  const rows = await activeDb.$queryRawUnsafe<ReviewQueueSqlRow[]>(
    buildReviewQueueRowsSql(builder.whereSql, pageSize, offset),
    ...builder.params
  );
  const countRows = await activeDb.$queryRawUnsafe<Array<{ total: bigint | number }>>(
    buildReviewQueueCountSql(builder.whereSql),
    ...builder.params
  );
  const total = Number(countRows[0]?.total ?? 0);

  return {
    rows: rows.map(mapQueueRow),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

function buildReviewQueueRowsSql(whereSql: string, limit: number, offset: number) {
  return `
    SELECT
      item."id",
      item."organizationId",
      item."leadAssignmentId",
      item."hardRuleAssessmentId",
      item."projectId",
      item."companyId",
      item."contactId",
      item."icpVersionId",
      item."sourceType"::text AS "sourceType",
      item."sourceId",
      item."sourceRefJson",
      item."sourceFingerprint",
      item."reasonCode"::text AS "reasonCode",
      item."reasonDetail",
      item."suggestedAction",
      item."priority"::text AS "priority",
      item."confidence"::text AS "confidence",
      item."candidateSummariesJson",
      item."metadataJson",
      item."status"::text AS "status",
      item."assignedToUserId",
      item."createdByUserId",
      item."resolvedByUserId",
      item."resolutionType"::text AS "resolutionType",
      item."resolutionNote",
      item."resolutionMetadataJson",
      item."dueAt",
      item."snoozedUntil",
      item."resolvedAt",
      item."archivedAt",
      item."deletedAt",
      item."createdAt",
      item."updatedAt",
      company."id" AS "contextCompanyId",
      contact."id" AS "contextContactId",
      project."id" AS "contextProjectId",
      icp."id" AS "contextIcpVersionId",
      assignee."name" AS "assigneeName",
      assignee."emailNormalized" AS "assigneeEmailNormalized",
      creator."name" AS "createdByName",
      creator."emailNormalized" AS "createdByEmailNormalized",
      resolver."name" AS "resolvedByName",
      resolver."emailNormalized" AS "resolvedByEmailNormalized",
      lead."assignmentLevel"::text AS "assignmentLevel",
      lead."workflowStatus"::text AS "workflowStatus",
      lead."latestHardRuleAssessmentId",
      company."name" AS "companyName",
      company."canonicalDomain" AS "companyDomain",
      company."websiteUrl" AS "companyWebsiteUrl",
      contact."fullName" AS "contactName",
      contact."title" AS "contactTitle",
      project."name" AS "projectName",
      icp."versionNumber" AS "icpVersionNumber",
      profile."name" AS "icpProfileName",
      assessment."id" AS "assessmentId",
      assessment."fitScore" AS "assessmentFitScore",
      assessment."confidence" AS "assessmentConfidence",
      assessment."qualification"::text AS "assessmentQualification",
      assessment."accountPreRank"::text AS "assessmentAccountPreRank",
      assessment."companyType" AS "assessmentCompanyType",
      assessment."reason" AS "assessmentReason",
      assessment."createdAt" AS "assessmentCreatedAt"
    ${buildReviewQueueFromSql()}
    WHERE ${whereSql}
    ORDER BY item."priority" DESC, item."createdAt" DESC, item."id" ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

function buildReviewQueueCountSql(whereSql: string) {
  return `
    SELECT COUNT(*) AS "total"
    FROM "V2ManagerReviewItem" item
    WHERE ${whereSql}
  `;
}

function buildReviewQueueFromSql() {
  return `
    FROM "V2ManagerReviewItem" item
    LEFT JOIN "V2User" assignee
      ON assignee."id" = item."assignedToUserId"
      AND assignee."status" = 'ACTIVE'
    LEFT JOIN "V2User" creator
      ON creator."id" = item."createdByUserId"
      AND creator."status" = 'ACTIVE'
    LEFT JOIN "V2User" resolver
      ON resolver."id" = item."resolvedByUserId"
      AND resolver."status" = 'ACTIVE'
    LEFT JOIN "V2LeadAssignment" lead
      ON lead."id" = item."leadAssignmentId"
      AND lead."organizationId" = item."organizationId"
      AND lead."status" = 'ACTIVE'
      AND lead."deletedAt" IS NULL
    LEFT JOIN "V2Company" company
      ON company."id" = COALESCE(item."companyId", lead."companyId")
      AND company."organizationId" = item."organizationId"
      AND company."status" = 'ACTIVE'
      AND company."deletedAt" IS NULL
    LEFT JOIN "V2Contact" contact
      ON contact."id" = COALESCE(item."contactId", lead."contactId")
      AND contact."organizationId" = item."organizationId"
      AND contact."status" = 'ACTIVE'
      AND contact."deletedAt" IS NULL
    LEFT JOIN "V2Project" project
      ON project."id" = COALESCE(item."projectId", lead."projectId")
      AND project."organizationId" = item."organizationId"
      AND project."status" = 'ACTIVE'
    LEFT JOIN "V2ICPVersion" icp
      ON icp."id" = COALESCE(item."icpVersionId", lead."icpVersionId")
      AND icp."organizationId" = item."organizationId"
      AND icp."deletedAt" IS NULL
    LEFT JOIN "V2ICPProfile" profile
      ON profile."id" = icp."icpProfileId"
      AND profile."organizationId" = item."organizationId"
      AND profile."status" = 'ACTIVE'
    LEFT JOIN "V2HardRuleAssessment" assessment
      ON assessment."id" = COALESCE(
        item."hardRuleAssessmentId",
        lead."latestHardRuleAssessmentId"
      )
      AND assessment."organizationId" = item."organizationId"
  `;
}

function createReviewQueueWhereBuilder(input: QueryReviewQueueInput) {
  const params: unknown[] = [input.organizationId];
  const clauses = [`item."organizationId" = $1`];
  const add = (value: unknown) => {
    params.push(value);

    return `$${params.length}`;
  };

  if (!input.filters?.includeDeleted) {
    clauses.push(`item."deletedAt" IS NULL`);
  }

  if (input.filters?.status) {
    clauses.push(`item."status" = ${add(input.filters.status)}::"V2ManagerReviewStatus"`);
  }

  if (input.filters?.reviewItemId) {
    clauses.push(`item."id" = ${add(input.filters.reviewItemId)}`);
  }

  if (input.filters?.priority && isManagerReviewPriority(input.filters.priority)) {
    clauses.push(`item."priority" = ${add(input.filters.priority)}::"V2ManagerReviewPriority"`);
  }

  if (input.filters?.assignedToUserId !== undefined) {
    if (input.filters.assignedToUserId === null) {
      clauses.push(`item."assignedToUserId" IS NULL`);
    } else {
      clauses.push(`item."assignedToUserId" = ${add(input.filters.assignedToUserId)}`);
    }
  }

  if (input.filters?.sourceType && isManagerReviewSourceType(input.filters.sourceType)) {
    clauses.push(`item."sourceType" = ${add(input.filters.sourceType)}::"V2ManagerReviewSourceType"`);
  }

  if (input.filters?.leadAssignmentId) {
    clauses.push(`item."leadAssignmentId" = ${add(input.filters.leadAssignmentId)}`);
  }

  if (input.filters?.createdFrom) {
    clauses.push(`item."createdAt" >= ${add(input.filters.createdFrom)}::timestamp`);
  }

  if (input.filters?.createdTo) {
    clauses.push(`item."createdAt" <= ${add(input.filters.createdTo)}::timestamp`);
  }

  return {
    params,
    whereSql: clauses.join(" AND "),
  };
}

function mapQueueRow(row: ReviewQueueSqlRow): ManagerReviewQueueRow {
  return {
    item: mapReviewItem(row),
    context: {
      assignee: row.assignedToUserId && row.assigneeEmailNormalized
        ? {
            id: row.assignedToUserId,
            name: row.assigneeName,
            emailNormalized: row.assigneeEmailNormalized,
          }
        : null,
      createdBy: row.createdByUserId && row.createdByEmailNormalized
        ? {
            id: row.createdByUserId,
            name: row.createdByName,
            emailNormalized: row.createdByEmailNormalized,
          }
        : null,
      resolvedBy: row.resolvedByUserId && row.resolvedByEmailNormalized
        ? {
            id: row.resolvedByUserId,
            name: row.resolvedByName,
            emailNormalized: row.resolvedByEmailNormalized,
          }
        : null,
      leadAssignment: row.leadAssignmentId && row.assignmentLevel && row.workflowStatus
        ? {
            id: row.leadAssignmentId,
            assignmentLevel: row.assignmentLevel,
            workflowStatus: row.workflowStatus,
            latestHardRuleAssessmentId: row.latestHardRuleAssessmentId,
          }
        : null,
      company: row.contextCompanyId && row.companyName
        ? {
            id: row.contextCompanyId,
            name: row.companyName,
            canonicalDomain: row.companyDomain,
            websiteUrl: row.companyWebsiteUrl,
          }
        : null,
      contact: row.contextContactId && row.contactName
        ? {
            id: row.contextContactId,
            fullName: row.contactName,
            title: row.contactTitle,
          }
        : null,
      project: row.contextProjectId && row.projectName
        ? { id: row.contextProjectId, name: row.projectName }
        : null,
      icpVersion: row.contextIcpVersionId && row.icpVersionNumber !== null
        ? {
            id: row.contextIcpVersionId,
            versionNumber: Number(row.icpVersionNumber),
            icpProfileName: row.icpProfileName,
          }
        : null,
      latestAssessment: row.assessmentId && row.assessmentFitScore !== null
        ? {
            id: row.assessmentId,
            fitScore: Number(row.assessmentFitScore),
            confidence: Number(row.assessmentConfidence),
            qualification: row.assessmentQualification ?? "NOT_SCORED",
            companyType: row.assessmentCompanyType,
            reason: row.assessmentReason ?? "",
            createdAt: row.assessmentCreatedAt
              ? new Date(row.assessmentCreatedAt).toISOString()
              : new Date(0).toISOString(),
          }
        : null,
    },
  };
}

function normalizePage(value: number | undefined) {
  return Number.isInteger(value) && value && value > 0 ? value : 1;
}

function normalizePageSize(value: number | undefined) {
  return Number.isInteger(value) && value && value > 0
    ? Math.min(value, MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
}
