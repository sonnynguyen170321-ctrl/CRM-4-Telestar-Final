import "server-only";

import { prisma } from "@/lib/server/prisma";
import { traceQuery, withSpan } from "@/lib/v2/observability/trace";
import {
  contactIdentifierColumns,
  contactSourceColumn,
  shapeContactEnrichment,
} from "./contactEnrichment";
import { PRIORITY_ORDER_BY_SQL } from "./leadPriority";
import { verticalMatchAliases } from "@telestar/core-scoring/rules/dictionaries/servedVertical";
import { resolveContactDisplayName } from "./resolveContactDisplayName";
import { assessLinkedInAccess, deriveContactability, type ContactabilityStatus, type ContactQualityReason, type LinkedInAccess } from "./contactQuality";
import type {
  LeadWorkspaceAccountPreRank,
  LeadWorkspaceFilters,
  LeadWorkspaceQualification,
} from "./types";

const MAX_PAGE_SIZE = 1000; // supports the "All"/custom page-size control on /v2/leads
const VALID_CONTACTABILITY = new Set([
  "has_email",
  "missing_email",
  "ready",
  "review",
  "linkedin_only",
  "company_phone",
  "missing",
]);
const VALID_QUALIFICATIONS = new Set([
  "QUALIFIED",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
  "NOT_SCORED",
]);

export type ContactLeadRow = {
  contactId: string;
  contactName: string;
  contactTitle: string | null;
  contactCity: string | null;
  contactCountry: string | null;
  email: string | null;
  phone: string | null;
  linkedInUrl: string | null;
  source: string | null;
  seniorityTier: string;
  department: string;
  hasUsableEmail: boolean;
  emailValidityStatus: string | null;
  emailIsGeneric: boolean;
  emailSource: string | null;
  phoneValidityStatus: string | null;
  phoneSource: string | null;
  leadAssignmentId: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  companyWebsiteUrl: string | null;
  companyCountry: string | null;
  projectId: string;
  projectName: string;
  icpVersionId: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  ownerUserId: string | null;
  ownerName: string | null;
  assignedAt: string | null;
  /** When the lead entered the pipeline (LeadAssignment.createdAt) — the date column + filter key. */
  createdAt: string | null;
  fitScore: number | null;
  confidence: number | null;
  qualification: LeadWorkspaceQualification;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  reason: string | null;
  companySummary: string | null;
  companyIntelligenceStatus: string | null;
  companyFactTokens: string[];
  latestAssessmentId: string | null;
  scoringVersion: string | null;
  inputFingerprint: string | null;
  icpRulesHash: string | null;
  assessmentCreatedAt: string | null;
  leadCount: number;
  linkedProjectCount: number;
  linkedIcpCount: number;
  activeEnrollmentCount: number;
  lastTouchAt: string | null;
  lastTouchChannel: string | null;
  meetingStatus: "BOOKED" | "DONE" | "NONE";
  reviewStatus: "REVIEWED" | "NOT_REVIEWED";
  linkedInAccess: LinkedInAccess;
  qualityReasons: ContactQualityReason[];
  outreachReady: boolean;
  contactabilityStatus: ContactabilityStatus;
  contactabilityPrimaryChannel: "email" | "linkedin" | "phone" | "none";
  emailUsable: boolean;
};

export type ContactLeadsFilters = LeadWorkspaceFilters & {
  ownerUserId?: string;
  linkedinAccess?: "accessible" | "blocked" | "missing";
};

export type ContactLeadSort = "priority" | "recent";

export type ContactLeadsResult = {
  rows: ContactLeadRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ContactLeadMetrics = {
  total: number;
  qualified: number;
  needsReview: number;
  needsContact: number;
  unqualified: number;
  notScored: number;
  meetings: number;
};

export type ContactLeadsDb = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  // Optional (present on the real Prisma client) — used to pin planner GUCs for the heavy lead
  // workspace query. Mocks that omit these fall back to a plain query (unchanged behavior).
  $executeRawUnsafe?(query: string, ...values: unknown[]): Promise<number>;
  $transaction?: <T>(
    fn: (tx: {
      $queryRawUnsafe<R = unknown>(query: string, ...values: unknown[]): Promise<R>;
      $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
    }) => Promise<T>,
    options?: { timeout?: number; maxWait?: number }
  ) => Promise<T>;
};

