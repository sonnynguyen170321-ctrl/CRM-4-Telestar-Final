import "server-only";

import {
  shapeContact,
  shapeContactsWorkspace,
  type ContactRow,
  type ContactsWorkspace,
  type ShapedContact,
} from "./shapeContacts";
import { contactIdentifierColumns, contactSourceColumn } from "./contactEnrichment";
import { SENIORITY_TAXONOMY } from "@telestar/core-scoring/rules/dictionaries/seniority";
import type {
  LeadWorkspaceAccountPreRank,
  LeadWorkspaceQualification,
} from "./types";

// R4: thin tenant-scoped loader for the contacts workspace. Joins the contact's
// primary valid EMAIL identifier + its active LeadAssignment count, then shapes
// via shapeContactsWorkspace (seniority enrichment + facets).

// Every value filter carries an operator so SDRs can INCLUDE or EXCLUDE it ("Industry is
// not Agency", "not in ICP A"). Boolean facets are tri-state (any / yes / no). A contact
// can sit in many projects/ICPs, so independent include/exclude facets give real control.
export type FilterOp = "is" | "not";
export type TriState = "yes" | "no";

export type QueryContactsOptions = {
  search?: string;
  // Attribute filters (each include/exclude).
  title?: string | string[];
  notTitle?: string | string[];
  country?: string | string[];
  notCountry?: string | string[];
  company?: string | string[];
  notCompany?: string | string[];
  industry?: string | string[];
  notIndustry?: string | string[];
  department?: string | string[];
  notDepartment?: string | string[];
  seniority?: string | string[];
  notSeniority?: string | string[];
  // Context filters (a contact is "in an ICP" via its active LeadAssignment).
  icpVersionId?: string | string[];
  notIcpVersionId?: string | string[];
  qualification?: string | string[];
  notQualification?: string | string[];
  // Presence facets.
  hasEmail?: TriState;
  hasPhone?: TriState;
  hasLinkedin?: TriState;
  hasEnrichment?: TriState;
  hasOpenReview?: TriState;
  ownerUserId?: string;
  limit?: number;
  page?: number;
  pageSize?: number;
};

export const CONTACT_QUALIFICATION_VALUES = [
  "QUALIFIED",
  "COMPANY_QUALIFIED_NEEDS_CONTACT",
  "NEEDS_REVIEW",
  "UNQUALIFIED",
  "NOT_SCORED",
] as const;

const QUALIFICATION_VALUES = new Set<string>(CONTACT_QUALIFICATION_VALUES);

// Reusable EXISTS over a contact's active lead -> company (the contact's company layer).
function companyExists(condition: string): string {
  return `EXISTS (
    SELECT 1 FROM "V2LeadAssignment" la
    INNER JOIN "V2Company" company
      ON company."id" = la."companyId"
      AND company."organizationId" = la."organizationId"
      AND company."deletedAt" IS NULL
    WHERE la."contactId" = c."id"
      AND la."organizationId" = c."organizationId"
      AND la."deletedAt" IS NULL
      AND ${condition}
  )`;
}

// EXISTS over a contact's valid identifier of a given type (email / phone / linkedin).
function identifierExists(type: "EMAIL" | "PHONE" | "LINKEDIN"): string {
  return `EXISTS (
    SELECT 1 FROM "V2ContactIdentifier" ci
    WHERE ci."contactId" = c."id" AND ci."organizationId" = c."organizationId"
      AND ci."type" = '${type}' AND ci."isValid" = true
  )`;
}

// Faithful SQL port of lookupSeniority: the ordered taxonomy as a CASE (first match wins),
// so a server-side seniority filter matches the same tier the UI shows. 2-3 letter acronyms
// match whole-word (Postgres \m..\M) so "cco" doesn't fire on "account"; longer keywords
// stay case-insensitive substrings.

