import "server-only";

import { shapeContact, type ShapedContact } from "@/lib/v2/crm/shapeContacts";

// P2: read models for the company drawer's Contacts + Activity tabs. Tenant-scoped,
// soft-delete respected (Invariant 8). Contacts are reached the only legitimate way —
// through this company's active LeadAssignments (Invariant 2: the unit is the
// assignment, there is no global contact->company link). Activity is every outreach
// event tied to any of the company's leads. Real persisted rows only.

export type CompanyContact = ShapedContact;

export type CompanyActivity = {
  id: string;
  eventKind: string;
  channel: string;
  occurredAt: string;
  leadAssignmentId: string;
  contactName: string | null;
};

export async function queryCompanyContacts(
  organizationId: string,
  companyId: string,
  limit = 100
): Promise<CompanyContact[]> {
  const { prisma } = await import("@/lib/server/prisma");
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 500);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      fullName: string;
      title: string | null;
      status: string;
      email: string | null;
      leadAssignmentCount: number | bigint;
    }>
  >(
    `
      SELECT DISTINCT ON (c."id")
        c."id", c."fullName", c."title", c."status"::text AS "status",
        (SELECT ci."normalizedValue" FROM "V2ContactIdentifier" ci
           WHERE ci."contactId" = c."id" AND ci."type" = 'EMAIL' AND ci."isValid" = true
           ORDER BY ci."createdAt" ASC LIMIT 1) AS "email",
        (SELECT COUNT(*)::int FROM "V2LeadAssignment" la2
           WHERE la2."contactId" = c."id" AND la2."companyId" = $2
             AND la2."organizationId" = c."organizationId" AND la2."deletedAt" IS NULL) AS "leadAssignmentCount"
      FROM "V2Contact" c
      INNER JOIN "V2LeadAssignment" la
        ON la."contactId" = c."id"
        AND la."organizationId" = c."organizationId"
      WHERE c."organizationId" = $1
        AND c."deletedAt" IS NULL
        AND la."companyId" = $2
        AND la."deletedAt" IS NULL
        AND la."status" = 'ACTIVE'
      ORDER BY c."id", c."updatedAt" DESC
      LIMIT ${safeLimit}
    `,
    organizationId,
    companyId
  );

  return rows.map((row) =>
    shapeContact({
      id: row.id,
      fullName: row.fullName,
      title: row.title,
      status: row.status,
      email: row.email,
      leadAssignmentCount: Number(row.leadAssignmentCount),
    })
  );
}

export async function queryCompanyActivity(
  organizationId: string,
  companyId: string,
  limit = 40
): Promise<CompanyActivity[]> {
  const { prisma } = await import("@/lib/server/prisma");
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 100);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      eventKind: string;
      channel: string;
      occurredAt: Date | string;
      leadAssignmentId: string;
      contactName: string | null;
    }>
  >(
    `
      SELECT
        a."id", a."eventKind", a."channel", a."occurredAt", a."leadAssignmentId",
        ct."fullName" AS "contactName"
      FROM "V2OutreachActivity" a
      LEFT JOIN "V2Contact" ct
        ON ct."id" = a."contactId" AND ct."organizationId" = a."organizationId"
      WHERE a."organizationId" = $1
        AND a."leadAssignmentId" IN (
          SELECT la."id" FROM "V2LeadAssignment" la
          WHERE la."organizationId" = $1 AND la."companyId" = $2 AND la."deletedAt" IS NULL
        )
      ORDER BY a."occurredAt" DESC
      LIMIT ${safeLimit}
    `,
    organizationId,
    companyId
  );

  return rows.map((row) => ({
    id: row.id,
    eventKind: row.eventKind,
    channel: row.channel,
    occurredAt: new Date(row.occurredAt).toISOString(),
    leadAssignmentId: row.leadAssignmentId,
    contactName: row.contactName,
  }));
}
