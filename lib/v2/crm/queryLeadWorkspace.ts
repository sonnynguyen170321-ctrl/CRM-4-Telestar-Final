import {
  mapAssessmentRow,
  mapLeadWorkspaceRow,
  type HardRuleAssessmentSqlRow,
  type LeadWorkspaceSqlRow,
} from "./mapLeadWorkspaceRows";
import "server-only";
import { withFacetCache } from "@/lib/v2/bullmq/facetCache";
import { getLatestCompanyIntelligenceProfile } from "@/lib/v2/company-intelligence/readModel";
import type {
  LeadWorkspaceDetail,
  LeadContextOptions,
  LeadWorkspaceFilterOptions,
  LeadWorkspaceFilters,
  LeadWorkspaceQueryInput,
  LeadWorkspaceQueryResult,
} from "./types";

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;
const VALID_ASSIGNMENT_LEVELS = new Set(["COMPANY", "CONTACT"]);
const VALID_QUALIFICATIONS = new Set([
  "QUALIFIED",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
  "NOT_SCORED",
]);
const VALID_SCORED_FILTERS = new Set(["scored", "unscored"]);
const VALID_CONFIDENCE_BANDS = new Set(["HIGH", "MEDIUM", "LOW"]);
const VALID_CONTACT_READINESS = new Set(["has_email", "missing_email"]);
const VALID_ENROLLMENT_FILTERS = new Set(["enrolled", "not_enrolled"]);
const VALID_INTELLIGENCE_STATUSES = new Set([
  "EXTRACTED",
  "PARTIAL",
  "FAILED",
  "PLACEHOLDER",
  "MISSING",
]);

export type LeadWorkspaceDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