function buildQualificationDisplayOrderSql(
  qualsParam: string | string[] | undefined,
  add: (value: unknown) => string
): string {
  if (!qualsParam) return "";
  const quals = Array.isArray(qualsParam) ? qualsParam : [qualsParam];
  const valid = quals.filter(q => QUALIFICATION_VALUES.has(q));
  if (valid.length === 0) return "";
  const conds: string[] = [];
  const realQuals = valid.filter(q => q !== "NOT_SCORED");
  if (realQuals.length > 0) {
    const params = realQuals.map(q => `${add(q)}::"V2Qualification"`);
    conds.push(`assessment."qualification" IN (${params.join(", ")})`);
  }
  if (valid.includes("NOT_SCORED")) {
    conds.push(`la."latestHardRuleAssessmentId" IS NULL`);
  }
  return conds.length > 0 ? `CASE WHEN (${conds.join(" OR ")}) THEN 0 ELSE 1 END,` : "";
}
function seniorityKeywordSql(keyword: string): string {
  const kw = keyword.trim();
  if (/^[a-z]{2,3}$/.test(kw)) {
    return `COALESCE(c."title", '') ~* '\\m${kw}\\M'`;
  }
  return `COALESCE(c."title", '') ILIKE '%${kw.replace(/'/g, "''")}%'`;
}

function seniorityTierSql(): string {
  const whens = SENIORITY_TAXONOMY.map((entry) => {
    const conds = entry.match.map(seniorityKeywordSql).join(" OR ");
    return `WHEN (${conds}) THEN '${entry.tier}'`;
  }).join(" ");
  return `(CASE ${whens} ELSE 'UNKNOWN' END)`;
}

function departmentSql(): string {
  const whens = SENIORITY_TAXONOMY.map((entry) => {
    const conds = entry.match.map(seniorityKeywordSql).join(" OR ");
    return `WHEN (${conds}) THEN '${entry.department}'`;
  }).join(" ");
  return `(CASE ${whens} ELSE 'UNKNOWN' END)`;
}

