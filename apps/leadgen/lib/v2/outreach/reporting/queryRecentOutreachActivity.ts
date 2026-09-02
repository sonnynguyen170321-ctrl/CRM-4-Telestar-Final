import "server-only";

// Read-only recent outreach activity feed for the /v2/outreach Monitor.
// Tenant-scoped; joins company/contact for display. No open/click (B15) — only
// real persisted V2OutreachActivity events (sent/replied/bounced/...).

export type RecentOutreachActivity = {
  id: string;
  eventKind: string;
  channel: string;
  occurredAt: string;
  leadAssignmentId: string;
  companyName: string | null;
  contactName: string | null;
};

export async function queryRecentOutreachActivity(
  organizationId: string,
  limit = 25
): Promise<RecentOutreachActivity[]> {
  const { prisma } = await import("@/lib/server/prisma");
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 100);

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      eventKind: string;
      channel: string;
      occurredAt: Date | string;
      leadAssignmentId: string;
      companyName: string | null;
      contactName: string | null;
    }>
  >(
    `
      SELECT
        a."id",
        a."eventKind",
        a."channel",
        a."occurredAt",
        a."leadAssignmentId",
        c."name" AS "companyName",
        ct."fullName" AS "contactName"
      FROM "V2OutreachActivity" a
      LEFT JOIN "V2Company" c
        ON c."id" = a."companyId" AND c."organizationId" = a."organizationId"
      LEFT JOIN "V2Contact" ct
        ON ct."id" = a."contactId" AND ct."organizationId" = a."organizationId"
      WHERE a."organizationId" = $1
      ORDER BY a."occurredAt" DESC
      LIMIT ${safeLimit}
    `,
    organizationId
  );

  return rows.map((row) => ({
    id: row.id,
    eventKind: row.eventKind,
    channel: row.channel,
    occurredAt: new Date(row.occurredAt).toISOString(),
    leadAssignmentId: row.leadAssignmentId,
    companyName: row.companyName,
    contactName: row.contactName,
  }));
}
