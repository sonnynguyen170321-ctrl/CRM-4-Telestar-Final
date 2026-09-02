import { lookupSeniority } from "../scoring/rules/dictionaries/seniority";

export type ContactEnrichmentSource = {
  fullName: string;
  title: string | null;
  city?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
  linkedInUrl?: string | null;
  source?: string | null;
  emailValidityStatus?: string | null;
  emailIsGeneric?: boolean | null;
  emailSource?: string | null;
  phoneValidityStatus?: string | null;
  phoneSource?: string | null;
};

export type ContactEnrichment = {
  fullName: string;
  title: string | null;
  city: string | null;
  country: string | null;
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
};

export function shapeContactEnrichment(row: ContactEnrichmentSource): ContactEnrichment {
  const seniority = lookupSeniority(row.title ?? "");

  return {
    fullName: row.fullName,
    title: row.title ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    linkedInUrl: row.linkedInUrl ?? null,
    source: row.source ?? null,
    seniorityTier: seniority.tier,
    department: seniority.department,
    hasUsableEmail: Boolean(row.email) && row.emailValidityStatus === "VALID" && !row.emailIsGeneric,
    emailValidityStatus: row.emailValidityStatus ?? null,
    emailIsGeneric: Boolean(row.emailIsGeneric),
    emailSource: row.emailSource ?? null,
    phoneValidityStatus: row.phoneValidityStatus ?? null,
    phoneSource: row.phoneSource ?? null,
  };
}

export function contactIdentifierColumns(alias = "c"): string {
  return `
    (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "email",
    (SELECT ci."validityStatus"::text FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "emailValidityStatus",
    (SELECT ci."isGeneric" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "emailIsGeneric",
    (SELECT ci."source" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "emailSource",
    (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'PHONE' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "phone",
    (SELECT ci."validityStatus"::text FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'PHONE' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "phoneValidityStatus",
    (SELECT ci."source" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'PHONE' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "phoneSource",
    (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'LINKEDIN' AND ci."isValid" = true
       ORDER BY ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "linkedInUrl",
    (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'LINKEDIN'
       ORDER BY ci."isValid" DESC, ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "linkedInAny",
    (SELECT ci."validityStatus"::text FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."type" = 'LINKEDIN'
       ORDER BY ci."isValid" DESC, ci."createdAt" ASC, ci."id" ASC LIMIT 1) AS "linkedInValidity"
  `;
}

export function contactSourceColumn(alias = "c"): string {
  return `
    (SELECT ci."source" FROM "V2ContactIdentifier" ci
       WHERE ci."organizationId" = ${alias}."organizationId"
         AND ci."contactId" = ${alias}."id" AND ci."source" IS NOT NULL
       ORDER BY ci."createdAt" DESC, ci."id" ASC LIMIT 1) AS "source"
  `;
}