// The lead-workspace FROM is hand-written la-first (anchored on the (contactId, updatedAt) index),
// then the dimension tables (company/project/icp/profile) join to that single chosen row. But
// Postgres' join reordering ignores that and instead drives from the tiny dimension tables — a
// Project×ICP×Profile cross join re-run per contact — which explodes to ~10s at a few thousand
// contacts. Forcing the written join order (join_collapse_limit=1) collapses that to <600ms with
// identical results (plan-only change). SET LOCAL binds to the connection, so it must run inside a
// transaction alongside the query. Prisma-less mocks fall back to a plain query.
async function runPinnedJoinOrder<T>(db: ContactLeadsDb, sql: string, params: unknown[]): Promise<T> {
  if (db.$transaction) {
    return db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL join_collapse_limit = 1");
        await tx.$executeRawUnsafe("SET LOCAL from_collapse_limit = 1");
        return tx.$queryRawUnsafe<T>(sql, ...params);
      },
      { timeout: 30_000 }
    );
  }
  return db.$queryRawUnsafe<T>(sql, ...params);
}

type SqlRow = {
  contactId: string;
  fullName: string;
  title: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  emailValidityStatus: string | null;
  emailIsGeneric: boolean | null;
  emailSource: string | null;
  phone: string | null;
  phoneValidityStatus: string | null;
  phoneSource: string | null;
  linkedInUrl: string | null;
  source: string | null;
  leadAssignmentId: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  companyWebsiteUrl: string | null;
  companyCountry: string | null;
  projectId: string;
  projectName: string;
  icpVersionId: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  ownerUserId: string | null;
  ownerName: string | null;
  assignedAt: Date | string | null;
  createdAt: Date | string | null;
  fitScore: number | null;
  confidence: number | string | null;
  qualification: string | null;
  accountPreRank: string | null;
  reason: string | null;
  companySummary: string | null;
  latestAssessmentId: string | null;
  scoringVersion: string | null;
  inputFingerprint: string | null;
  icpRulesHash: string | null;
  assessmentCreatedAt: Date | string | null;
  companyIntelligenceStatus: string | null;
  companyFactTokens: unknown;
  leadCount: number | bigint | null;
  linkedProjectCount: number | bigint | null;
  linkedIcpCount: number | bigint | null;
  activeEnrollmentCount: number | bigint | null;
  lastTouchAt: Date | string | null;
  lastTouchChannel: string | null;
  hasMeetingDone: boolean | null;
  hasMeetingBooked: boolean | null;
  hasResolvedReview: boolean | null;
  linkedInAny: string | null;
  linkedInValidity: string | null;
};

type QueryBuilder = {
  params: unknown[];
  fromSql: string;
};

