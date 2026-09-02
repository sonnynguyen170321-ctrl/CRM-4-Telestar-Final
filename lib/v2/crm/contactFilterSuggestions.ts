import "server-only";
import { withFacetCache } from "@/lib/v2/bullmq/facetCache";
import { queryAssignableMembers, type AssignableMember } from "./queryAssignedLeads";

// Contacts filter-panel autocomplete: distinct companies, industries, countries, and
// assignable owners for the logged-in org. Cached via withFacetCache (5 min TTL) so
// the filter sidebar doesn't re-query on every render. Tenant-scoped (Invariant 5),
// soft-delete respected (Invariant 8).

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

function fmt(value: string): string {
  return value.split(/[_\s]+/).map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p)).join(" ");
}

export type ContactFilterSuggestions = {
  companies: Array<{ id: string; name: string; count: number }>;
  industries: Array<{ id: string; label: string; count: number }>;
  countries: Array<{ id: string; label: string; count: number }>;
  owners: Array<{ userId: string; name: string | null; email: string; role: string }>;
  titles: Array<{ label: string; count: number }>;
};

export async function queryContactFilterSuggestions(
  organizationId: string
): Promise<ContactFilterSuggestions> {
  const [cached, owners] = await Promise.all([
    queryCachedContactFilterSuggestions(organizationId),
    queryAssignableMembers(organizationId),
  ]);

  return {
    ...cached,
    owners: owners.map((o: AssignableMember) => ({
      userId: o.userId,
      name: o.name,
      email: o.email,
      role: o.role,
    })),
  };
}

async function queryCachedContactFilterSuggestions(
  organizationId: string
): Promise<Omit<ContactFilterSuggestions, "owners">> {
  const cacheKey = `v2:org:${organizationId}:facets:contacts:filters`;

  return withFacetCache(cacheKey, async () => {
    const { prisma } = await import("@/lib/server/prisma");

    const [companyRows, industryRows, countryRows, titleRows] = await Promise.all([
      prisma.$queryRawUnsafe<Array<{ id: string; name: string; n: number | bigint }>>(
        `SELECT company."id", company."name", COUNT(la."id")::int AS n
         FROM "V2LeadAssignment" la
         INNER JOIN "V2Company" company
           ON company."id" = la."companyId"
           AND company."organizationId" = la."organizationId"
           AND company."deletedAt" IS NULL
         WHERE la."organizationId" = $1
           AND la."deletedAt" IS NULL
         GROUP BY company."id", company."name"
         ORDER BY n DESC, company."name" ASC
         LIMIT 50`,
        organizationId
      ),
      prisma.$queryRawUnsafe<Array<{ id: string; n: number | bigint }>>(
        `SELECT "industryCategory" AS id, COUNT(*)::int AS n
         FROM "V2Company"
         WHERE "organizationId" = $1 AND "deletedAt" IS NULL
           AND "industryCategory" IS NOT NULL AND btrim("industryCategory") <> ''
         GROUP BY "industryCategory"
         ORDER BY n DESC, id ASC
         LIMIT 30`,
        organizationId
      ),
      prisma.$queryRawUnsafe<Array<{ country: string; n: number | bigint }>>(
        `SELECT COALESCE(c."country", '') AS country, COUNT(*)::int AS n
         FROM "V2Contact" c
         WHERE c."organizationId" = $1 AND c."deletedAt" IS NULL
           AND c."country" IS NOT NULL AND btrim(c."country") <> ''
         GROUP BY c."country"
         ORDER BY n DESC, country ASC
         LIMIT 30`,
        organizationId
      ),
      prisma.$queryRawUnsafe<Array<{ title: string; n: number | bigint }>>(
        `SELECT c."title", COUNT(*)::int AS n
         FROM "V2Contact" c
         WHERE c."organizationId" = $1 AND c."deletedAt" IS NULL
           AND c."title" IS NOT NULL AND btrim(c."title") <> ''
         GROUP BY c."title"
         ORDER BY n DESC, c."title" ASC
         LIMIT 30`,
        organizationId
      ),
    ]);

    return {
      companies: companyRows.map((row) => ({
        id: row.id,
        name: row.name,
        count: Number(row.n),
      })),
      industries: industryRows.map((row) => ({
        id: row.id,
        label: INDUSTRY_LABEL[row.id] ?? fmt(row.id),
        count: Number(row.n),
      })),
      countries: countryRows.map((row) => ({
        id: row.country,
        label: row.country,
        count: Number(row.n),
      })),
      titles: titleRows.map((row) => ({
        label: row.title,
        count: Number(row.n),
      })),
    };
  });
}