export async function queryLeadWorkspace(
  input: LeadWorkspaceQueryInput,
  db?: LeadWorkspaceDb
): Promise<LeadWorkspaceQueryResult> {
  const activeDb = db ?? (await getDefaultDb());
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  const builder = createWhereBuilder(input.organizationId, input.filters);
  const rows = await activeDb.$queryRawUnsafe<LeadWorkspaceSqlRow[]>(
    buildLeadRowsSql(builder.whereSql, pageSize, offset),
    ...builder.params
  );
  const countRows = await activeDb.$queryRawUnsafe<{ total: bigint | number }[]>(
    buildCountSql(builder.whereSql),
    ...builder.params
  );
  const total = Number(countRows[0]?.total ?? 0);
  const mappedRows = rows.map(mapLeadWorkspaceRow);
  const lineage = await loadVisibleLeadLineage(
    activeDb,
    input.organizationId,
    mappedRows.map((row) => row.leadAssignmentId)
  );

  return {
    rows: mappedRows.map((row) => ({
      ...row,
      ...(lineage.get(row.leadAssignmentId) ?? {}),
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export type LeadWorkspaceMetrics = {
  total: number;
  qualified: number;
  needsReview: number;
  needsContact: number;
  unqualified: number;
  notScored: number;
  meetings: number;
};

// Metric strip read-model for /v2/leads. Reuses the SAME tenant-scoped FROM +
// WHERE builder as queryLeadWorkspace so the card counts always equal the
// filtered table total (same source of truth, no drift). NOT_SCORED is DERIVED
// from `latestHardRuleAssessmentId IS NULL` — never a stored qualification row
// (Invariant 7). The four scored buckets + notScored are mutually exclusive and
// sum to total. UNCERTAIN is never counted (deprecated; not a bucket).
export async function queryLeadWorkspaceMetrics(
  input: {
    organizationId: string;
    filters?: LeadWorkspaceFilters;
  },
  db?: LeadWorkspaceDb
): Promise<LeadWorkspaceMetrics> {
  const activeDb = db ?? (await getDefaultDb());
  const builder = createWhereBuilder(input.organizationId, input.filters);
  const rows = await activeDb.$queryRawUnsafe<
    Array<{
      total: bigint | number;
      qualified: bigint | number;
      needsReview: bigint | number;
      needsContact: bigint | number;
      unqualified: bigint | number;
      notScored: bigint | number;
      meetings: bigint | number;
    }>
  >(buildMetricsSql(builder.whereSql), ...builder.params);
  const row = rows[0];

  return {
    total: Number(row?.total ?? 0),
    qualified: Number(row?.qualified ?? 0),
    needsReview: Number(row?.needsReview ?? 0),
    needsContact: Number(row?.needsContact ?? 0),
    unqualified: Number(row?.unqualified ?? 0),
    notScored: Number(row?.notScored ?? 0),
    meetings: Number(row?.meetings ?? 0),
  };
}

export async function getLeadWorkspaceDetail(
  input: {
    organizationId: string;
    leadAssignmentId: string;
  },
  db?: LeadWorkspaceDb
): Promise<LeadWorkspaceDetail | null> {
  const activeDb = db ?? (await getDefaultDb());
  const builder = createWhereBuilder(input.organizationId, {});
  const leadIdPlaceholder = builder.add(input.leadAssignmentId);
  const rows = await activeDb.$queryRawUnsafe<LeadWorkspaceSqlRow[]>(
    `${buildLeadRowsSql(`${builder.whereSql} AND la."id" = ${leadIdPlaceholder}`, 1, 0)}`,
    ...builder.params
  );
  const row = rows[0];

  if (!row) {
    return null;
  }

  const historyRows = await activeDb.$queryRawUnsafe<HardRuleAssessmentSqlRow[]>(
    `
      SELECT
        "id",
        "fitScore",
        "confidence",
        "qualification"::text AS "qualification",
        "accountPreRank"::text AS "accountPreRank",
        "companyType",
        "reason",
        "oneSentenceCompanySummary",
        "evidenceSnapshotJson",
        "hardGateResultsJson",
        "confidenceBreakdownJson",
        "dataQualityJson",
        "scoringSource",
        "scoringVersion",
        "inputFingerprint",
        "icpRulesHash",
        "previousAssessmentId",
        "createdAt"
      FROM "V2HardRuleAssessment"
      WHERE "organizationId" = $1
        AND "leadAssignmentId" = $2
      ORDER BY "createdAt" DESC, "id" DESC
      LIMIT 10
    `,
    input.organizationId,
    input.leadAssignmentId
  );

  const mappedRow = mapLeadWorkspaceRow(row);
  const [lineage, companyIntelligence] = await Promise.all([
    loadVisibleLeadLineage(activeDb, input.organizationId, [
      input.leadAssignmentId,
    ]),
    getLatestCompanyIntelligenceProfile(
      {
        organizationId: input.organizationId,
        companyId: mappedRow.companyId,
      },
      activeDb
    ),
  ]);

  return {
    ...mappedRow,
    ...(lineage.get(input.leadAssignmentId) ?? {}),
    assessmentHistory: historyRows.map(mapAssessmentRow),
    companyIntelligence,
  };
}

export async function listLeadWorkspaceFilterOptions(
  input: {
    organizationId: string;
  },
  db?: LeadWorkspaceDb
): Promise<LeadWorkspaceFilterOptions> {
  const cacheKey = `v2:org:${input.organizationId}:facets:leads`;
  return withFacetCache(cacheKey, () => fetchLeadWorkspaceFilterOptions(input, db));
}

/** Uncached fetcher — used by the cache wrapper above AND by the readmodel-refresh worker
 *  to re-warm the facets key after scoring/ingestion runs. */
export async function fetchLeadWorkspaceFilterOptions(
  input: {
    organizationId: string;
  },
  db?: LeadWorkspaceDb
): Promise<LeadWorkspaceFilterOptions> {
  {
    const activeDb = db ?? (await getDefaultDb());
  const [context, projects, icpVersions, factTokens] = await Promise.all([
    getLeadContextOptions(input, activeDb),
    activeDb.$queryRawUnsafe<Array<{ id: string; name: string }>>(
      `
        SELECT "id", "name"
        FROM "V2Project"
        WHERE "organizationId" = $1
          AND "status" = 'ACTIVE'
        ORDER BY "name" ASC
      `,
      input.organizationId
    ),
    activeDb.$queryRawUnsafe<
      Array<{
        id: string;
        versionNumber: number;
        icpProfileName: string;
      }>
    >(
      `
        SELECT
          icp."id",
          icp."versionNumber",
          profile."name" AS "icpProfileName"
        FROM "V2ICPVersion" icp
        INNER JOIN "V2ICPProfile" profile
          ON profile."id" = icp."icpProfileId"
          AND profile."organizationId" = icp."organizationId"
          AND profile."status" = 'ACTIVE'
        WHERE icp."organizationId" = $1
          AND icp."deletedAt" IS NULL
        ORDER BY profile."name" ASC, icp."versionNumber" DESC
      `,
      input.organizationId
    ),
    activeDb.$queryRawUnsafe<Array<{ token: string; count: number }>>(
      `
        SELECT facts.token AS "token", COUNT(*)::int AS "count"
        FROM "V2CompanyIntelligenceProfile" profile
        CROSS JOIN LATERAL jsonb_array_elements_text(
          COALESCE(profile."factsJson"::jsonb, '[]'::jsonb)
        ) facts(token)
        WHERE profile."organizationId" = $1
        GROUP BY facts.token
        ORDER BY COUNT(*) DESC, facts.token ASC
        LIMIT 200
      `,
      input.organizationId
    ),
  ]);

  return {
    context,
    projects,
    icpVersions: icpVersions.map((version) => ({
      id: version.id,
      versionNumber: Number(version.versionNumber),
      icpProfileName: version.icpProfileName,
      label: `${version.icpProfileName} v${version.versionNumber}`,
    })),
    factTokens: factTokens.map((row) => row.token),
    factFacets: groupFactFacets(factTokens),
  };
  }
}

export async function getLeadContextOptions(
  input: {
    organizationId: string;
  },
  db?: LeadWorkspaceDb
): Promise<LeadContextOptions> {
  const activeDb = db ?? (await getDefaultDb());
  const rows = await activeDb.$queryRawUnsafe<
    Array<{
      accountId: string;
      accountName: string;
      projectId: string | null;
      projectName: string | null;
      offerId: string | null;
      offerName: string | null;
      icpVersionId: string | null;
      icpVersionNumber: number | null;
      icpVersionStatus: string | null;
      icpProfileName: string | null;
    }>
  >(
    `
      SELECT
        account."id" AS "accountId",
        account."name" AS "accountName",
        project."id" AS "projectId",
        project."name" AS "projectName",
        offer."id" AS "offerId",
        offer."name" AS "offerName",
        icp."id" AS "icpVersionId",
        icp."versionNumber" AS "icpVersionNumber",
        icp."status"::text AS "icpVersionStatus",
        profile."name" AS "icpProfileName"
      FROM "V2ClientAccount" account
      LEFT JOIN "V2Project" project
        ON project."clientAccountId" = account."id"
        AND project."organizationId" = account."organizationId"
        AND project."status" = 'ACTIVE'
      LEFT JOIN "V2Offer" offer
        ON offer."projectId" = project."id"
        AND offer."organizationId" = account."organizationId"
        AND offer."status" = 'ACTIVE'
      LEFT JOIN "V2ICPProfile" profile
        ON profile."offerId" = offer."id"
        AND profile."organizationId" = account."organizationId"
        AND profile."status" = 'ACTIVE'
      LEFT JOIN "V2ICPVersion" icp
        ON icp."icpProfileId" = profile."id"
        AND icp."organizationId" = account."organizationId"
        AND icp."deletedAt" IS NULL
        AND icp."status" = 'PUBLISHED'
      WHERE account."organizationId" = $1
        AND account."status" = 'ACTIVE'
      ORDER BY
        account."name" ASC,
        project."name" ASC,
        profile."name" ASC,
        icp."versionNumber" DESC
    `,
    input.organizationId
  );

  const accounts = new Map<
    string,
    {
      id: string;
      name: string;
      projects: Map<
        string,
        {
          id: string;
          name: string;
          icpVersions: LeadContextOptions["accounts"][number]["projects"][number]["icpVersions"];
          offers: Map<
            string,
            {
              id: string;
              name: string;
              icpVersions: LeadContextOptions["accounts"][number]["projects"][number]["icpVersions"];
            }
          >;
        }
      >;
    }
  >();

  for (const row of rows) {
    let account = accounts.get(row.accountId);

    if (!account) {
      account = {
        id: row.accountId,
        name: row.accountName,
        projects: new Map(),
      };
      accounts.set(row.accountId, account);
    }

    if (!row.projectId || !row.projectName) {
      continue;
    }

    let project = account.projects.get(row.projectId);

    if (!project) {
      project = {
        id: row.projectId,
        name: row.projectName,
        icpVersions: [],
        offers: new Map(),
      };
      account.projects.set(row.projectId, project);
    }

    if (row.offerId && row.offerName) {
      let offer = project.offers.get(row.offerId);
      if (!offer) {
        offer = {
          id: row.offerId,
          name: row.offerName,
          icpVersions: [],
        };
        project.offers.set(row.offerId, offer);
      }

      if (
        row.icpVersionId &&
        row.icpVersionNumber !== null &&
        row.icpVersionStatus &&
        row.icpProfileName
      ) {
        const icpOption = {
          id: row.icpVersionId,
          versionNumber: Number(row.icpVersionNumber),
          status: row.icpVersionStatus,
          icpProfileName: row.icpProfileName,
          label: `${row.icpProfileName} v${row.icpVersionNumber}`,
          offerId: row.offerId,
        };

        if (!project.icpVersions.some((v) => v.id === icpOption.id)) {
          project.icpVersions.push(icpOption);
        }

        if (!offer.icpVersions.some((v) => v.id === icpOption.id)) {
          offer.icpVersions.push(icpOption);
        }
      }
    }
  }

  return {
    accounts: Array.from(accounts.values()).map((account) => ({
      id: account.id,
      name: account.name,
      projects: Array.from(account.projects.values()).map((project) => ({
        id: project.id,
        name: project.name,
        icpVersions: project.icpVersions,
        offers: Array.from(project.offers.values()),
      })),
    })),
  };
}

function buildLeadRowsSql(whereSql: string, limit: number, offset: number) {
  return `
    SELECT
      la."id" AS "leadAssignmentId",
      la."organizationId",
      la."projectId",
      project."name" AS "projectName",
      la."icpVersionId",
      icp."versionNumber" AS "icpVersionNumber",
      profile."name" AS "icpProfileName",
      la."companyId",
      company."name" AS "companyName",
      company."canonicalDomain" AS "companyDomain",
      company."websiteUrl" AS "companyWebsiteUrl",
      company."country" AS "companyCountry",
      contact."id" AS "contactId",
      contact."fullName" AS "contactName",
      contact."firstName" AS "contactFirstName",
      contact."lastName" AS "contactLastName",
      contact."title" AS "contactTitle",
      verified_email."normalizedValue" AS "contactEmail",
      (verified_email."normalizedValue" IS NOT NULL) AS "hasVerifiedEmail",
      la."assignmentLevel"::text AS "assignmentLevel",
      la."workflowStatus"::text AS "workflowStatus",
      latest_profile."profileStatus"::text AS "companyIntelligenceStatus",
      COALESCE(latest_profile."factsJson", '[]'::jsonb) AS "companyFactTokens",
      COALESCE(active_enrollments."activeEnrollmentCount", 0)::int AS "activeEnrollmentCount",
      la."createdAt",
      la."updatedAt",
      assessment."id" AS "latestAssessmentId",
      assessment."fitScore",
      assessment."confidence",
      assessment."qualification"::text AS "qualification",
      assessment."accountPreRank"::text AS "accountPreRank",
      assessment."companyType",
      assessment."reason",
      assessment."oneSentenceCompanySummary",
      assessment."evidenceSnapshotJson",
      assessment."hardGateResultsJson",
      assessment."confidenceBreakdownJson",
      assessment."dataQualityJson",
      assessment."scoringSource",
      assessment."scoringVersion",
      assessment."inputFingerprint",
      assessment."icpRulesHash",
      assessment."previousAssessmentId",
      assessment."createdAt" AS "assessmentCreatedAt",
      la."ownerUserId",
      owner."name" AS "ownerName",
      la."assignedAt",
      last_touch."lastTouchAt",
      last_touch."lastTouchChannel",
      (review_flag."hasReview" IS NOT NULL) AS "hasResolvedReview",
      COALESCE(linked_counts."linkedProjectCount", 0)::int AS "linkedProjectCount",
      COALESCE(linked_counts."linkedIcpCount", 0)::int AS "linkedIcpCount"
    ${buildBaseFromSql(true)}
    WHERE ${whereSql}
    ORDER BY la."updatedAt" DESC, la."id" ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `;
}

function buildCountSql(whereSql: string) {
  return `
    SELECT COUNT(*) AS "total"
    ${buildBaseFromSql()}
    WHERE ${whereSql}
  `;
}

function buildMetricsSql(whereSql: string) {
  return `
    SELECT
      COUNT(*) AS "total",
      COUNT(*) FILTER (WHERE assessment."qualification" = 'QUALIFIED') AS "qualified",
      COUNT(*) FILTER (WHERE assessment."qualification" = 'NEEDS_REVIEW') AS "needsReview",
      COUNT(*) FILTER (WHERE assessment."qualification" = 'COMPANY_QUALIFIED_NEEDS_CONTACT') AS "needsContact",
      COUNT(*) FILTER (WHERE assessment."qualification" = 'UNQUALIFIED') AS "unqualified",
      COUNT(*) FILTER (WHERE la."latestHardRuleAssessmentId" IS NULL) AS "notScored",
      COUNT(*) FILTER (WHERE la."workflowStatus" IN ('MEETING_BOOKED', 'MEETING_DONE')) AS "meetings"
    ${buildBaseFromSql()}
    WHERE ${whereSql}
  `;
}

function buildBaseFromSql(includePeopleJoins = false) {
  return `
    FROM "V2LeadAssignment" la
    INNER JOIN "V2Company" company
      ON company."id" = la."companyId"
      AND company."organizationId" = la."organizationId"
      AND company."status" = 'ACTIVE'
      AND company."deletedAt" IS NULL
    LEFT JOIN "V2Contact" contact
      ON contact."id" = la."contactId"
      AND contact."organizationId" = la."organizationId"
      AND contact."status" = 'ACTIVE'
      AND contact."deletedAt" IS NULL
    INNER JOIN "V2Project" project
      ON project."id" = la."projectId"
      AND project."organizationId" = la."organizationId"
      AND project."status" = 'ACTIVE'
    INNER JOIN "V2ICPVersion" icp
      ON icp."id" = la."icpVersionId"
      AND icp."organizationId" = la."organizationId"
      AND icp."deletedAt" IS NULL
    INNER JOIN "V2ICPProfile" profile
      ON profile."id" = icp."icpProfileId"
      AND profile."organizationId" = icp."organizationId"
      AND profile."status" = 'ACTIVE'
    LEFT JOIN "V2HardRuleAssessment" assessment
      ON assessment."id" = la."latestHardRuleAssessmentId"
      AND assessment."organizationId" = la."organizationId"
    LEFT JOIN LATERAL (
      SELECT identifier."normalizedValue"
      FROM "V2ContactIdentifier" identifier
      WHERE identifier."organizationId" = la."organizationId"
        AND identifier."contactId" = contact."id"
        AND identifier."type" = 'EMAIL'
        AND identifier."isValid" = TRUE
      ORDER BY identifier."createdAt" ASC, identifier."id" ASC
      LIMIT 1
    ) verified_email ON true
    LEFT JOIN LATERAL (
      SELECT profile."profileStatus", profile."factsJson"
      FROM "V2CompanyIntelligenceProfile" profile
      WHERE profile."organizationId" = la."organizationId"
        AND profile."companyId" = la."companyId"
      ORDER BY profile."createdAt" DESC, profile."researchVersion" DESC, profile."id" DESC
      LIMIT 1
    ) latest_profile ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS "activeEnrollmentCount"
      FROM "V2SequenceEnrollment" enrollment
      WHERE enrollment."organizationId" = la."organizationId"
        AND enrollment."leadAssignmentId" = la."id"
        AND enrollment."status" IN ('ACTIVE', 'PAUSED')
        AND enrollment."deletedAt" IS NULL
    ) active_enrollments ON true
    ${includePeopleJoins ? PEOPLE_JOINS_SQL : ""}
  `;
}

// Contacts & Leads people-layer joins, used only by the row/detail query (not the
// count/metrics queries, which never read these columns). Owner identity, last
// touch (newest across outreach + activity records), resolved-review flag, and the
// per-contact linked project/ICP counts (per company for company-level leads).
const PEOPLE_JOINS_SQL = `
    LEFT JOIN "V2User" owner
      ON owner."id" = la."ownerUserId"
    LEFT JOIN LATERAL (
      SELECT touch."occurredAt" AS "lastTouchAt", touch."channel" AS "lastTouchChannel"
      FROM (
        SELECT oa."occurredAt", oa."channel"
        FROM "V2OutreachActivity" oa
        WHERE oa."organizationId" = la."organizationId" AND oa."leadAssignmentId" = la."id"
        UNION ALL
        SELECT ar."occurredAt", ar."channel"
        FROM "V2ActivityRecord" ar
        WHERE ar."organizationId" = la."organizationId" AND ar."leadAssignmentId" = la."id"
          AND ar."deletedAt" IS NULL
      ) touch
      ORDER BY touch."occurredAt" DESC
      LIMIT 1
    ) last_touch ON true
    LEFT JOIN LATERAL (
      SELECT TRUE AS "hasReview"
      FROM "V2ManagerReviewItem" mri
      WHERE mri."organizationId" = la."organizationId"
        AND mri."leadAssignmentId" = la."id"
        AND mri."deletedAt" IS NULL
        AND mri."status" NOT IN ('OPEN', 'IN_PROGRESS', 'SNOOZED')
      LIMIT 1
    ) review_flag ON true
    LEFT JOIN LATERAL (
      SELECT
        COUNT(DISTINCT la2."projectId")::int AS "linkedProjectCount",
        COUNT(DISTINCT la2."icpVersionId")::int AS "linkedIcpCount"
      FROM "V2LeadAssignment" la2
      WHERE la2."organizationId" = la."organizationId"
        AND la2."status" = 'ACTIVE' AND la2."deletedAt" IS NULL
        AND (
          (la."contactId" IS NOT NULL AND la2."contactId" = la."contactId")
          OR (la."contactId" IS NULL AND la2."companyId" = la."companyId")
        )
    ) linked_counts ON true
`;

function createWhereBuilder(
  organizationId: string,
  filters: LeadWorkspaceFilters | undefined
) {
  const params: unknown[] = [organizationId];
  const clauses = [
    `la."organizationId" = $1`,
    `la."status" = 'ACTIVE'`,
    `la."deletedAt" IS NULL`,
  ];
  const add = (value: unknown) => {
    params.push(value);

    return `$${params.length}`;
  };

  if (filters?.clientAccountId) {
    clauses.push(`project."clientAccountId" = ${add(filters.clientAccountId)}`);
  }

  if (filters?.projectId) {
    clauses.push(`la."projectId" = ${add(filters.projectId)}`);
  }

  if (filters?.icpVersionId) {
    clauses.push(`la."icpVersionId" = ${add(filters.icpVersionId)}`);
  }

  if (filters?.companyId) {
    // "Work this account": filter the lead list to one company.
    clauses.push(`la."companyId" = ${add(filters.companyId)}`);
  }

  const addArray = (values: unknown[]) => values.map(v => add(v)).join(", ");

  if (filters?.workflowStatus?.length) {
    clauses.push(`la."workflowStatus"::text IN (${addArray(filters.workflowStatus)})`);
  }
  if (filters?.excludeWorkflowStatus?.length) {
    clauses.push(`la."workflowStatus"::text NOT IN (${addArray(filters.excludeWorkflowStatus)})`);
  }

  if (
    filters?.assignmentLevel &&
    VALID_ASSIGNMENT_LEVELS.has(filters.assignmentLevel)
  ) {
    clauses.push(`la."assignmentLevel" = ${add(filters.assignmentLevel)}::"V2LeadAssignmentLevel"`);
  }

  if (filters?.qualification?.length) {
    const hasNotScored = filters.qualification.includes("NOT_SCORED");
    const validQuals = filters.qualification.filter(q => q !== "NOT_SCORED");
    
    if (hasNotScored && validQuals.length === 0) {
      clauses.push(`la."latestHardRuleAssessmentId" IS NULL`);
    } else if (hasNotScored && validQuals.length > 0) {
      clauses.push(`(la."latestHardRuleAssessmentId" IS NULL OR assessment."qualification"::text IN (${addArray(validQuals)}))`);
    } else {
      clauses.push(`assessment."qualification"::text IN (${addArray(validQuals)})`);
    }
  }

  if (filters?.excludeQualification?.length) {
    const hasNotScored = filters.excludeQualification.includes("NOT_SCORED");
    const validQuals = filters.excludeQualification.filter(q => q !== "NOT_SCORED");
    
    if (hasNotScored && validQuals.length === 0) {
      clauses.push(`la."latestHardRuleAssessmentId" IS NOT NULL`);
    } else if (hasNotScored && validQuals.length > 0) {
      clauses.push(`(la."latestHardRuleAssessmentId" IS NOT NULL AND assessment."qualification"::text NOT IN (${addArray(validQuals)}))`);
    } else {
      clauses.push(`(la."latestHardRuleAssessmentId" IS NULL OR assessment."qualification"::text NOT IN (${addArray(validQuals)}))`);
    }
  }

  if (filters?.scored && VALID_SCORED_FILTERS.has(filters.scored)) {
    clauses.push(
      filters.scored === "scored"
        ? `la."latestHardRuleAssessmentId" IS NOT NULL`
        : `la."latestHardRuleAssessmentId" IS NULL`
    );
  }

  if (filters?.confidenceBand?.length) {
    const bandClauses = [];
    if (filters.confidenceBand.includes("HIGH")) bandClauses.push(`assessment."confidence" >= 0.75`);
    if (filters.confidenceBand.includes("MEDIUM")) bandClauses.push(`(assessment."confidence" >= 0.45 AND assessment."confidence" < 0.75)`);
    if (filters.confidenceBand.includes("LOW")) bandClauses.push(`assessment."confidence" < 0.45`);
    if (bandClauses.length > 0) {
      clauses.push(`(${bandClauses.join(" OR ")})`);
    }
  }

  if (filters?.country?.length) {
    const countryClauses = filters.country.map(c => `company."country" ILIKE ${add(`%${c}%`)}`);
    clauses.push(`(${countryClauses.join(" OR ")})`);
  }
  if (filters?.excludeCountry?.length) {
    const countryClauses = filters.excludeCountry.map(c => `company."country" NOT ILIKE ${add(`%${c}%`)}`);
    clauses.push(`(${countryClauses.join(" AND ")})`);
  }

  if (filters?.domain) {
    clauses.push(`company."canonicalDomain" ILIKE ${add(`%${filters.domain}%`)}`);
  }

  if (
    filters?.contactReadiness &&
    VALID_CONTACT_READINESS.has(filters.contactReadiness)
  ) {
    clauses.push(
      filters.contactReadiness === "has_email"
        ? `verified_email."normalizedValue" IS NOT NULL`
        : `verified_email."normalizedValue" IS NULL`
    );
  }

  if (filters?.enrollment && VALID_ENROLLMENT_FILTERS.has(filters.enrollment)) {
    clauses.push(
      filters.enrollment === "enrolled"
        ? `COALESCE(active_enrollments."activeEnrollmentCount", 0) > 0`
        : `COALESCE(active_enrollments."activeEnrollmentCount", 0) = 0`
    );
  }

  if (filters?.intelligenceStatus?.length) {
    const hasMissing = filters.intelligenceStatus.includes("MISSING");
    const validIntel = filters.intelligenceStatus.filter(i => i !== "MISSING");
    
    if (hasMissing && validIntel.length === 0) {
      clauses.push(`latest_profile."profileStatus" IS NULL`);
    } else if (hasMissing && validIntel.length > 0) {
      clauses.push(`(latest_profile."profileStatus" IS NULL OR latest_profile."profileStatus"::text IN (${addArray(validIntel)}))`);
    } else {
      clauses.push(`latest_profile."profileStatus"::text IN (${addArray(validIntel)})`);
    }
  }
  
  if (filters?.excludeIntelligenceStatus?.length) {
    const hasMissing = filters.excludeIntelligenceStatus.includes("MISSING");
    const validIntel = filters.excludeIntelligenceStatus.filter(i => i !== "MISSING");
    
    if (hasMissing && validIntel.length === 0) {
      clauses.push(`latest_profile."profileStatus" IS NOT NULL`);
    } else if (hasMissing && validIntel.length > 0) {
      clauses.push(`(latest_profile."profileStatus" IS NOT NULL AND latest_profile."profileStatus"::text NOT IN (${addArray(validIntel)}))`);
    } else {
      clauses.push(`(latest_profile."profileStatus" IS NULL OR latest_profile."profileStatus"::text NOT IN (${addArray(validIntel)}))`);
    }
  }

  if (filters?.factToken?.length) {
    const factClauses = filters.factToken.map(f => `COALESCE(latest_profile."factsJson", '[]'::jsonb) ? ${add(f)}`);
    clauses.push(`(${factClauses.join(" OR ")})`);
  }
  if (filters?.excludeFactToken?.length) {
    const factClauses = filters.excludeFactToken.map(f => `NOT COALESCE(latest_profile."factsJson", '[]'::jsonb) ? ${add(f)}`);
    clauses.push(`(${factClauses.join(" AND ")})`);
  }

  if (filters?.search) {
    const search = add(`%${filters.search}%`);
    clauses.push(`(
      company."name" ILIKE ${search}
      OR company."canonicalDomain" ILIKE ${search}
      OR company."websiteUrl" ILIKE ${search}
      OR contact."fullName" ILIKE ${search}
      OR contact."title" ILIKE ${search}
    )`);
  }

  return {
    params,
    add,
    whereSql: clauses.join(" AND "),
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

function groupFactFacets(rows: Array<{ token: string; count: number }>) {
  const groups = new Map<
    string,
    { key: string; label: string; options: Array<{ token: string; label: string; count: number }> }
  >();

  for (const row of rows) {
    const group = factGroupForToken(row.token);
    const existing = groups.get(group.key) ?? {
      key: group.key,
      label: group.label,
      options: [],
    };
    existing.options.push({
      token: row.token,
      label: labelFactToken(row.token),
      count: Number(row.count),
    });
    groups.set(group.key, existing);
  }

  return Array.from(groups.values()).map((group) => ({
    ...group,
    options: group.options
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 40),
  }));
}

function factGroupForToken(token: string) {
  if (token.startsWith("industry.")) return { key: "industry", label: "Industry" };
  if (token.startsWith("offering.")) return { key: "offering", label: "Offering / what they sell" };
  if (token.startsWith("business_model.")) return { key: "business_model", label: "Business model" };
  if (token.startsWith("size.")) return { key: "size", label: "Company size" };
  if (token.startsWith("revenue.")) return { key: "revenue", label: "Revenue" };
  if (token.startsWith("geo.")) return { key: "geo", label: "Geography" };
  if (token.startsWith("location.")) return { key: "location", label: "Location footprint" };
  if (token.startsWith("growth.") || token.startsWith("proof.") || token.startsWith("maturity.")) {
    return { key: "signals", label: "Growth / proof signals" };
  }
  if (token.startsWith("risk.")) return { key: "risk", label: "Risk signals" };
  return { key: "other", label: "Other facts" };
}

function labelFactToken(token: string) {
  const employeeCount = token.match(/^size\.employee_count_(\d+)$/);
  if (employeeCount) return `${Number(employeeCount[1]).toLocaleString("en-US")} employees`;

  const revenue = token.match(/^revenue\.usd_(\d+)$/);
  if (revenue) return `$${Number(revenue[1]).toLocaleString("en-US")} revenue`;

  const locationCount = token.match(/^location\.count_(\d+)$/);
  if (locationCount) return `${Number(locationCount[1]).toLocaleString("en-US")} locations`;

  const [family, ...parts] = token.split(".");
  const value = parts.join(".") || family;
  return value
    .replace(/^range_/, "")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

async function getDefaultDb(): Promise<LeadWorkspaceDb> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma;
}

async function loadVisibleLeadLineage(
  db: LeadWorkspaceDb,
  organizationId: string,
  leadAssignmentIds: string[]
) {
  const uniqueIds = Array.from(new Set(leadAssignmentIds.filter(Boolean)));
  const lineage = new Map<
    string,
    { sourceIngestionJobId: string; sourceIngestionRowId: string }
  >();

  if (uniqueIds.length === 0) {
    return lineage;
  }

  const rows = await db.$queryRawUnsafe<
    Array<{
      leadAssignmentId: string;
      sourceIngestionJobId: string;
      sourceIngestionRowId: string;
    }>
  >(
    `
      WITH visible_leads("leadAssignmentId") AS (
        SELECT unnest($2::text[])
      )
      SELECT DISTINCT ON (visible_leads."leadAssignmentId")
        visible_leads."leadAssignmentId",
        ingestion_row."jobId" AS "sourceIngestionJobId",
        ingestion_row."id" AS "sourceIngestionRowId"
      FROM visible_leads
      INNER JOIN "V2IngestionRow" ingestion_row
        ON ingestion_row."organizationId" = $1
        AND ingestion_row."normalizedRowJson"->'leadAssignmentUpsert'->>'leadAssignmentId' =
          visible_leads."leadAssignmentId"
      ORDER BY visible_leads."leadAssignmentId", ingestion_row."createdAt" DESC
    `,
    organizationId,
    uniqueIds
  );

  for (const row of rows) {
    lineage.set(row.leadAssignmentId, {
      sourceIngestionJobId: row.sourceIngestionJobId,
      sourceIngestionRowId: row.sourceIngestionRowId,
    });
  }

  return lineage;
}
