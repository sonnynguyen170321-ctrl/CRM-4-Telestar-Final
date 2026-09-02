import type {
  LeadWorkspaceAccountPreRank,
  LeadWorkspaceQualification,
} from "@/lib/v2/crm/types";
import { traceQuery, withSpan } from "@/lib/v2/observability/trace";
import { withFacetCache } from "@/lib/v2/bullmq/facetCache";
import { verticalMatchAliases } from "@telestar/core-scoring/rules/dictionaries/servedVertical";

const COMPANY_LIST_PAGE_SIZE = 50;
const CROSS_ICP_PAGE_SIZE = 50;

// These shapes are produced by the crawl-and-reason pipeline, so they are defined in the package and
// re-exported here for the call sites that already import them from this module.
import type {
  CompanyProfileStatus,
  CompanyIntelligenceEvidenceItem,
  CompanyIntelligenceProfileSummary,
} from "@telestar/core-intel/profileSummary";

export type {
  CompanyProfileStatus,
  CompanyIntelligenceEvidenceItem,
  CompanyIntelligenceProfileSummary,
} from "@telestar/core-intel/profileSummary";

export type CompanyResearchStatus =
  | "SUCCESS"
  | "NO_WEBSITE"
  | "OFFLINE"
  | "BLOCKED"
  | "TIMEOUT"
  | "JS_RENDER_REQUIRED"
  | "PARTIAL"
  | "INVALID_URL"
  | "PARKED"
  | "NOT_RUN";


export type CompanyResearchSnapshotSummary = {
  id: string;
  status: CompanyResearchStatus;
  httpStatus: number | null;
  finalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  researchVersion: number;
  createdAt: string;
};

export type CompanyQualificationSummary = {
  qualified: number;
  needsReview: number;
  needsContact: number;
  unqualified: number;
  notScored: number;
};

