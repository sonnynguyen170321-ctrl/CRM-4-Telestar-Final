import "server-only";
import { withFacetCache } from "@/lib/v2/bullmq/facetCache";

// P3: tenant-scoped aggregates for the /v2/companies premium sidebar — company
// "health" mix, top industries, top countries, and a recent-activity feed. All from
// real persisted rows (Invariant 5/8). "Health" is enrichment/data quality derived
// from research + profile status — NOT an ICP qualification (Invariant 2). Industries
// come from the denormalized V2Company.industryCategory (written by enrichment).

export type CompanyHealthBucket = "HEALTHY" | "WARNING" | "NEEDS_ATTENTION" | "UNKNOWN";

export type CompanyDirectoryAggregates = {
  total: number;
  health: Array<{ bucket: CompanyHealthBucket; count: number }>;
  industries: Array<{ id: string; label: string; count: number }>;
  countries: Array<{ country: string; count: number }>;
  recentActivity: Array<{ companyName: string; kind: CompanyActivityKind; occurredAt: string }>;
};

export type CompanyActivityKind = "enriched" | "lead_created" | "researched";

const HEALTH_ORDER: CompanyHealthBucket[] = ["HEALTHY", "WARNING", "NEEDS_ATTENTION", "UNKNOWN"];

const INDUSTRY_LABEL: Record<string, string> = {
  logistics: "Logistics",
  ecommerce_saas: "Ecommerce SaaS",
  customer_intel: "Customer Intelligence",
  crm_martech: "CRM / Martech",
  data_analytics: "Data / Analytics",
  ai_automation: "AI / Automation",
  cybersecurity: "Cybersecurity",
  hr_recruiting: "HR / Recruiting",
  fintech: "Fintech",
  manufacturing: "Manufacturing",
  agency: "Agency / Services",
  education: "Education",
  healthtech: "Healthtech",
  b2b_saas: "B2B SaaS",
};

export async function queryCompanyDirectoryAggregates(
  organizationId: string
): Promise<CompanyDirectoryAggregates> {
  const cacheKey = `v2:org:${organizationId}:facets:companies`;

  return withFacetCache(cacheKey, async () => {
    const { prisma } = await import("@/lib/server/prisma");

  const [healthRows, industryRows, countryRows, activityRows] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ bucket: string; n: number | bigint }>>(
      `
        WITH lp AS (
          SELECT DISTINCT ON ("companyId") "companyId", "profileStatus"::text AS ps
          FROM "V2CompanyIntelligenceProfile"
          WHERE "organizationId" = $1
          ORDER BY "companyId", "createdAt" DESC, "researchVersion" DESC, "id" DESC
        ),
        ls AS (
          SELECT DISTINCT ON ("companyId") "companyId", "status"::text AS rs
          FROM "V2CompanyResearchSnapshot"
          WHERE "organizationId" = $1
          ORDER BY "companyId", "createdAt" DESC, "researchVersion" DESC, "id" DESC
        )
        SELECT bucket, COUNT(*)::int AS n FROM (
          SELECT
            CASE
              WHEN lp.ps = 'EXTRACTED' THEN 'HEALTHY'
              WHEN lp.ps = 'PARTIAL' OR ls.rs IN ('JS_RENDER_REQUIRED','PARKED') THEN 'WARNING'
              WHEN lp.ps = 'FAILED' OR ls.rs IN ('BLOCKED','TIMEOUT','INVALID_URL','OFFLINE','NO_WEBSITE') THEN 'NEEDS_ATTENTION'
              ELSE 'UNKNOWN'
            END AS bucket
          FROM "V2Company" c
          LEFT JOIN lp ON lp."companyId" = c."id"
          LEFT JOIN ls ON ls."companyId" = c."id"
          WHERE c."organizationId" = $1 AND c."status" = 'ACTIVE' AND c."deletedAt" IS NULL
        ) x
        GROUP BY bucket
      `,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ id: string; n: number | bigint }>>(
      `
        SELECT "industryCategory" AS id, COUNT(*)::int AS n
        FROM "V2Company"
        WHERE "organizationId" = $1 AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
          AND "industryCategory" IS NOT NULL AND btrim("industryCategory") <> ''
        GROUP BY "industryCategory"
        ORDER BY n DESC, id ASC
        LIMIT 6
      `,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ country: string; n: number | bigint }>>(
      `
        SELECT "country", COUNT(*)::int AS n
        FROM "V2Company"
        WHERE "organizationId" = $1 AND "status" = 'ACTIVE' AND "deletedAt" IS NULL
          AND "country" IS NOT NULL AND btrim("country") <> ''
        GROUP BY "country"
        ORDER BY n DESC, "country" ASC
        LIMIT 6
      `,
      organizationId
    ),
    prisma.$queryRawUnsafe<Array<{ companyName: string; kind: string; occurredAt: Date | string }>>(
      `
        SELECT "companyName", kind, "occurredAt" FROM (
          SELECT c."name" AS "companyName", 'enriched' AS kind, p."createdAt" AS "occurredAt"
          FROM "V2CompanyIntelligenceProfile" p
          INNER JOIN "V2Company" c ON c."id" = p."companyId" AND c."organizationId" = p."organizationId"
          WHERE p."organizationId" = $1 AND c."deletedAt" IS NULL
          UNION ALL
          SELECT c."name", 'lead_created', la."createdAt"
          FROM "V2LeadAssignment" la
          INNER JOIN "V2Company" c ON c."id" = la."companyId" AND c."organizationId" = la."organizationId"
          WHERE la."organizationId" = $1 AND la."deletedAt" IS NULL AND c."deletedAt" IS NULL
          UNION ALL
          SELECT c."name", 'researched', s."createdAt"
          FROM "V2CompanyResearchSnapshot" s
          INNER JOIN "V2Company" c ON c."id" = s."companyId" AND c."organizationId" = s."organizationId"
          WHERE s."organizationId" = $1 AND c."deletedAt" IS NULL
        ) u
        ORDER BY "occurredAt" DESC
        LIMIT 8
      `,
      organizationId
    ),
  ]);

  const healthMap = new Map<string, number>();
  for (const row of healthRows) healthMap.set(row.bucket, Number(row.n));
  const health = HEALTH_ORDER.map((bucket) => ({ bucket, count: healthMap.get(bucket) ?? 0 }));
  const total = health.reduce((sum, h) => sum + h.count, 0);

  return {
    total,
    health,
    industries: industryRows.map((row) => ({
      id: row.id,
      label: INDUSTRY_LABEL[row.id] ?? fmt(row.id),
      count: Number(row.n),
    })),
    countries: countryRows.map((row) => ({ country: row.country, count: Number(row.n) })),
    recentActivity: activityRows.map((row) => ({
      companyName: row.companyName,
      kind: row.kind as CompanyActivityKind,
      occurredAt: typeof row.occurredAt === "string" ? row.occurredAt : row.occurredAt.toISOString(),
    })),
  };
  });
}

function normalizeKind(value: string): CompanyActivityKind {
  return value === "enriched" || value === "lead_created" || value === "researched" ? value : "researched";
}

function fmt(value: string): string {
  return value.split(/[_\s]+/).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
}
