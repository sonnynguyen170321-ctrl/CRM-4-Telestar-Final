import "server-only";

import { prisma } from "@/lib/server/prisma";

// Per-lead enrollment read-model for the campaign leads manager. One row per active
// (non-deleted) V2SequenceEnrollment in a campaign, joined to the lead's contact + company
// for display, plus the lead's last message status and reply count. Tenant-scoped (Inv 5),
// deletedAt-filtered everywhere (Inv 8).

export const ENROLLMENT_STATUSES = ["ACTIVE", "PAUSED", "COMPLETED", "HALTED"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];

export type CampaignEnrollmentRow = {
  id: string;
  leadAssignmentId: string;
  contactName: string | null;
  companyName: string | null;
  email: string | null;
  status: string;
  currentStepOrdinal: number;
  nextStepAt: string | null;
  lastMessageStatus: string | null;
  lastSentAt: string | null;
  replyCount: number;
  enrolledAt: string;
};

export type CampaignEnrollmentsResult = {
  rows: CampaignEnrollmentRow[];
  total: number;
  facets: Record<EnrollmentStatus, number>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type Options = { search?: string; status?: string; page?: number; pageSize?: number };

type RawRow = {
  id: string;
  leadAssignmentId: string;
  contactName: string | null;
  companyName: string | null;
  email: string | null;
  status: string;
  currentStepOrdinal: number;
  nextStepAt: Date | string | null;
  lastMessageStatus: string | null;
  lastSentAt: Date | string | null;
  replyCount: number | bigint;
  enrolledAt: Date | string;
};

export async function queryCampaignEnrollments(
  organizationId: string,
  campaignId: string,
  options: Options = {}
): Promise<CampaignEnrollmentsResult> {
  const page = Math.max(1, Math.trunc(options.page ?? 1));
  const pageSize = Math.max(1, Math.min(200, options.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const params: unknown[] = [organizationId, campaignId];
  // la filters live in the shared WHERE (not the JOINs) so the rows query (INNER JOIN la)
  // and the count query (LEFT JOIN la) stay in lock-step — otherwise a soft-deleted lead
  // would drop from the list but still inflate the count. Inv 8: soft-delete respected.
  const clauses = [
    `e."organizationId" = $1`,
    `e."sequenceId" = $2`,
    `e."deletedAt" IS NULL`,
    `la."deletedAt" IS NULL`,
    `la."status" = 'ACTIVE'`,
  ];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  if (options.status && (ENROLLMENT_STATUSES as readonly string[]).includes(options.status)) {
    clauses.push(`e."status" = ${add(options.status)}::"V2EnrollmentStatus"`);
  }
  if (options.search && options.search.trim()) {
    const p = add(`%${options.search.trim()}%`);
    clauses.push(`(
      ct."fullName" ILIKE ${p}
      OR e."recipientEmailSnapshot" ILIKE ${p}
      OR c."name" ILIKE ${p}
    )`);
  }
  const whereSql = clauses.join(" AND ");

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(
    `SELECT
       e."id",
       e."leadAssignmentId",
       ct."fullName" AS "contactName",
       c."name" AS "companyName",
       e."recipientEmailSnapshot" AS "email",
       e."status"::text AS "status",
       e."currentStepOrdinal",
       e."nextStepAt",
       e."createdAt" AS "enrolledAt",
       last_msg."status"::text AS "lastMessageStatus",
       last_msg."sentAt" AS "lastSentAt",
       (SELECT COUNT(*)::int FROM "V2OutreachActivity" a
          WHERE a."organizationId" = e."organizationId"
            AND a."leadAssignmentId" = e."leadAssignmentId"
            AND a."eventKind" = 'outreach.replied') AS "replyCount"
     FROM "V2SequenceEnrollment" e
     INNER JOIN "V2LeadAssignment" la
       ON la."id" = e."leadAssignmentId" AND la."organizationId" = e."organizationId"
     LEFT JOIN "V2Contact" ct
       ON ct."id" = e."contactId" AND ct."organizationId" = e."organizationId"
       AND ct."status" = 'ACTIVE' AND ct."deletedAt" IS NULL
     LEFT JOIN "V2Company" c
       ON c."id" = la."companyId" AND c."organizationId" = la."organizationId"
       AND c."status" = 'ACTIVE' AND c."deletedAt" IS NULL
     LEFT JOIN LATERAL (
       SELECT m."status", m."sentAt"
       FROM "V2OutreachMessage" m
       WHERE m."enrollmentId" = e."id" AND m."organizationId" = e."organizationId" AND m."deletedAt" IS NULL
       ORDER BY m."createdAt" DESC
       LIMIT 1
     ) last_msg ON true
     WHERE ${whereSql}
     ORDER BY e."updatedAt" DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    ...params
  );

  const [{ total } = { total: 0 }] = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
    `SELECT COUNT(*)::int AS total
     FROM "V2SequenceEnrollment" e
     LEFT JOIN "V2Contact" ct ON ct."id" = e."contactId" AND ct."organizationId" = e."organizationId"
     LEFT JOIN "V2LeadAssignment" la ON la."id" = e."leadAssignmentId" AND la."organizationId" = e."organizationId"
     LEFT JOIN "V2Company" c ON c."id" = la."companyId" AND c."organizationId" = la."organizationId"
     WHERE ${whereSql}`,
    ...params
  );

  const facetRows = await prisma.$queryRawUnsafe<Array<{ status: string; count: number }>>(
    // Join la with the same filter as the rows/count queries so the status-tab badges
    // don't overcount enrollments whose lead was archived or soft-deleted.
    `SELECT e."status"::text AS "status", COUNT(*)::int AS "count"
     FROM "V2SequenceEnrollment" e
     INNER JOIN "V2LeadAssignment" la
       ON la."id" = e."leadAssignmentId" AND la."organizationId" = e."organizationId"
      AND la."status" = 'ACTIVE' AND la."deletedAt" IS NULL
     WHERE e."organizationId" = $1 AND e."sequenceId" = $2 AND e."deletedAt" IS NULL
     GROUP BY e."status"`,
    organizationId,
    campaignId
  );
  const facets = { ACTIVE: 0, PAUSED: 0, COMPLETED: 0, HALTED: 0 } as Record<EnrollmentStatus, number>;
  for (const row of facetRows) {
    if (row.status in facets) facets[row.status as EnrollmentStatus] = Number(row.count);
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      leadAssignmentId: row.leadAssignmentId,
      contactName: row.contactName,
      companyName: row.companyName,
      email: row.email,
      status: row.status,
      currentStepOrdinal: Number(row.currentStepOrdinal),
      nextStepAt: toIso(row.nextStepAt),
      lastMessageStatus: row.lastMessageStatus,
      lastSentAt: toIso(row.lastSentAt),
      replyCount: Number(row.replyCount),
      enrolledAt: toIso(row.enrolledAt) ?? new Date(0).toISOString(),
    })),
    total: Number(total),
    facets,
    pagination: {
      page,
      pageSize,
      total: Number(total),
      totalPages: Math.max(1, Math.ceil(Number(total) / pageSize)),
    },
  };
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
