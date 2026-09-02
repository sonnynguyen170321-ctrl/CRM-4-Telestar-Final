import "server-only";

import { prisma } from "@/lib/server/prisma";

// M1 read model: lead queues filtered by ownership. Backs "My leads"
// (ownerUserId = session user), "Unassigned" (managers route these), and "Team"
// (all owned). Tenant-scoped from the session orgId (Invariant 5); soft-delete
// respected (Invariant 8). Ownership is surfaced alongside — never merged into —
// workflowStatus/qualification (Invariant 3).

export type AssignedLead = {
  leadAssignmentId: string;
  companyName: string | null;
  contactName: string | null;
  workflowStatus: string;
  qualification: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  assignedAt: string | null;
};

export type AssignedLeadsFilter = {
  // "mine": ownerUserId must equal `ownerUserId`. "unassigned": ownerUserId IS NULL.
  // "all": no ownership filter (team view).
  scope: "mine" | "unassigned" | "all";
  ownerUserId?: string | null;
  limit?: number;
};

type Row = {
  lead_id: string;
  company_name: string | null;
  contact_name: string | null;
  workflow_status: string;
  qualification: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  assigned_at: Date | null;
};

export async function queryAssignedLeads(
  organizationId: string,
  filter: AssignedLeadsFilter
): Promise<AssignedLead[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

  // Build the ownership predicate from a trusted scope, never from raw client input.
  let ownerClause = "";
  const args: unknown[] = [organizationId];
  if (filter.scope === "mine") {
    if (!filter.ownerUserId) return [];
    args.push(filter.ownerUserId);
    ownerClause = `AND la."ownerUserId" = $${args.length}`;
  } else if (filter.scope === "unassigned") {
    ownerClause = `AND la."ownerUserId" IS NULL`;
  }
  args.push(limit);
  const limitParam = `$${args.length}`;

  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT
       la."id" AS lead_id,
       comp."name" AS company_name,
       c."fullName" AS contact_name,
       la."workflowStatus"::text AS workflow_status,
       hra."qualification"::text AS qualification,
       la."ownerUserId" AS owner_user_id,
       owner."name" AS owner_name,
       la."assignedAt" AS assigned_at
     FROM "V2LeadAssignment" la
     LEFT JOIN "V2Company" comp ON comp."id" = la."companyId" AND comp."deletedAt" IS NULL
     LEFT JOIN "V2Contact" c ON c."id" = la."contactId" AND c."deletedAt" IS NULL
     LEFT JOIN "V2User" owner ON owner."id" = la."ownerUserId"
     LEFT JOIN "V2HardRuleAssessment" hra ON hra."id" = la."latestHardRuleAssessmentId"
     WHERE la."organizationId" = $1 AND la."deletedAt" IS NULL AND la."status" = 'ACTIVE'
       ${ownerClause}
     ORDER BY la."assignedAt" DESC NULLS LAST, la."updatedAt" DESC
     LIMIT ${limitParam}`,
    ...args
  );

  return rows.map((r) => ({
    leadAssignmentId: r.lead_id,
    companyName: r.company_name,
    contactName: r.contact_name,
    workflowStatus: r.workflow_status,
    qualification: r.qualification,
    ownerUserId: r.owner_user_id,
    ownerName: r.owner_name,
    assignedAt: r.assigned_at ? new Date(r.assigned_at).toISOString() : null,
  }));
}

// Assignable members for the assign control (managers pick an SDR). Tenant-scoped.
export type AssignableMember = { userId: string; name: string | null; email: string; role: string };

export async function queryAssignableMembers(organizationId: string): Promise<AssignableMember[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ user_id: string; name: string | null; email: string; role: string }>>(
    `SELECT u."id" AS user_id, u."name", u."email", m."role"::text AS role
       FROM "V2OrganizationMembership" m
       INNER JOIN "V2User" u ON u."id" = m."userId" AND u."status" = 'ACTIVE'
      WHERE m."organizationId" = $1 AND m."status" = 'ACTIVE'
      ORDER BY u."name" ASC NULLS LAST, u."email" ASC`,
    organizationId
  );
  return rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role }));
}