export async function queryContactLeads(
  input: {
    organizationId: string;
    page?: number;
    pageSize?: number;
    filters?: ContactLeadsFilters;
    sort?: ContactLeadSort;
    // Skip the separate COUNT(*) scan when the caller derives the total elsewhere —
    // queryContactLeadMetrics runs the same builder and already returns `total`, so the
    // leads page patches pagination from metrics instead of paying a third full scan.
    skipCount?: boolean;
  },
  db: ContactLeadsDb = prisma
): Promise<ContactLeadsResult> {
  const page = normalizePage(input.page);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = (page - 1) * pageSize;
  const builder = createContactLeadsBuilder(input.organizationId, input.filters);

  // Default sort is the smart priority rank (Hot first); "recent" falls back to chronological.
  // Priority is a SQL expression over already-selected columns, so it ranks the whole set
  // correctly under LIMIT/OFFSET (no per-row work, no N+1). `updatedAt` is the tiebreaker.
  const orderBySql =
    input.sort === "recent"
      ? `plead."updatedAt" DESC, c."id" ASC`
      : `${PRIORITY_ORDER_BY_SQL} DESC, plead."updatedAt" DESC, c."id" ASC`;

  return withSpan("leads.list", async () => {
    const rows = await traceQuery("leads.rows", () => runPinnedJoinOrder<SqlRow[]>(
      db,
      `${buildContactLeadSelect()} ${builder.fromSql}
       ORDER BY ${orderBySql}
       LIMIT ${pageSize} OFFSET ${offset}`,
      builder.params
    ), (r) => r.length);

    let total = 0;
    if (!input.skipCount) {
      const countRows = await traceQuery("leads.count", () => runPinnedJoinOrder<Array<{ total: bigint | number }>>(
        db,
        `SELECT COUNT(*) AS "total" ${builder.fromSql}`,
        builder.params
      ));
      total = Number(countRows[0]?.total ?? 0);
    }

    return {
      rows: rows.map(mapContactLeadRow),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  });
}

export async function queryContactLeadMetrics(
  input: { organizationId: string; filters?: ContactLeadsFilters },
  db: ContactLeadsDb = prisma
): Promise<ContactLeadMetrics> {
  const builder = createContactLeadsBuilder(input.organizationId, input.filters);
  const rows = await traceQuery("leads.metrics", () => runPinnedJoinOrder<
    Array<{
      total: bigint | number;
      qualified: bigint | number;
      needsReview: bigint | number;
      needsContact: bigint | number;
      unqualified: bigint | number;
      notScored: bigint | number;
      meetings: bigint | number;
    }>
  >(
    db,
    `SELECT
       COUNT(*) AS "total",
       COUNT(*) FILTER (WHERE plead."qualification" = 'QUALIFIED') AS "qualified",
       COUNT(*) FILTER (WHERE plead."qualification" = 'NEEDS_REVIEW') AS "needsReview",
       COUNT(*) FILTER (WHERE plead."qualification" = 'COMPANY_QUALIFIED_NEEDS_CONTACT') AS "needsContact",
       COUNT(*) FILTER (WHERE plead."qualification" = 'UNQUALIFIED') AS "unqualified",
       COUNT(*) FILTER (WHERE plead."latestAssessmentId" IS NULL) AS "notScored",
       COUNT(*) FILTER (WHERE plead."workflowStatus" IN ('MEETING_BOOKED', 'MEETING_DONE')) AS "meetings"
     ${builder.fromSql}`,
    builder.params
  ));
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

function createContactLeadsBuilder(
  organizationId: string,
  filters: ContactLeadsFilters | undefined
): QueryBuilder {
  const f = filters ?? {};

  // /v2/leads is the cross-cutting workbench: Account / Project / ICP are OPTIONAL
  // filters, not a hard context. With none, the primary lead = the contact's newest
  // active CONTACT assignment across any ICP (selection ORDER BY in the LATERAL).
  const params: unknown[] = [organizationId];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const primaryClauses: string[] = [];
  if (f.clientAccountId) primaryClauses.push(`project."clientAccountId" = ${add(f.clientAccountId)}`);
  if (f.projectId) primaryClauses.push(`la."projectId" = ${add(f.projectId)}`);
  if (f.icpVersionId) primaryClauses.push(`la."icpVersionId" = ${add(f.icpVersionId)}`);
  const outerClauses = [
    `c."organizationId" = $1`,
    `c."deletedAt" IS NULL`,
    `c."status" = 'ACTIVE'`,
  ];

  const addArray = (values: unknown[]) => {
    return values.map(v => add(v)).join(", ");
  };

  if (f.ownerUserId) outerClauses.push(`plead."ownerUserId" = ${add(f.ownerUserId)}`);
  if (f.companyId) outerClauses.push(`plead."companyId" = ${add(f.companyId)}`);

  // Date range on when the lead entered the pipeline (LeadAssignment.createdAt). Half-open:
  // createdTo is inclusive of its whole day (< to + 1 day). Values are ISO date/datetime strings.
  if (f.createdFrom) outerClauses.push(`plead."createdAt" >= ${add(f.createdFrom)}::timestamptz`);
  if (f.createdTo) outerClauses.push(`plead."createdAt" < (${add(f.createdTo)}::timestamptz + interval '1 day')`);

  // LinkedIn access filter. "accessible" = a usable LinkedIn identifier exists; "blocked" =
  // has a LinkedIn but all are 404/private/invalid; "missing" = no LinkedIn at all. Shape
  // (malformed) is normalized to validityStatus='INVALID' at ingestion, so this is enough.
  if (f.linkedinAccess) {
    const anyLinkedIn = `EXISTS (SELECT 1 FROM "V2ContactIdentifier" li
        WHERE li."organizationId" = c."organizationId" AND li."contactId" = c."id" AND li."type" = 'LINKEDIN')`;
    const okLinkedIn = `EXISTS (SELECT 1 FROM "V2ContactIdentifier" li
        WHERE li."organizationId" = c."organizationId" AND li."contactId" = c."id" AND li."type" = 'LINKEDIN'
          AND li."validityStatus" NOT IN ('NOT_FOUND','PRIVATE','INVALID','BOUNCED','SUPPRESSED'))`;
    if (f.linkedinAccess === "missing") outerClauses.push(`NOT ${anyLinkedIn}`);
    else if (f.linkedinAccess === "accessible") outerClauses.push(okLinkedIn);
    else outerClauses.push(`(${anyLinkedIn} AND NOT ${okLinkedIn})`); // blocked
  }

  if (f.workflowStatus?.length) {
    outerClauses.push(`plead."workflowStatus" IN (${addArray(f.workflowStatus)})`);
  }
  if (f.excludeWorkflowStatus?.length) {
    outerClauses.push(`plead."workflowStatus" NOT IN (${addArray(f.excludeWorkflowStatus)})`);
  }

  if (f.assignmentLevel === "COMPANY") outerClauses.push("FALSE");

  if (f.qualification?.length) {
    const hasNotScored = f.qualification.includes("NOT_SCORED");
    const validQuals = f.qualification.filter(q => q !== "NOT_SCORED");

    if (hasNotScored && validQuals.length === 0) {
      primaryClauses.push(`la."latestHardRuleAssessmentId" IS NULL`);
    } else if (hasNotScored && validQuals.length > 0) {
      primaryClauses.push(`(la."latestHardRuleAssessmentId" IS NULL OR assessment."qualification" IN (${addArray(validQuals)}))`);
    } else {
      primaryClauses.push(`assessment."qualification" IN (${addArray(validQuals)})`);
    }
  }

  if (f.excludeQualification?.length) {
    const hasNotScored = f.excludeQualification.includes("NOT_SCORED");
    const validQuals = f.excludeQualification.filter(q => q !== "NOT_SCORED");

    if (hasNotScored && validQuals.length === 0) {
      primaryClauses.push(`la."latestHardRuleAssessmentId" IS NOT NULL`);
    } else if (hasNotScored && validQuals.length > 0) {
      primaryClauses.push(`(la."latestHardRuleAssessmentId" IS NOT NULL AND (assessment."qualification" IS NULL OR assessment."qualification" NOT IN (${addArray(validQuals)})))`);
    } else {
      primaryClauses.push(`(assessment."qualification" IS NULL OR assessment."qualification" NOT IN (${addArray(validQuals)}))`);
    }
  }

  if (f.scored === "scored") primaryClauses.push(`la."latestHardRuleAssessmentId" IS NOT NULL`);
  if (f.scored === "unscored") primaryClauses.push(`la."latestHardRuleAssessmentId" IS NULL`);
  if (f.confidenceBand?.length) {
    const bandClauses = [];
    if (f.confidenceBand.includes("HIGH")) bandClauses.push(`assessment."confidence" >= 0.75`);
    if (f.confidenceBand.includes("MEDIUM")) bandClauses.push(`(assessment."confidence" >= 0.45 AND assessment."confidence" < 0.75)`);
    if (f.confidenceBand.includes("LOW")) bandClauses.push(`assessment."confidence" < 0.45`);
    if (bandClauses.length > 0) {
      primaryClauses.push(`(${bandClauses.join(" OR ")})`);
    }
  }
  if (f.country?.length) {
    const countryClauses = f.country.map(c => `plead."companyCountry" ILIKE ${add(`%${c}%`)}`);
    outerClauses.push(`(${countryClauses.join(" OR ")})`);
  }
  if (f.excludeCountry?.length) {
    const countryClauses = f.excludeCountry.map(c => `plead."companyCountry" NOT ILIKE ${add(`%${c}%`)}`);
    outerClauses.push(`(${countryClauses.join(" AND ")})`);
  }
  if (f.domain) outerClauses.push(`plead."companyDomain" ILIKE ${add(`%${f.domain}%`)}`);
  if (f.contactReadiness && VALID_CONTACTABILITY.has(f.contactReadiness)) {
    const readyEmail = `EXISTS (
      SELECT 1 FROM "V2ContactIdentifier" ready_email
      WHERE ready_email."organizationId" = c."organizationId"
        AND ready_email."contactId" = c."id"
        AND ready_email."type" = 'EMAIL'
        AND ready_email."isValid" = true
        AND ready_email."isGeneric" = false
        AND ready_email."validityStatus" = 'VALID'
    )`;
    const anyEmail = `EXISTS (
      SELECT 1 FROM "V2ContactIdentifier" any_email
      WHERE any_email."organizationId" = c."organizationId"
        AND any_email."contactId" = c."id"
        AND any_email."type" = 'EMAIL'
        AND any_email."isValid" = true
    )`;
    const usableLinkedIn = `EXISTS (
      SELECT 1 FROM "V2ContactIdentifier" li
      WHERE li."organizationId" = c."organizationId"
        AND li."contactId" = c."id"
        AND li."type" = 'LINKEDIN'
        AND li."isValid" = true
        AND li."validityStatus" NOT IN ('NOT_FOUND','PRIVATE','INVALID','BOUNCED','SUPPRESSED')
    )`;
    const phoneExists = `EXISTS (
      SELECT 1 FROM "V2ContactIdentifier" ph
      WHERE ph."organizationId" = c."organizationId"
        AND ph."contactId" = c."id"
        AND ph."type" = 'PHONE'
        AND ph."isValid" = true
    )`;
    if (f.contactReadiness === "has_email" || f.contactReadiness === "ready") outerClauses.push(readyEmail);
    else if (f.contactReadiness === "missing_email") outerClauses.push(`NOT ${readyEmail}`);
    else if (f.contactReadiness === "linkedin_only") outerClauses.push(`(${usableLinkedIn} AND NOT ${anyEmail})`);
    else if (f.contactReadiness === "company_phone") outerClauses.push(`(${phoneExists} AND NOT ${readyEmail} AND NOT ${usableLinkedIn})`);
    else if (f.contactReadiness === "review") outerClauses.push(`((${anyEmail} AND NOT ${readyEmail}) OR (${usableLinkedIn} AND NOT ${readyEmail}))`);
    else if (f.contactReadiness === "missing") outerClauses.push(`(NOT ${anyEmail} AND NOT ${usableLinkedIn} AND NOT ${phoneExists})`);
  }
  if (f.enrollment === "enrolled") {
    outerClauses.push(`COALESCE(enroll."activeEnrollmentCount", 0) > 0`);
  }
  if (f.enrollment === "not_enrolled") {
    outerClauses.push(`COALESCE(enroll."activeEnrollmentCount", 0) = 0`);
  }
  if (f.intelligenceStatus?.length) {
    const hasMissing = f.intelligenceStatus.includes("MISSING");
    const validStatuses = f.intelligenceStatus.filter(s => s !== "MISSING");

    if (hasMissing && validStatuses.length === 0) {
      outerClauses.push(`plead."companyIntelligenceStatus" IS NULL`);
    } else if (hasMissing && validStatuses.length > 0) {
      outerClauses.push(`(plead."companyIntelligenceStatus" IS NULL OR plead."companyIntelligenceStatus" IN (${addArray(validStatuses)}))`);
    } else {
      outerClauses.push(`plead."companyIntelligenceStatus" IN (${addArray(validStatuses)})`);
    }
  }
  if (f.excludeIntelligenceStatus?.length) {
    const hasMissing = f.excludeIntelligenceStatus.includes("MISSING");
    const validStatuses = f.excludeIntelligenceStatus.filter(s => s !== "MISSING");

    if (hasMissing && validStatuses.length === 0) {
      outerClauses.push(`plead."companyIntelligenceStatus" IS NOT NULL`);
    } else if (hasMissing && validStatuses.length > 0) {
      outerClauses.push(`(plead."companyIntelligenceStatus" IS NOT NULL AND plead."companyIntelligenceStatus" NOT IN (${addArray(validStatuses)}))`);
    } else {
      outerClauses.push(`(plead."companyIntelligenceStatus" IS NULL OR plead."companyIntelligenceStatus" NOT IN (${addArray(validStatuses)}))`);
    }
  }

  if (f.factToken?.length) {
    const tokenClauses = f.factToken.map(t => `COALESCE(plead."companyFactTokens", '[]'::jsonb) ? ${add(t)}`);
    outerClauses.push(`(${tokenClauses.join(" AND ")})`);
  }
  if (f.excludeFactToken?.length) {
    const tokenClauses = f.excludeFactToken.map(t => `NOT (COALESCE(plead."companyFactTokens", '[]'::jsonb) ? ${add(t)})`);
    outerClauses.push(`(${tokenClauses.join(" AND ")})`);
  }
  if (f.servedVertical?.length) {
    // W5 hierarchical industry filter: match the selected verticals' aliases (node + descendants)
    // against the lead's company name, one-sentence summary, or fact tokens.
    const patterns = Array.from(
      new Set(f.servedVertical.flatMap((key) => verticalMatchAliases(key)).map((a) => `%${a}%`))
    );
    if (patterns.length > 0) {
      const arr = add(patterns);
      outerClauses.push(`(
        plead."companyName" ILIKE ANY(${arr}::text[])
        OR plead."companySummary" ILIKE ANY(${arr}::text[])
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(COALESCE(plead."companyFactTokens", '[]'::jsonb)) fv
          WHERE fv ILIKE ANY(${arr}::text[])
        )
      )`);
    }
  }
  if (f.search?.trim()) {
    const search = add(`%${f.search.trim()}%`);
    outerClauses.push(`(
      c."fullName" ILIKE ${search}
      OR c."title" ILIKE ${search}
      OR c."city" ILIKE ${search}
      OR c."country" ILIKE ${search}
      OR plead."companyName" ILIKE ${search}
      OR plead."companyDomain" ILIKE ${search}
      OR EXISTS (
        SELECT 1 FROM "V2ContactIdentifier" searched_identifier
        WHERE searched_identifier."organizationId" = c."organizationId"
          AND searched_identifier."contactId" = c."id"
          AND searched_identifier."isValid" = true
          AND searched_identifier."normalizedValue" ILIKE ${search}
      )
    )`);
  }

  return {
    params,
    fromSql: buildContactLeadsFrom(
      outerClauses.join(" AND "),
      primaryClauses.length ? primaryClauses.join(" AND ") : "TRUE"
    ),
  };
}

function buildContactLeadsFrom(whereSql: string, primaryFilterSql: string): string {
  return `
    FROM "V2Contact" c
    CROSS JOIN LATERAL (
      SELECT
        la."id" AS "leadAssignmentId", la."companyId", la."createdAt", la."updatedAt",
        company."name" AS "companyName", company."canonicalDomain" AS "companyDomain",
        company."websiteUrl" AS "companyWebsiteUrl", company."country" AS "companyCountry",
        la."projectId", project."name" AS "projectName", la."icpVersionId",
        profile."name" AS "icpProfileName", icp."versionNumber" AS "icpVersionNumber",
        la."workflowStatus"::text AS "workflowStatus", la."ownerUserId",
        owner."name" AS "ownerName", la."assignedAt",
        assessment."id" AS "latestAssessmentId", assessment."fitScore", assessment."confidence",
        assessment."qualification"::text AS "qualification",
        assessment."accountPreRank"::text AS "accountPreRank", assessment."reason",
        assessment."oneSentenceCompanySummary" AS "companySummary",
        assessment."scoringVersion", assessment."inputFingerprint", assessment."icpRulesHash",
        assessment."createdAt" AS "assessmentCreatedAt",
        latest_profile."profileStatus"::text AS "companyIntelligenceStatus",
        COALESCE(latest_profile."factsJson", '[]'::jsonb) AS "companyFactTokens"
      FROM "V2LeadAssignment" la
      INNER JOIN "V2Company" company
        ON company."id" = la."companyId" AND company."organizationId" = la."organizationId"
        AND company."status" = 'ACTIVE' AND company."deletedAt" IS NULL
      INNER JOIN "V2Project" project
        ON project."id" = la."projectId" AND project."organizationId" = la."organizationId"
        AND project."status" = 'ACTIVE'
      INNER JOIN "V2ICPVersion" icp
        ON icp."id" = la."icpVersionId" AND icp."organizationId" = la."organizationId"
        AND icp."deletedAt" IS NULL
      INNER JOIN "V2ICPProfile" profile
        ON profile."id" = icp."icpProfileId" AND profile."organizationId" = la."organizationId"
        AND profile."status" = 'ACTIVE'
      LEFT JOIN "V2User" owner ON owner."id" = la."ownerUserId"
      LEFT JOIN "V2HardRuleAssessment" assessment
        ON assessment."id" = la."latestHardRuleAssessmentId"
        AND assessment."organizationId" = la."organizationId"
      LEFT JOIN LATERAL (
        SELECT cip."profileStatus", cip."factsJson"
        FROM "V2CompanyIntelligenceProfile" cip
        WHERE cip."organizationId" = la."organizationId" AND cip."companyId" = la."companyId"
        ORDER BY cip."createdAt" DESC, cip."researchVersion" DESC, cip."id" DESC
        LIMIT 1
      ) latest_profile ON true
      WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
        AND la."assignmentLevel" = 'CONTACT'
        AND la."deletedAt" IS NULL AND la."status" = 'ACTIVE'
        AND ${primaryFilterSql}
      ORDER BY la."updatedAt" DESC, la."id" ASC
      LIMIT 1
    ) plead
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS "leadCount",
        COUNT(DISTINCT la2."projectId")::int AS "linkedProjectCount",
        COUNT(DISTINCT la2."icpVersionId")::int AS "linkedIcpCount",
        COUNT(*) FILTER (WHERE la2."workflowStatus" = 'MEETING_DONE') AS "meetingDone",
        COUNT(*) FILTER (WHERE la2."workflowStatus" = 'MEETING_BOOKED') AS "meetingBooked"
      FROM "V2LeadAssignment" la2
      WHERE la2."contactId" = c."id" AND la2."organizationId" = c."organizationId"
        AND la2."assignmentLevel" = 'CONTACT'
        AND la2."deletedAt" IS NULL AND la2."status" = 'ACTIVE'
    ) agg ON true
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS "activeEnrollmentCount"
      FROM "V2SequenceEnrollment" se
      WHERE se."organizationId" = c."organizationId" AND se."contactId" = c."id"
        AND se."status" IN ('ACTIVE', 'PAUSED') AND se."deletedAt" IS NULL
    ) enroll ON true
    LEFT JOIN LATERAL (
      SELECT touch."occurredAt" AS "lastTouchAt", touch."channel" AS "lastTouchChannel"
      FROM (
        SELECT oa."occurredAt", oa."channel" FROM "V2OutreachActivity" oa
        WHERE oa."organizationId" = c."organizationId" AND oa."contactId" = c."id"
        UNION ALL
        SELECT ar."occurredAt", ar."channel" FROM "V2ActivityRecord" ar
        WHERE ar."organizationId" = c."organizationId" AND ar."contactId" = c."id"
          AND ar."deletedAt" IS NULL
      ) touch
      ORDER BY touch."occurredAt" DESC LIMIT 1
    ) last_touch ON true
    LEFT JOIN LATERAL (
      SELECT TRUE AS "hasReview" FROM "V2ManagerReviewItem" mri
      WHERE mri."organizationId" = c."organizationId" AND mri."contactId" = c."id"
        AND mri."deletedAt" IS NULL
        AND mri."status" NOT IN ('OPEN', 'IN_PROGRESS', 'SNOOZED')
      LIMIT 1
    ) review_flag ON true
    WHERE ${whereSql}
  `;
}

function buildContactLeadSelect(): string {
  return `SELECT
    c."id" AS "contactId", c."fullName", c."title", c."city", c."country",
    ${contactIdentifierColumns("c")},
    ${contactSourceColumn("c")},
    plead."leadAssignmentId", plead."companyId", plead."companyName", plead."companyDomain",
    plead."companyWebsiteUrl", plead."companyCountry", plead."projectId", plead."projectName",
    plead."icpVersionId", plead."icpProfileName", plead."icpVersionNumber",
    plead."workflowStatus", plead."ownerUserId", plead."ownerName", plead."assignedAt", plead."createdAt",
    plead."fitScore", plead."confidence", plead."qualification", plead."accountPreRank",
    plead."reason", plead."companySummary", plead."latestAssessmentId", plead."scoringVersion",
    plead."inputFingerprint", plead."icpRulesHash", plead."assessmentCreatedAt",
    plead."companyIntelligenceStatus", plead."companyFactTokens",
    COALESCE(agg."leadCount", 0)::int AS "leadCount",
    COALESCE(agg."linkedProjectCount", 0)::int AS "linkedProjectCount",
    COALESCE(agg."linkedIcpCount", 0)::int AS "linkedIcpCount",
    COALESCE(enroll."activeEnrollmentCount", 0)::int AS "activeEnrollmentCount",
    last_touch."lastTouchAt", last_touch."lastTouchChannel",
    (COALESCE(agg."meetingDone", 0) > 0) AS "hasMeetingDone",
    (COALESCE(agg."meetingBooked", 0) > 0) AS "hasMeetingBooked",
    (review_flag."hasReview" IS NOT NULL) AS "hasResolvedReview"`;
}

function mapContactLeadRow(row: SqlRow): ContactLeadRow {
  const contact = shapeContactEnrichment(row);

  return {
    contactId: row.contactId,
    contactName: resolveContactDisplayName({
      fullName: contact.fullName,
      email: contact.email,
      companyName: row.companyName,
    }),
    contactTitle: contact.title,
    contactCity: contact.city,
    contactCountry: contact.country,
    email: contact.email,
    phone: contact.phone,
    linkedInUrl: contact.linkedInUrl,
    source: contact.source,
    seniorityTier: contact.seniorityTier,
    department: contact.department,
    hasUsableEmail: contact.hasUsableEmail,
    emailValidityStatus: contact.emailValidityStatus,
    emailIsGeneric: contact.emailIsGeneric,
    emailSource: contact.emailSource,
    phoneValidityStatus: contact.phoneValidityStatus,
    phoneSource: contact.phoneSource,
    leadAssignmentId: row.leadAssignmentId,
    companyId: row.companyId,
    companyName: row.companyName,
    companyDomain: row.companyDomain,
    companyWebsiteUrl: row.companyWebsiteUrl,
    companyCountry: row.companyCountry,
    projectId: row.projectId,
    projectName: row.projectName,
    icpVersionId: row.icpVersionId,
    icpProfileName: row.icpProfileName,
    icpVersionNumber: Number(row.icpVersionNumber),
    workflowStatus: row.workflowStatus,
    ownerUserId: row.ownerUserId,
    ownerName: row.ownerName,
    assignedAt: toIso(row.assignedAt),
    createdAt: toIso(row.createdAt),
    fitScore: row.latestAssessmentId && row.fitScore !== null ? Number(row.fitScore) : null,
    confidence: row.latestAssessmentId && row.confidence !== null ? Number(row.confidence) : null,
    qualification: row.latestAssessmentId
      ? normalizeQualification(row.qualification)
      : "NOT_SCORED",
    accountPreRank: normalizeAccountPreRank(row.accountPreRank),
    reason: row.reason,
    companySummary: row.companySummary,
    companyIntelligenceStatus: row.companyIntelligenceStatus,
    companyFactTokens: normalizeStringArray(row.companyFactTokens),
    latestAssessmentId: row.latestAssessmentId,
    scoringVersion: row.scoringVersion,
    inputFingerprint: row.inputFingerprint,
    icpRulesHash: row.icpRulesHash,
    assessmentCreatedAt: toIso(row.assessmentCreatedAt),
    leadCount: Number(row.leadCount ?? 0),
    linkedProjectCount: Number(row.linkedProjectCount ?? 0),
    linkedIcpCount: Number(row.linkedIcpCount ?? 0),
    activeEnrollmentCount: Number(row.activeEnrollmentCount ?? 0),
    lastTouchAt: toIso(row.lastTouchAt),
    lastTouchChannel: row.lastTouchChannel,
    meetingStatus: row.hasMeetingDone ? "DONE" : row.hasMeetingBooked ? "BOOKED" : "NONE",
    reviewStatus: row.hasResolvedReview ? "REVIEWED" : "NOT_REVIEWED",
    ...quality(contact.email, contact.title, row.linkedInAny, row.linkedInValidity, contact.emailValidityStatus, contact.emailIsGeneric, contact.phone),
  };
}

function quality(
  email: string | null,
  title: string | null,
  linkedInAny: string | null,
  linkedInValidity: string | null,
  emailValidityStatus: string | null,
  emailIsGeneric: boolean,
  phone: string | null
): {
  linkedInAccess: LinkedInAccess;
  qualityReasons: ContactQualityReason[];
  outreachReady: boolean;
  contactabilityStatus: ContactabilityStatus;
  contactabilityPrimaryChannel: "email" | "linkedin" | "phone" | "none";
  emailUsable: boolean;
} {
  const contactability = deriveContactability({
    email,
    title,
    linkedInUrl: linkedInAny,
    linkedInValidityStatus: linkedInValidity,
    emailValidityStatus,
    emailIsGeneric,
    phone,
  });
  return {
    linkedInAccess: assessLinkedInAccess({ url: linkedInAny, validityStatus: linkedInValidity }),
    qualityReasons: contactability.reasons,
    outreachReady: contactability.emailUsable || contactability.primaryChannel === "linkedin",
    contactabilityStatus: contactability.status,
    contactabilityPrimaryChannel: contactability.primaryChannel,
    emailUsable: contactability.emailUsable,
  };
}

function normalizeQualification(value: string | null): LeadWorkspaceQualification {
  if (value && VALID_QUALIFICATIONS.has(value)) {
    return value as LeadWorkspaceQualification;
  }
  return "NOT_SCORED";
}

function normalizeAccountPreRank(value: string | null): LeadWorkspaceAccountPreRank | null {
  if (
    value === "STRONG_ACCOUNT_FIT" || value === "POSSIBLE_ACCOUNT_FIT" ||
    value === "WEAK_FIT" || value === "CLEAR_MISMATCH"
  ) {
    return value;
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toIso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function normalizePage(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0 ? value : 1;
}

function normalizePageSize(value: number | undefined): number {
  return Number.isInteger(value) && value && value > 0
    ? Math.min(value, MAX_PAGE_SIZE)
    : 50;
}