export async function queryContacts(
  organizationId: string,
  options: QueryContactsOptions = {}
): Promise<ContactsWorkspace> {
  const { prisma } = await import("@/lib/server/prisma");
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(200, options.pageSize ?? options.limit ?? 50));
  const offset = (page - 1) * pageSize;

  // Dynamic, param-indexed WHERE so filters compose (and the rows + count queries share
  // the same clause + params).
  const params: unknown[] = [organizationId];
  const clauses = [`c."organizationId" = $1`, `c."deletedAt" IS NULL`];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const addArrayConds = (values: string | string[] | undefined, mapFn: (val: string) => string) => {
    const arr = Array.isArray(values) ? values : (values ? [values] : []);
    const valid = arr.filter(v => v.trim());
    if (valid.length === 0) return null;
    return valid.map(mapFn);
  };

  if (options.title) {
    const conds = addArrayConds(options.title, t => `COALESCE(c."title", '') ILIKE ${add(`%${t.trim()}%`)}`);
    if (conds) clauses.push(`(${conds.join(" OR ")})`);
  }
  if (options.notTitle) {
    const conds = addArrayConds(options.notTitle, t => `COALESCE(c."title", '') ILIKE ${add(`%${t.trim()}%`)}`);
    if (conds) clauses.push(`NOT (${conds.join(" OR ")})`);
  }

  if (options.country) {
    const conds = addArrayConds(options.country, c => {
      const p = add(`%${c.trim()}%`);
      return `(COALESCE(c."country", '') ILIKE ${p} OR ${companyExists(`company."country" ILIKE ${p}`)})`;
    });
    if (conds) clauses.push(`(${conds.join(" OR ")})`);
  }
  if (options.notCountry) {
    const conds = addArrayConds(options.notCountry, c => {
      const p = add(`%${c.trim()}%`);
      return `(COALESCE(c."country", '') ILIKE ${p} OR ${companyExists(`company."country" ILIKE ${p}`)})`;
    });
    if (conds) clauses.push(`NOT (${conds.join(" OR ")})`);
  }

  if (options.company) {
    const conds = addArrayConds(options.company, c => `company."name" ILIKE ${add(`%${c.trim()}%`)}`);
    if (conds) clauses.push(companyExists(`(${conds.join(" OR ")})`));
  }
  if (options.notCompany) {
    const conds = addArrayConds(options.notCompany, c => `company."name" ILIKE ${add(`%${c.trim()}%`)}`);
    if (conds) clauses.push(`NOT ${companyExists(`(${conds.join(" OR ")})`)}`);
  }

  if (options.industry) {
    const conds = addArrayConds(options.industry, i => `company."industryCategory" ILIKE ${add(`%${i.trim()}%`)}`);
    if (conds) clauses.push(companyExists(`(${conds.join(" OR ")})`));
  }
  if (options.notIndustry) {
    const conds = addArrayConds(options.notIndustry, i => `company."industryCategory" ILIKE ${add(`%${i.trim()}%`)}`);
    if (conds) clauses.push(`NOT ${companyExists(`(${conds.join(" OR ")})`)}`);
  }

  if (options.department) {
    const conds = addArrayConds(options.department, d => add(d.trim().toUpperCase()));
    if (conds) clauses.push(`${departmentSql()} IN (${conds.join(", ")})`);
  }
  if (options.notDepartment) {
    const conds = addArrayConds(options.notDepartment, d => add(d.trim().toUpperCase()));
    if (conds) clauses.push(`${departmentSql()} NOT IN (${conds.join(", ")})`);
  }

  if (options.seniority) {
    const conds = addArrayConds(options.seniority, s => add(s.trim().toUpperCase()));
    if (conds) clauses.push(`${seniorityTierSql()} IN (${conds.join(", ")})`);
  }
  if (options.notSeniority) {
    const conds = addArrayConds(options.notSeniority, s => add(s.trim().toUpperCase()));
    if (conds) clauses.push(`${seniorityTierSql()} NOT IN (${conds.join(", ")})`);
  }

  // Presence facets (tri-state any/yes/no).
  if (options.hasEmail === "yes") clauses.push(identifierExists("EMAIL"));
  else if (options.hasEmail === "no") clauses.push(`NOT ${identifierExists("EMAIL")}`);
  if (options.hasPhone === "yes") clauses.push(identifierExists("PHONE"));
  else if (options.hasPhone === "no") clauses.push(`NOT ${identifierExists("PHONE")}`);
  if (options.hasLinkedin === "yes") clauses.push(identifierExists("LINKEDIN"));
  else if (options.hasLinkedin === "no") clauses.push(`NOT ${identifierExists("LINKEDIN")}`);

  // Context filters: a contact is "in an ICP" via an active LeadAssignment. Each is its
  // own EXISTS so include/exclude toggles independently (a contact can run many projects).
  if (options.icpVersionId) {
    const icps = Array.isArray(options.icpVersionId) ? options.icpVersionId : [options.icpVersionId];
    const valid = icps.filter(i => i.trim());
    if (valid.length > 0) {
      const params = valid.map(i => add(i.trim()));
      clauses.push(
        `EXISTS (SELECT 1 FROM "V2LeadAssignment" la
           WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
             AND la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
             AND la."icpVersionId" IN (${params.join(", ")}))`
      );
    }
  }
  if (options.notIcpVersionId) {
    const icps = Array.isArray(options.notIcpVersionId) ? options.notIcpVersionId : [options.notIcpVersionId];
    const valid = icps.filter(i => i.trim());
    if (valid.length > 0) {
      const params = valid.map(i => add(i.trim()));
      clauses.push(
        `NOT EXISTS (SELECT 1 FROM "V2LeadAssignment" la
           WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
             AND la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
             AND la."icpVersionId" IN (${params.join(", ")}))`
      );
    }
  }

  const pushQualClause = (qualsParam: string | string[] | undefined, isNot: boolean) => {
    if (!qualsParam) return;
    const quals = Array.isArray(qualsParam) ? qualsParam : [qualsParam];
    const valid = quals.filter(q => QUALIFICATION_VALUES.has(q));
    if (valid.length > 0) {
      const conds = [];
      const hasNotScored = valid.includes("NOT_SCORED");
      const realQuals = valid.filter(q => q !== "NOT_SCORED");

      if (realQuals.length > 0) {
        const params = realQuals.map(q => `${add(q)}::"V2Qualification"`);
        conds.push(`assessment."qualification" IN (${params.join(", ")})`);
      }
      if (hasNotScored) {
        conds.push(`la."latestHardRuleAssessmentId" IS NULL`);
      }

      const existsSql = `EXISTS (SELECT 1 FROM "V2LeadAssignment" la
           LEFT JOIN "V2HardRuleAssessment" assessment
             ON assessment."id" = la."latestHardRuleAssessmentId" AND assessment."organizationId" = la."organizationId"
           WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
             AND la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
             AND (${conds.join(" OR ")}))`;

      clauses.push(isNot ? `NOT ${existsSql}` : existsSql);
    }
  };

  pushQualClause(options.qualification, false);
  pushQualClause(options.notQualification, true);

  // Enrichment facet: contact has at least one lead whose company has an intelligence profile.
  if (options.hasEnrichment === "yes") clauses.push(
    `EXISTS (SELECT 1 FROM "V2LeadAssignment" la
      INNER JOIN "V2CompanyIntelligenceProfile" cip ON cip."companyId" = la."companyId" AND cip."organizationId" = la."organizationId"
        AND cip."profileStatus" IN ('EXTRACTED','PARTIAL')
      WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId" AND la."deletedAt" IS NULL)`
  );
  else if (options.hasEnrichment === "no") clauses.push(
    `NOT EXISTS (SELECT 1 FROM "V2LeadAssignment" la
      INNER JOIN "V2CompanyIntelligenceProfile" cip ON cip."companyId" = la."companyId" AND cip."organizationId" = la."organizationId"
        AND cip."profileStatus" IN ('EXTRACTED','PARTIAL')
      WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId" AND la."deletedAt" IS NULL)`
  );

  // Open review facet: contact or any of its leads have an open/in-progress review item.
  if (options.hasOpenReview === "yes") clauses.push(
    `EXISTS (SELECT 1 FROM "V2ManagerReviewItem" mri
      WHERE (mri."contactId" = c."id" OR mri."leadAssignmentId" IN (
        SELECT la2."id" FROM "V2LeadAssignment" la2 WHERE la2."contactId" = c."id" AND la2."organizationId" = c."organizationId" AND la2."deletedAt" IS NULL
      ))
      AND mri."organizationId" = c."organizationId" AND mri."status" IN ('OPEN','IN_PROGRESS') AND mri."deletedAt" IS NULL)`
  );
  else if (options.hasOpenReview === "no") clauses.push(
    `NOT EXISTS (SELECT 1 FROM "V2ManagerReviewItem" mri
      WHERE (mri."contactId" = c."id" OR mri."leadAssignmentId" IN (
        SELECT la2."id" FROM "V2LeadAssignment" la2 WHERE la2."contactId" = c."id" AND la2."organizationId" = c."organizationId" AND la2."deletedAt" IS NULL
      ))
      AND mri."organizationId" = c."organizationId" AND mri."status" IN ('OPEN','IN_PROGRESS') AND mri."deletedAt" IS NULL)`
  );

  // Owner filter: specific SDR or unassigned (empty string).
  if (options.ownerUserId !== undefined) {
    if (options.ownerUserId === "") {
      // Empty string = filter for unassigned leads
      clauses.push(
        `EXISTS (SELECT 1 FROM "V2LeadAssignment" la
          WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
          AND la."deletedAt" IS NULL AND la."ownerUserId" IS NULL)`
      );
    } else {
      clauses.push(
        `EXISTS (SELECT 1 FROM "V2LeadAssignment" la
          WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
          AND la."deletedAt" IS NULL AND la."ownerUserId" = ${add(options.ownerUserId)})`
      );
    }
  }

  const whereSql = clauses.join(" AND ");
  const qualificationDisplayOrderSql = buildQualificationDisplayOrderSql(options.qualification, add);

  const rows = await prisma.$queryRawUnsafe<ContactRow[]>(
    `SELECT c."id", c."fullName", c."title", c."city", c."status"::text AS "status",
       ${contactIdentifierColumns("c")},
       (SELECT company."name" FROM "V2LeadAssignment" la
          INNER JOIN "V2Company" company
            ON company."id" = la."companyId"
            AND company."organizationId" = la."organizationId"
            AND company."deletedAt" IS NULL
          WHERE la."contactId" = c."id"
            AND la."organizationId" = c."organizationId"
            AND la."deletedAt" IS NULL
          ORDER BY la."updatedAt" DESC
          LIMIT 1) AS "companyName",
       COALESCE(c."country", (SELECT company."country" FROM "V2LeadAssignment" la
          INNER JOIN "V2Company" company
            ON company."id" = la."companyId"
            AND company."organizationId" = la."organizationId"
            AND company."deletedAt" IS NULL
          WHERE la."contactId" = c."id"
            AND la."organizationId" = c."organizationId"
            AND la."deletedAt" IS NULL
          ORDER BY la."updatedAt" DESC
          LIMIT 1)) AS "country",
       ${contactSourceColumn("c")},
       (SELECT hra."confidence"::text FROM "V2LeadAssignment" la
          INNER JOIN "V2HardRuleAssessment" hra ON hra."id" = la."latestHardRuleAssessmentId"
          WHERE la."contactId" = c."id" AND la."deletedAt" IS NULL
          ORDER BY hra."confidence" DESC LIMIT 1) AS "confidenceBand",
       (SELECT assessment."qualification"::text FROM "V2LeadAssignment" la
          INNER JOIN "V2HardRuleAssessment" assessment ON assessment."id" = la."latestHardRuleAssessmentId"
          WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId" AND la."deletedAt" IS NULL
          ORDER BY ${qualificationDisplayOrderSql} la."updatedAt" DESC LIMIT 1) AS "qualification",
       (SELECT se."status"::text FROM "V2SequenceEnrollment" se
          WHERE se."contactId" = c."id"
          ORDER BY se."updatedAt" DESC LIMIT 1) AS "activityStatus",
       (SELECT oa."eventKind" FROM "V2OutreachActivity" oa
          WHERE oa."contactId" = c."id" AND oa."eventKind" LIKE '%meeting%'
          ORDER BY oa."occurredAt" DESC LIMIT 1) AS "meetingStatus",
       (SELECT mri."status"::text FROM "V2ManagerReviewItem" mri
          WHERE mri."organizationId" = c."organizationId" AND mri."deletedAt" IS NULL
            AND (mri."contactId" = c."id" OR mri."leadAssignmentId" IN (
              SELECT la3."id" FROM "V2LeadAssignment" la3
              WHERE la3."contactId" = c."id" AND la3."organizationId" = c."organizationId" AND la3."deletedAt" IS NULL
            ))
          ORDER BY mri."createdAt" DESC LIMIT 1) AS "managerReviewStatus",
       (SELECT COUNT(*)::int FROM "V2LeadAssignment" la
          WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId" AND la."deletedAt" IS NULL) AS "leadAssignmentCount",
       (SELECT la."id" FROM "V2LeadAssignment" la
          LEFT JOIN "V2HardRuleAssessment" assessment
            ON assessment."id" = la."latestHardRuleAssessmentId" AND assessment."organizationId" = la."organizationId"
          WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId" AND la."deletedAt" IS NULL
          ORDER BY ${qualificationDisplayOrderSql} la."updatedAt" DESC LIMIT 1) AS "primaryLeadAssignmentId",
       (SELECT owner."name" FROM "V2LeadAssignment" la
          LEFT JOIN "V2User" owner ON owner."id" = la."ownerUserId"
          WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId"
            AND la."deletedAt" IS NULL AND la."ownerUserId" IS NOT NULL
          ORDER BY la."updatedAt" DESC LIMIT 1) AS "ownerName",
       (SELECT COUNT(*)::int FROM "V2SequenceEnrollment" se
          WHERE se."contactId" = c."id" AND se."organizationId" = c."organizationId"
            AND se."status" = 'ACTIVE' AND se."deletedAt" IS NULL) AS "activeEnrollmentCount"
     FROM "V2Contact" c
     WHERE ${whereSql}
     ORDER BY c."updatedAt" DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    ...params
  );

  const totalRows = await prisma.$queryRawUnsafe<Array<{ total: number | bigint }>>(
    `SELECT COUNT(*)::int AS total FROM "V2Contact" c
     WHERE ${whereSql}`,
    ...params
  );
  const total = Number(totalRows[0]?.total ?? 0);

  const workspace = shapeContactsWorkspace(rows);
  return {
    ...workspace,
    facets: { ...workspace.facets, total },
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export type ContactLinkedLeadAssignment = {
  leadAssignmentId: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: LeadWorkspaceQualification;
  accountPreRank: LeadWorkspaceAccountPreRank | null;
  fitScore: number | null;
  confidenceScore: number | null;
  lastScoredAt: string | null;
  createdAt: string;
  reason: string | null;
  companySummary: string | null;
  factsJson: unknown;
};

export type ContactRecentActivity = {
  id: string;
  eventKind: string;
  channel: string;
  occurredAt: string;
  leadAssignmentId: string;
};

export type ContactEmploymentEntry = {
  id: string;
  companyId: string;
  companyName: string;
  title: string | null;
  isCurrent: boolean;
  startDate: string | null;
  endDate: string | null;
};

export type ContactDetail = {
  contact: ShapedContact;
  identifiers: Array<{
    id: string;
    type: string;
    normalizedValue: string;
    isGeneric: boolean;
    isValid: boolean;
    validityStatus: string;
  }>;
  linkedLeadAssignments: ContactLinkedLeadAssignment[];
  recentActivities: ContactRecentActivity[];
  employmentHistory: ContactEmploymentEntry[];
};

type ContactDetailRow = ContactRow & {
  companyName: string | null;
};

type ContactIdentifierRow = {
  id: string;
  type: string;
  normalizedValue: string;
  isGeneric: boolean;
  isValid: boolean;
  validityStatus: string;
};

type ContactLeadAssignmentRow = {
  leadAssignmentId: string;
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  projectName: string;
  icpProfileName: string;
  icpVersionNumber: number;
  workflowStatus: string;
  qualification: string | null;
  accountPreRank: string | null;
  fitScore: number | null;
  confidenceScore: number | null;
  lastScoredAt: Date | string | null;
  createdAt: Date | string;
  reason: string | null;
  companySummary: string | null;
  factsJson: unknown;
};

type ContactEmploymentRow = {
  id: string;
  companyId: string;
  companyName: string;
  title: string | null;
  isCurrent: boolean;
  startDate: Date | string | null;
  endDate: Date | string | null;
};

type ContactRecentActivityRow = {
  id: string;
  eventKind: string;
  channel: string;
  occurredAt: Date | string;
  leadAssignmentId: string;
};

export async function getContactDetail(
  organizationId: string,
  contactId: string
): Promise<ContactDetail | null> {
  const { prisma } = await import("@/lib/server/prisma");
  const [contactRows, identifierRows, leadRows, activityRows, employmentRows] = await Promise.all([
    prisma.$queryRawUnsafe<ContactDetailRow[]>(
      `SELECT c."id", c."fullName", c."title", c."city", c."status"::text AS "status",
         ${contactIdentifierColumns("c")},
         (SELECT company."name" FROM "V2LeadAssignment" la
            INNER JOIN "V2Company" company
              ON company."id" = la."companyId"
              AND company."organizationId" = la."organizationId"
            WHERE la."contactId" = c."id"
              AND la."organizationId" = c."organizationId"
              AND la."deletedAt" IS NULL
            ORDER BY la."updatedAt" DESC
            LIMIT 1) AS "companyName",
         COALESCE(c."country", (SELECT company."country" FROM "V2LeadAssignment" la
            INNER JOIN "V2Company" company
              ON company."id" = la."companyId"
              AND company."organizationId" = la."organizationId"
            WHERE la."contactId" = c."id"
              AND la."organizationId" = c."organizationId"
              AND la."deletedAt" IS NULL
            ORDER BY la."updatedAt" DESC
            LIMIT 1)) AS "country",
         ${contactSourceColumn("c")},
         (SELECT COUNT(*)::int FROM "V2LeadAssignment" la
            WHERE la."contactId" = c."id" AND la."organizationId" = c."organizationId" AND la."deletedAt" IS NULL) AS "leadAssignmentCount"
       FROM "V2Contact" c
       WHERE c."organizationId" = $1 AND c."deletedAt" IS NULL AND c."id" = $2
       LIMIT 1`,
      organizationId,
      contactId
    ),
    prisma.$queryRawUnsafe<ContactIdentifierRow[]>(
      `SELECT "id", "type"::text AS "type", "normalizedValue", "isGeneric", "isValid", "validityStatus"::text AS "validityStatus"
       FROM "V2ContactIdentifier"
       WHERE "organizationId" = $1 AND "contactId" = $2
       ORDER BY "type" ASC, "isValid" DESC, "createdAt" ASC
       LIMIT 20`,
      organizationId,
      contactId
    ),
    prisma.$queryRawUnsafe<ContactLeadAssignmentRow[]>(
      `SELECT
         la."id" AS "leadAssignmentId",
         company."id" AS "companyId",
         company."name" AS "companyName",
         company."canonicalDomain" AS "companyDomain",
         project."name" AS "projectName",
         profile."name" AS "icpProfileName",
         icp."versionNumber" AS "icpVersionNumber",
         la."workflowStatus"::text AS "workflowStatus",
         assessment."qualification"::text AS "qualification",
         assessment."accountPreRank"::text AS "accountPreRank",
         assessment."fitScore",
         assessment."confidence" AS "confidenceScore",
         assessment."createdAt" AS "lastScoredAt",
         la."createdAt",
         assessment."reason",
         (SELECT cip."companySummary" FROM "V2CompanyIntelligenceProfile" cip
            WHERE cip."companyId" = company."id" AND cip."organizationId" = la."organizationId"
              AND cip."profileStatus" IN ('EXTRACTED','PARTIAL')
            ORDER BY cip."createdAt" DESC LIMIT 1) AS "companySummary",
         (SELECT cip."factsJson" FROM "V2CompanyIntelligenceProfile" cip
            WHERE cip."companyId" = company."id" AND cip."organizationId" = la."organizationId"
              AND cip."profileStatus" IN ('EXTRACTED','PARTIAL')
            ORDER BY cip."createdAt" DESC LIMIT 1) AS "factsJson"
       FROM "V2LeadAssignment" la
       INNER JOIN "V2Company" company
         ON company."id" = la."companyId"
         AND company."organizationId" = la."organizationId"
       INNER JOIN "V2Project" project
         ON project."id" = la."projectId"
         AND project."organizationId" = la."organizationId"
       INNER JOIN "V2ICPVersion" icp
         ON icp."id" = la."icpVersionId"
         AND icp."organizationId" = la."organizationId"
       INNER JOIN "V2ICPProfile" profile
         ON profile."id" = icp."icpProfileId"
         AND profile."organizationId" = la."organizationId"
       LEFT JOIN "V2HardRuleAssessment" assessment
         ON assessment."id" = la."latestHardRuleAssessmentId"
         AND assessment."organizationId" = la."organizationId"
       WHERE la."organizationId" = $1
         AND la."contactId" = $2
         AND la."deletedAt" IS NULL
         AND la."status" = 'ACTIVE'
       ORDER BY COALESCE(assessment."createdAt", la."updatedAt") DESC, la."id" ASC
       LIMIT 50`,
      organizationId,
      contactId
    ),
    prisma.$queryRawUnsafe<ContactRecentActivityRow[]>(
      `SELECT "id", "eventKind", "channel", "occurredAt", "leadAssignmentId"
       FROM "V2OutreachActivity"
       WHERE "organizationId" = $1 AND "contactId" = $2
       ORDER BY "occurredAt" DESC, "id" ASC
       LIMIT 10`,
      organizationId,
      contactId
    ),
    prisma.$queryRawUnsafe<ContactEmploymentRow[]>(
      `SELECT e."id", e."companyId", company."name" AS "companyName", e."title", e."isCurrent", e."startDate", e."endDate"
       FROM "V2ContactEmployment" e
       INNER JOIN "V2Company" company ON company."id" = e."companyId" AND company."organizationId" = e."organizationId"
       WHERE e."organizationId" = $1 AND e."contactId" = $2
       ORDER BY e."isCurrent" DESC, e."startDate" DESC NULLS LAST
       LIMIT 20`,
      organizationId,
      contactId
    ),
  ]);

  const contact = contactRows[0];

  if (!contact) {
    return null;
  }

  return {
    contact: shapeContact(contact),
    identifiers: identifierRows,
    linkedLeadAssignments: leadRows.map(mapContactLeadAssignment),
    recentActivities: activityRows.map((row) => ({
      id: row.id,
      eventKind: row.eventKind,
      channel: row.channel,
      occurredAt: toIso(row.occurredAt),
      leadAssignmentId: row.leadAssignmentId,
    })),
    employmentHistory: employmentRows.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      companyName: row.companyName,
      title: row.title,
      isCurrent: row.isCurrent,
      startDate: toIsoOrNull(row.startDate),
      endDate: toIsoOrNull(row.endDate),
    })),
  };
}

function mapContactLeadAssignment(
  row: ContactLeadAssignmentRow
): ContactLinkedLeadAssignment {
  return {
    leadAssignmentId: row.leadAssignmentId,
    companyId: row.companyId,
    companyName: row.companyName,
    companyDomain: row.companyDomain,
    projectName: row.projectName,
    icpProfileName: row.icpProfileName,
    icpVersionNumber: Number(row.icpVersionNumber),
    workflowStatus: row.workflowStatus,
    qualification: normalizeQualification(row.qualification),
    accountPreRank: normalizeAccountPreRank(row.accountPreRank),
    fitScore: row.fitScore === null ? null : Number(row.fitScore),
    confidenceScore:
      row.confidenceScore === null ? null : Number(row.confidenceScore),
    lastScoredAt: toIsoOrNull(row.lastScoredAt),
    createdAt: toIso(row.createdAt),
    reason: row.reason ?? null,
    companySummary: row.companySummary ?? null,
    factsJson: row.factsJson ?? null,
  };
}

function normalizeQualification(
  value: string | null
): LeadWorkspaceQualification {
  if (
    value === "QUALIFIED" ||
    value === "COMPANY_QUALIFIED_NEEDS_CONTACT" ||
    value === "NEEDS_REVIEW" ||
    value === "UNQUALIFIED" ||
    value === "NOT_SCORED"
  ) {
    return value;
  }

  return "NOT_SCORED";
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

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null) {
  return value === null ? null : toIso(value);
}