export type CompanyDirectoryRow = {
  id: string;
  name: string;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  country: string | null;
  industryCategory: string | null;
  latestResearchStatus: CompanyResearchStatus | null;
  latestProfileStatus: CompanyProfileStatus | null;
  companySummary: string | null;
  leadAssignmentCount: number;
  qualificationSummary: CompanyQualificationSummary;
  lastEnrichedAt: string | null;
  staleAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CompanyCrossIcpLeadAssignment = {
  leadAssignmentId: string;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: LeadWorkspaceQualification;
  fitScore: number | null;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  lastScoredAt: string | null;
  createdAt: string;
};

export type CompanyDirectoryResult = {
  rows: CompanyDirectoryRow[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

export type CompanyDetailResult = {
  company: CompanyDirectoryRow;
  latestResearchSnapshot: CompanyResearchSnapshotSummary | null;
  latestIntelligenceProfile: CompanyIntelligenceProfileSummary | null;
  crossIcp: {
    rows: CompanyCrossIcpLeadAssignment[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    };
  };
};

export type QueryCompanyDirectoryInput = {
  organizationId: string;
  page?: number;
  search?: string;
  researchStatus?: string[];
  excludeResearchStatus?: string[];
  clientAccountId?: string;
  projectId?: string;
  icpVersionId?: string;
  qualification?: string[];
  excludeQualification?: string[];
  workflowStatus?: string[];
  excludeWorkflowStatus?: string[];
  country?: string[];
  excludeCountry?: string[];
  industry?: string[];
  excludeIndustry?: string[];
  /** W5: hierarchical served-vertical keys (e.g. "IND_TEXTILES", "FIN_PAYMENTS"). */
  servedVertical?: string[];
  factToken?: string[];
  excludeFactToken?: string[];
};

export type CompanyDirectoryFilterOptions = {
  countries: string[];
  industries: string[];
  factTokens: string[];
};

export type GetCompanyDetailInput = {
  organizationId: string;
  companyId: string;
  leadPage?: number;
};

export type CompanyIntelligenceReadDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type CompanyDirectorySqlRow = {
  id: string;
  name: string;
  canonicalDomain: string | null;
  websiteUrl: string | null;
  linkedinUrl: string | null;
  country: string | null;
  industryCategory: string | null;
  latestResearchStatus: string | null;
  latestProfileStatus: string | null;
  companySummary: string | null;
  leadAssignmentCount: number | bigint;
  qualifiedCount: number | bigint;
  needsReviewCount: number | bigint;
  needsContactCount: number | bigint;
  unqualifiedCount: number | bigint;
  notScoredCount: number | bigint;
  lastEnrichedAt: Date | string | null;
  staleAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ResearchSnapshotSqlRow = {
  id: string;
  status: string;
  httpStatus: number | null;
  finalUrl: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  researchVersion: number;
  createdAt: Date | string;
};

type IntelligenceProfileSqlRow = {
  id: string;
  companySummary: string | null;
  factsJson: unknown;
  evidenceItemsJson: unknown;
  classificationJson: unknown;
  sourceCoverageJson: unknown;
  riskSignalsJson: unknown;
  confidenceJson: unknown;
  profileStatus: string;
  staleAt: Date | string | null;
  researchVersion: number;
  createdAt: Date | string;
};

type CrossIcpSqlRow = {
  leadAssignmentId: string;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: string | null;
  fitScore: number | null;
  accountPreRank: string | null;
  lastScoredAt: Date | string | null;
  createdAt: Date | string;
};

export async function queryCompanyDirectory(
  input: QueryCompanyDirectoryInput,
  db?: CompanyIntelligenceReadDb
): Promise<CompanyDirectoryResult> {
  const activeDb = db ?? (await getDefaultDb());
  const page = normalizePage(input.page);
  const offset = (page - 1) * COMPANY_LIST_PAGE_SIZE;
  const builder = createCompanyWhereBuilder(input);
  return withSpan("companies.directory", async () => {
  const [rows, countRows] = await Promise.all([
    traceQuery("companies.rows", () => activeDb.$queryRawUnsafe<CompanyDirectorySqlRow[]>(
      `
        SELECT
          company."id",
          company."name",
          company."canonicalDomain",
          company."websiteUrl",
          company."linkedinUrl",
          company."country",
          company."industryCategory",
          latest_snapshot."status"::text AS "latestResearchStatus",
          latest_profile."profileStatus"::text AS "latestProfileStatus",
          latest_profile."companySummary" AS "companySummary",
          COALESCE(active_leads."leadAssignmentCount", 0)::int AS "leadAssignmentCount",
          COALESCE(active_leads."qualifiedCount", 0)::int AS "qualifiedCount",
          COALESCE(active_leads."needsReviewCount", 0)::int AS "needsReviewCount",
          COALESCE(active_leads."needsContactCount", 0)::int AS "needsContactCount",
          COALESCE(active_leads."unqualifiedCount", 0)::int AS "unqualifiedCount",
          COALESCE(active_leads."notScoredCount", 0)::int AS "notScoredCount",
          latest_profile."createdAt" AS "lastEnrichedAt",
          latest_profile."staleAt",
          company."createdAt",
          company."updatedAt"
        ${buildCompanyDirectoryFromSql()}
        WHERE ${builder.whereSql}
        ORDER BY
          COALESCE(latest_profile."createdAt", latest_snapshot."createdAt", company."updatedAt") DESC,
          company."name" ASC
        LIMIT ${COMPANY_LIST_PAGE_SIZE}
        OFFSET ${offset}
      `,
      ...builder.params
    ), (r) => r.length),
    traceQuery("companies.count", () => activeDb.$queryRawUnsafe<Array<{ total: number | bigint }>>(
      `
        SELECT COUNT(*) AS "total"
        ${buildCompanyDirectoryFromSql({
          snapshot: builder.needsSnapshotLateral,
          profile: builder.needsProfileLateral,
          leads: false,
        })}
        WHERE ${builder.whereSql}
      `,
      ...builder.params
    )),
  ]);
  const total = Number(countRows[0]?.total ?? 0);

  return {
    rows: rows.map(mapCompanyDirectoryRow),
    pagination: {
      page,
      pageSize: COMPANY_LIST_PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / COMPANY_LIST_PAGE_SIZE)),
    },
  };
  });
}

export async function queryCompanyDirectoryFilterOptions(
  organizationId: string,
  db?: CompanyIntelligenceReadDb
): Promise<CompanyDirectoryFilterOptions> {
  const activeDb = db ?? (await getDefaultDb());
  if (!db) {
    return withFacetCache(`v2:company-directory:filters:${organizationId}`, () =>
      queryCompanyDirectoryFilterOptions(organizationId, activeDb)
    );
  }
  const [countryRows, industryRows, factRows] = await Promise.all([
    activeDb.$queryRawUnsafe<Array<{ country: string }>>(
      `
        SELECT DISTINCT company."country" AS "country"
        FROM "V2Company" company
        WHERE company."organizationId" = $1
          AND company."status" = 'ACTIVE'
          AND company."deletedAt" IS NULL
          AND company."country" IS NOT NULL
          AND btrim(company."country") <> ''
        ORDER BY company."country" ASC
        LIMIT 100
      `,
      organizationId
    ),
    activeDb.$queryRawUnsafe<Array<{ industry: string }>>(
      `
        SELECT DISTINCT company."industryCategory" AS "industry"
        FROM "V2Company" company
        WHERE company."organizationId" = $1
          AND company."status" = 'ACTIVE'
          AND company."deletedAt" IS NULL
          AND company."industryCategory" IS NOT NULL
          AND btrim(company."industryCategory") <> ''
        ORDER BY company."industryCategory" ASC
        LIMIT 100
      `,
      organizationId
    ),
    activeDb.$queryRawUnsafe<Array<{ token: string }>>(
      `
        SELECT DISTINCT facts.token AS "token"
        FROM "V2Company" company
        INNER JOIN LATERAL (
          SELECT profile."factsJson"
          FROM "V2CompanyIntelligenceProfile" profile
          WHERE profile."organizationId" = company."organizationId"
            AND profile."companyId" = company."id"
          ORDER BY profile."createdAt" DESC, profile."researchVersion" DESC, profile."id" DESC
          LIMIT 1
        ) latest_profile ON true
        CROSS JOIN LATERAL jsonb_array_elements_text(
          COALESCE(latest_profile."factsJson"::jsonb, '[]'::jsonb)
        ) facts(token)
        WHERE company."organizationId" = $1
          AND company."status" = 'ACTIVE'
          AND company."deletedAt" IS NULL
        ORDER BY facts.token ASC
        LIMIT 200
      `,
      organizationId
    ),
  ]);

  return {
    countries: countryRows.map((row) => row.country),
    industries: industryRows.map((row) => row.industry),
    factTokens: factRows.map((row) => row.token),
  };
}

export async function getCompanyDetail(
  input: GetCompanyDetailInput,
  db?: CompanyIntelligenceReadDb
): Promise<CompanyDetailResult | null> {
  const activeDb = db ?? (await getDefaultDb());
  const leadPage = normalizePage(input.leadPage);
  const offset = (leadPage - 1) * CROSS_ICP_PAGE_SIZE;
  const [companyRows, snapshotRows, profileRows, leadRows, leadCountRows] =
    await withSpan("companies.drawer.detail", () => traceQuery("companies.drawer.detail.all", () => Promise.all([
      activeDb.$queryRawUnsafe<CompanyDirectorySqlRow[]>(
        `
          SELECT
            company."id",
            company."name",
            company."canonicalDomain",
            company."websiteUrl",
            company."linkedinUrl",
            company."country",
            company."industryCategory",
            latest_snapshot."status"::text AS "latestResearchStatus",
            latest_profile."profileStatus"::text AS "latestProfileStatus",
            latest_profile."companySummary" AS "companySummary",
            COALESCE(active_leads."leadAssignmentCount", 0)::int AS "leadAssignmentCount",
            latest_profile."createdAt" AS "lastEnrichedAt",
            latest_profile."staleAt",
            company."createdAt",
            company."updatedAt"
          ${buildCompanyDirectoryFromSql()}
          WHERE company."organizationId" = $1
            AND company."status" = 'ACTIVE'
            AND company."deletedAt" IS NULL
            AND company."id" = $2
          LIMIT 1
        `,
        input.organizationId,
        input.companyId
      ),
      activeDb.$queryRawUnsafe<ResearchSnapshotSqlRow[]>(
        `
          SELECT
            "id",
            "status"::text AS "status",
            "httpStatus",
            "finalUrl",
            "errorCode",
            "errorMessage",
            "researchVersion",
            "createdAt"
          FROM "V2CompanyResearchSnapshot"
          WHERE "organizationId" = $1
            AND "companyId" = $2
          ORDER BY "createdAt" DESC, "researchVersion" DESC, "id" DESC
          LIMIT 1
        `,
        input.organizationId,
        input.companyId
      ),
      activeDb.$queryRawUnsafe<IntelligenceProfileSqlRow[]>(
        `
          SELECT
            "id",
            "companySummary",
            "factsJson",
            "evidenceItemsJson",
            "classificationJson",
            "sourceCoverageJson",
            "riskSignalsJson",
            "confidenceJson",
            "profileStatus"::text AS "profileStatus",
            "staleAt",
            "researchVersion",
            "createdAt"
          FROM "V2CompanyIntelligenceProfile"
          WHERE "organizationId" = $1
            AND "companyId" = $2
          ORDER BY "createdAt" DESC, "researchVersion" DESC, "id" DESC
          LIMIT 1
        `,
        input.organizationId,
        input.companyId
      ),
      activeDb.$queryRawUnsafe<CrossIcpSqlRow[]>(
        `
          SELECT
            la."id" AS "leadAssignmentId",
            project."name" AS "projectName",
            profile."name" AS "icpProfileName",
            icp."versionNumber" AS "icpVersionNumber",
            la."workflowStatus"::text AS "workflowStatus",
            assessment."qualification"::text AS "qualification",
            assessment."fitScore",
            assessment."accountPreRank"::text AS "accountPreRank",
            assessment."createdAt" AS "lastScoredAt",
            la."createdAt"
          FROM "V2LeadAssignment" la
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
            AND profile."organizationId" = la."organizationId"
            AND profile."status" = 'ACTIVE'
          LEFT JOIN "V2HardRuleAssessment" assessment
            ON assessment."id" = la."latestHardRuleAssessmentId"
            AND assessment."organizationId" = la."organizationId"
          WHERE la."organizationId" = $1
            AND la."companyId" = $2
            AND la."status" = 'ACTIVE'
            AND la."deletedAt" IS NULL
          ORDER BY COALESCE(assessment."createdAt", la."createdAt") DESC, la."id" ASC
          LIMIT ${CROSS_ICP_PAGE_SIZE}
          OFFSET ${offset}
        `,
        input.organizationId,
        input.companyId
      ),
      activeDb.$queryRawUnsafe<Array<{ total: number | bigint }>>(
        `
          SELECT COUNT(*) AS "total"
          FROM "V2LeadAssignment" la
          WHERE la."organizationId" = $1
            AND la."companyId" = $2
            AND la."status" = 'ACTIVE'
            AND la."deletedAt" IS NULL
        `,
        input.organizationId,
        input.companyId
      ),
    ])));

  if (!companyRows[0]) {
    return null;
  }

  const total = Number(leadCountRows[0]?.total ?? 0);

  return {
    company: mapCompanyDirectoryRow(companyRows[0]),
    latestResearchSnapshot: snapshotRows[0]
      ? mapResearchSnapshot(snapshotRows[0])
      : null,
    latestIntelligenceProfile: profileRows[0]
      ? mapIntelligenceProfile(profileRows[0])
      : null,
    crossIcp: {
      rows: leadRows.map(mapCrossIcpLeadAssignment),
      pagination: {
        page: leadPage,
        pageSize: CROSS_ICP_PAGE_SIZE,
        total,
        totalPages: Math.max(1, Math.ceil(total / CROSS_ICP_PAGE_SIZE)),
      },
    },
  };
}

export async function getLatestCompanyIntelligenceProfile(
  input: {
    organizationId: string;
    companyId: string;
  },
  db?: CompanyIntelligenceReadDb
): Promise<CompanyIntelligenceProfileSummary | null> {
  const activeDb = db ?? (await getDefaultDb());
  const rows = await activeDb.$queryRawUnsafe<IntelligenceProfileSqlRow[]>(
    `
      SELECT
        "id",
        "companySummary",
        "factsJson",
        "evidenceItemsJson",
        "classificationJson",
        "sourceCoverageJson",
        "riskSignalsJson",
        "confidenceJson",
        "profileStatus"::text AS "profileStatus",
        "staleAt",
        "researchVersion",
        "createdAt"
      FROM "V2CompanyIntelligenceProfile"
      WHERE "organizationId" = $1
        AND "companyId" = $2
      ORDER BY "createdAt" DESC, "researchVersion" DESC, "id" DESC
      LIMIT 1
    `,
    input.organizationId,
    input.companyId
  );

  return rows[0] ? mapIntelligenceProfile(rows[0]) : null;
}

// The directory FROM clause has three correlated LATERAL joins (latest snapshot,
// latest profile, active-lead count). The row + detail queries project all three, so
// they take the default (all true). The COUNT(*) query never projects them and only
// references a lateral when a filter does â€” so it passes the minimal set the WHERE
// needs (often none), turning the count into an index-friendly scan of "V2Company".
function buildCompanyDirectoryFromSql(options?: {
  snapshot?: boolean;
  profile?: boolean;
  leads?: boolean;
}) {
  const includeSnapshot = options?.snapshot ?? true;
  const includeProfile = options?.profile ?? true;
  const includeLeads = options?.leads ?? true;

  const parts: string[] = [`FROM "V2Company" company`];

  if (includeSnapshot) {
    parts.push(`
    LEFT JOIN LATERAL (
      SELECT "status", "createdAt"
      FROM "V2CompanyResearchSnapshot" snapshot
      WHERE snapshot."organizationId" = company."organizationId"
        AND snapshot."companyId" = company."id"
      ORDER BY snapshot."createdAt" DESC, snapshot."researchVersion" DESC, snapshot."id" DESC
      LIMIT 1
    ) latest_snapshot ON true`);
  }

  if (includeProfile) {
    parts.push(`
    LEFT JOIN LATERAL (
      SELECT "profileStatus", "companySummary", "createdAt", "staleAt"
      FROM "V2CompanyIntelligenceProfile" profile
      WHERE profile."organizationId" = company."organizationId"
        AND profile."companyId" = company."id"
      ORDER BY profile."createdAt" DESC, profile."researchVersion" DESC, profile."id" DESC
      LIMIT 1
    ) latest_profile ON true`);
  }

  if (includeLeads) {
    parts.push(`
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) AS "leadAssignmentCount",
        COUNT(*) FILTER (WHERE assessment."qualification" = 'QUALIFIED') AS "qualifiedCount",
        COUNT(*) FILTER (WHERE assessment."qualification" = 'NEEDS_REVIEW') AS "needsReviewCount",
        COUNT(*) FILTER (WHERE assessment."qualification" = 'COMPANY_QUALIFIED_NEEDS_CONTACT') AS "needsContactCount",
        COUNT(*) FILTER (WHERE assessment."qualification" = 'UNQUALIFIED') AS "unqualifiedCount",
        COUNT(*) FILTER (WHERE lead."latestHardRuleAssessmentId" IS NULL) AS "notScoredCount"
      FROM "V2LeadAssignment" lead
      LEFT JOIN "V2HardRuleAssessment" assessment
        ON assessment."id" = lead."latestHardRuleAssessmentId"
        AND assessment."organizationId" = lead."organizationId"
      WHERE lead."organizationId" = company."organizationId"
        AND lead."companyId" = company."id"
        AND lead."status" = 'ACTIVE'
        AND lead."deletedAt" IS NULL
    ) active_leads ON true`);
  }

  return parts.join("\n");
}

function createCompanyWhereBuilder(input: QueryCompanyDirectoryInput) {
  const params: unknown[] = [input.organizationId];
  const clauses = [
    `company."organizationId" = $1`,
    `company."status" = 'ACTIVE'`,
    `company."deletedAt" IS NULL`,
  ];
  const add = (value: unknown) => {
    params.push(value);

    return `$${params.length}`;
  };

  const addArray = (values: unknown[]) => {
    return values.map(v => add(v)).join(", ");
  };

  // Track which LATERAL joins the WHERE clause actually references so the COUNT(*)
  // query can omit the rest (the row query always projects all three).
  let needsSnapshotLateral = false;
  let needsProfileLateral = false;

  if (input.search) {
    const search = add(`%${input.search}%`);
    clauses.push(`(
      company."name" ILIKE ${search}
      OR company."canonicalDomain" ILIKE ${search}
      OR company."websiteUrl" ILIKE ${search}
    )`);
  }

  if (input.researchStatus?.length) {
    needsSnapshotLateral = true;
    clauses.push(`latest_snapshot."status"::text IN (${addArray(input.researchStatus)})`);
  }
  if (input.excludeResearchStatus?.length) {
    needsSnapshotLateral = true;
    clauses.push(`latest_snapshot."status"::text NOT IN (${addArray(input.excludeResearchStatus)})`);
  }

  if (input.country?.length) {
    clauses.push(`company."country" IN (${addArray(input.country)})`);
  }
  if (input.excludeCountry?.length) {
    clauses.push(`(company."country" IS NULL OR company."country" NOT IN (${addArray(input.excludeCountry)}))`);
  }

  if (input.industry?.length) {
    clauses.push(`company."industryCategory" IN (${addArray(input.industry)})`);
  }
  if (input.excludeIndustry?.length) {
    clauses.push(`(company."industryCategory" IS NULL OR company."industryCategory" NOT IN (${addArray(input.excludeIndustry)}))`);
  }

  if (input.servedVertical?.length) {
    // W5 hierarchical industry filter: match the selected verticals' aliases (a node PLUS all its
    // descendants, so "Textiles" also matches wool/cotton) against the company's category, its
    // intelligence summary, or its fact tokens. Needs the profile lateral in the COUNT query too.
    const patterns = Array.from(
      new Set(input.servedVertical.flatMap((key) => verticalMatchAliases(key)).map((a) => `%${a}%`))
    );
    if (patterns.length > 0) {
      needsProfileLateral = true;
      const arr = add(patterns);
      clauses.push(`(
        company."industryCategory" ILIKE ANY(${arr}::text[])
        OR latest_profile."companySummary" ILIKE ANY(${arr}::text[])
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(latest_profile."factsJson", '[]'::jsonb)) fv
          WHERE fv ILIKE ANY(${arr}::text[])
        )
      )`);
    }
  }

  if (input.factToken?.length) {
    needsProfileLateral = true;
    const tokenClauses = input.factToken.map(t => `latest_profile."factsJson"::jsonb ? ${add(t)}`);
    clauses.push(`(${tokenClauses.join(" AND ")})`);
  }
  if (input.excludeFactToken?.length) {
    needsProfileLateral = true;
    const tokenClauses = input.excludeFactToken.map(t => `NOT (latest_profile."factsJson"::jsonb ? ${add(t)})`);
    clauses.push(`(${tokenClauses.join(" AND ")})`);
  }

  const leadClauses: string[] = [
    `lead."organizationId" = company."organizationId"`,
    `lead."companyId" = company."id"`,
    `lead."status" = 'ACTIVE'`,
    `lead."deletedAt" IS NULL`,
  ];

  if (input.clientAccountId) {
    leadClauses.push(`project."clientAccountId" = ${add(input.clientAccountId)}`);
  }

  if (input.projectId) {
    leadClauses.push(`lead."projectId" = ${add(input.projectId)}`);
  }

  if (input.icpVersionId) {
    leadClauses.push(`lead."icpVersionId" = ${add(input.icpVersionId)}`);
  }

  if (input.workflowStatus?.length) {
    leadClauses.push(`lead."workflowStatus"::text IN (${addArray(input.workflowStatus)})`);
  }
  if (input.excludeWorkflowStatus?.length) {
    leadClauses.push(`lead."workflowStatus"::text NOT IN (${addArray(input.excludeWorkflowStatus)})`);
  }

  if (input.qualification?.length) {
    const hasNotScored = input.qualification.includes("NOT_SCORED");
    const validQuals = input.qualification.filter(q => q !== "NOT_SCORED");

    if (hasNotScored && validQuals.length === 0) {
      leadClauses.push(`lead."latestHardRuleAssessmentId" IS NULL`);
    } else if (hasNotScored && validQuals.length > 0) {
      leadClauses.push(`(lead."latestHardRuleAssessmentId" IS NULL OR assessment."qualification"::text IN (${addArray(validQuals)}))`);
    } else {
      leadClauses.push(`assessment."qualification"::text IN (${addArray(validQuals)})`);
    }
  }

  if (input.excludeQualification?.length) {
    const hasNotScored = input.excludeQualification.includes("NOT_SCORED");
    const validQuals = input.excludeQualification.filter(q => q !== "NOT_SCORED");

    if (hasNotScored && validQuals.length === 0) {
      leadClauses.push(`lead."latestHardRuleAssessmentId" IS NOT NULL`);
    } else if (hasNotScored && validQuals.length > 0) {
      leadClauses.push(`(lead."latestHardRuleAssessmentId" IS NOT NULL AND assessment."qualification"::text NOT IN (${addArray(validQuals)}))`);
    } else {
      leadClauses.push(`(assessment."qualification" IS NULL OR assessment."qualification"::text NOT IN (${addArray(validQuals)}))`);
    }
  }

  if (leadClauses.length > 4) {
    clauses.push(`
      EXISTS (
        SELECT 1
        FROM "V2LeadAssignment" lead
        INNER JOIN "V2Project" project
          ON project."id" = lead."projectId"
          AND project."organizationId" = lead."organizationId"
          AND project."status" = 'ACTIVE'
        LEFT JOIN "V2HardRuleAssessment" assessment
          ON assessment."id" = lead."latestHardRuleAssessmentId"
          AND assessment."organizationId" = lead."organizationId"
        WHERE ${leadClauses.join(" AND ")}
      )
    `);
  }

  return {
    params,
    whereSql: clauses.join(" AND "),
    needsSnapshotLateral,
    needsProfileLateral,
  };
}

function mapCompanyDirectoryRow(row: CompanyDirectorySqlRow): CompanyDirectoryRow {
  return {
    id: row.id,
    name: row.name,
    canonicalDomain: row.canonicalDomain,
    websiteUrl: row.websiteUrl,
    linkedinUrl: row.linkedinUrl,
    country: row.country,
    industryCategory: row.industryCategory,
    latestResearchStatus: isResearchStatus(row.latestResearchStatus)
      ? row.latestResearchStatus
      : null,
    latestProfileStatus: isProfileStatus(row.latestProfileStatus)
      ? row.latestProfileStatus
      : null,
    companySummary: row.companySummary ?? null,
    leadAssignmentCount: Number(row.leadAssignmentCount),
    qualificationSummary: {
      qualified: Number(row.qualifiedCount ?? 0),
      needsReview: Number(row.needsReviewCount ?? 0),
      needsContact: Number(row.needsContactCount ?? 0),
      unqualified: Number(row.unqualifiedCount ?? 0),
      notScored: Number(row.notScoredCount ?? 0),
    },
    lastEnrichedAt: toIsoOrNull(row.lastEnrichedAt),
    staleAt: toIsoOrNull(row.staleAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function mapResearchSnapshot(
  row: ResearchSnapshotSqlRow
): CompanyResearchSnapshotSummary {
  return {
    id: row.id,
    status: isResearchStatus(row.status) ? row.status : "NOT_RUN",
    httpStatus: row.httpStatus,
    finalUrl: row.finalUrl,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    researchVersion: Number(row.researchVersion),
    createdAt: toIso(row.createdAt),
  };
}

function mapIntelligenceProfile(
  row: IntelligenceProfileSqlRow
): CompanyIntelligenceProfileSummary {
  const facts = readStringArray(row.factsJson);
  const evidenceItems = readEvidenceItems(row.evidenceItemsJson);

  return {
    id: row.id,
    companySummary: row.companySummary,
    facts,
    factsByFamily: groupFactsByFamily(facts),
    evidenceItems,
    evidenceByFamily: groupEvidenceByFamily(evidenceItems),
    classification: row.classificationJson,
    sourceCoverage: row.sourceCoverageJson,
    riskSignals: row.riskSignalsJson,
    confidence: row.confidenceJson,
    profileStatus: isProfileStatus(row.profileStatus)
      ? row.profileStatus
      : "PLACEHOLDER",
    staleAt: toIsoOrNull(row.staleAt),
    researchVersion: Number(row.researchVersion),
    createdAt: toIso(row.createdAt),
  };
}

function mapCrossIcpLeadAssignment(
  row: CrossIcpSqlRow
): CompanyCrossIcpLeadAssignment {
  return {
    leadAssignmentId: row.leadAssignmentId,
    projectName: row.projectName,
    icpProfileName: row.icpProfileName,
    icpVersionNumber: Number(row.icpVersionNumber),
    workflowStatus: row.workflowStatus,
    qualification: row.qualification
      ? normalizeQualification(row.qualification)
      : "NOT_SCORED",
    fitScore: row.fitScore === null ? null : Number(row.fitScore),
    accountPreRank: normalizeAccountPreRank(row.accountPreRank),
    lastScoredAt: toIsoOrNull(row.lastScoredAt),
    createdAt: toIso(row.createdAt),
  };
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readEvidenceItems(value: unknown): CompanyIntelligenceEvidenceItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const token = (item as { token?: unknown }).token;
      const evidenceText = (item as { evidenceText?: unknown }).evidenceText;
      const sourceUrl = (item as { sourceUrl?: unknown }).sourceUrl;

      if (
        typeof token !== "string" ||
        typeof evidenceText !== "string" ||
        typeof sourceUrl !== "string"
      ) {
        return null;
      }

      const pageType = (item as { pageType?: unknown }).pageType;
      const provider = (item as { provider?: unknown }).provider;
      const confidence = (item as { confidence?: unknown }).confidence;

      return {
        token,
        family: getFactFamily(token),
        evidenceText,
        sourceUrl,
        pageType: typeof pageType === "string" ? pageType : null,
        provider: typeof provider === "string" ? provider : null,
        confidence: typeof confidence === "string" ? confidence : null,
      };
    })
    .filter((item): item is CompanyIntelligenceEvidenceItem => item !== null);
}

function groupFactsByFamily(facts: string[]) {
  const groups = new Map<string, string[]>();

  for (const fact of facts) {
    const family = getFactFamily(fact);
    const group = groups.get(family) ?? [];
    group.push(fact);
    groups.set(family, group);
  }

  return Array.from(groups.entries()).map(([family, tokens]) => ({
    family,
    tokens,
  }));
}

function groupEvidenceByFamily(items: CompanyIntelligenceEvidenceItem[]) {
  const groups = new Map<string, CompanyIntelligenceEvidenceItem[]>();

  for (const item of items) {
    const group = groups.get(item.family) ?? [];
    group.push(item);
    groups.set(item.family, group);
  }

  return Array.from(groups.entries()).map(([family, groupItems]) => ({
    family,
    items: groupItems,
  }));
}

function getFactFamily(token: string) {
  return token.split(".")[0] || "other";
}

function normalizeQualification(value: string): LeadWorkspaceQualification {
  if (
    value === "QUALIFIED" ||
    value === "NEEDS_REVIEW" ||
    value === "UNQUALIFIED" ||
    value === "COMPANY_QUALIFIED_NEEDS_CONTACT" ||
    value === "NOT_SCORED"
  ) {
    return value;
  }

  return "NEEDS_REVIEW";
}

function normalizeAccountPreRank(
  value: string | null
): LeadWorkspaceAccountPreRank | null {
  if (
    value === "STRONG_ACCOUNT_FIT" ||
    value === "POSSIBLE_ACCOUNT_FIT" ||
    value === "WEAK_FIT" ||
    value === "CLEAR_MISMATCH"
  ) {
    return value;
  }

  return null;
}

function isResearchStatus(value: unknown): value is CompanyResearchStatus {
  return (
    value === "SUCCESS" ||
    value === "NO_WEBSITE" ||
    value === "OFFLINE" ||
    value === "BLOCKED" ||
    value === "TIMEOUT" ||
    value === "JS_RENDER_REQUIRED" ||
    value === "PARTIAL" ||
    value === "INVALID_URL" ||
    value === "PARKED" ||
    value === "NOT_RUN"
  );
}

function isProfileStatus(value: unknown): value is CompanyProfileStatus {
  return (
    value === "PLACEHOLDER" ||
    value === "EXTRACTED" ||
    value === "PARTIAL" ||
    value === "FAILED"
  );
}

function normalizePage(value: number | undefined) {
  return Number.isInteger(value) && value && value > 0 ? value : 1;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null) {
  return value === null ? null : toIso(value);
}

async function getDefaultDb(): Promise<CompanyIntelligenceReadDb> {
  const { prisma } = await import("@/lib/server/prisma");

  return prisma;
}

// â”€â”€ Research history â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CompanyResearchHistoryEntry = {
  kind: "snapshot" | "profile";
  id: string;
  researchVersion: number;
  status: string;
  createdAt: string;
  isLive: boolean; // the newest profile is what the drawers currently present
};

/**
 * Full research timeline for a company (crawl snapshots + intelligence profiles), newest
 * first. The detail queries elsewhere are LIMIT 1 by design; this powers the drawer's
 * "Data & History" tab so multiple researchVersion rows stop being unreachable.
 */
export async function queryCompanyResearchHistory(
  organizationId: string,
  companyId: string,
  db?: CompanyIntelligenceReadDb
): Promise<CompanyResearchHistoryEntry[]> {
  const activeDb = db ?? (await getDefaultDb());
  const rows = await activeDb.$queryRawUnsafe<
    Array<{ kind: string; id: string; researchVersion: number; status: string; createdAt: Date | string }>
  >(
    `
      SELECT * FROM (
        SELECT 'snapshot' AS "kind", "id", "researchVersion", "status"::text AS "status", "createdAt"
        FROM "V2CompanyResearchSnapshot"
        WHERE "organizationId" = $1 AND "companyId" = $2
        UNION ALL
        SELECT 'profile' AS "kind", "id", "researchVersion", "profileStatus"::text AS "status", "createdAt"
        FROM "V2CompanyIntelligenceProfile"
        WHERE "organizationId" = $1 AND "companyId" = $2
      ) history
      ORDER BY history."createdAt" DESC, history."researchVersion" DESC
      LIMIT 40
    `,
    organizationId,
    companyId
  );

  const liveProfileId = rows.find((row) => row.kind === "profile")?.id ?? null;
  return rows.map((row) => ({
    kind: row.kind === "profile" ? "profile" : "snapshot",
    id: row.id,
    researchVersion: Number(row.researchVersion),
    status: row.status,
    createdAt: toIso(row.createdAt),
    isLive: row.kind === "profile" && row.id === liveProfileId,
  }));
}
