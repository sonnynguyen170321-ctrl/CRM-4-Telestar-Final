import "server-only";

import { prisma } from "@/lib/server/prisma";

// Read-models for the premium activity-recap wizard. Both the "Recap Summary by SDR"
// table and the "Standardized Activity" table are derived from the uploaded job's
// V2IngestionRow rows (rawRowJson is keyed by normalized headers: "SDR Name" -> sdr_name,
// "Activity Date" -> activity_date, etc. — see lib/v2/ingestion/hash.ts). Every query is
// scoped by organizationId (tenant isolation, invariant #5). V2IngestionRow has no
// deletedAt column, so soft-delete (invariant #8) does not apply at this layer; the
// downstream lead/contact/company joins it depends on already filter deletedAt.

export type RecapSummaryRow = {
  sdr: string;
  emails: number;
  linkedin: number;
  calls: number;
  whatsapp: number;
  meetings: number;
  flagged: number;
  total: number;
};

export type RecapSummary = {
  rows: RecapSummaryRow[];
  totals: Omit<RecapSummaryRow, "sdr">;
  sdrCount: number;
};

type RecapSummaryQueryRow = {
  sdr: string;
  emails: bigint;
  linkedin: bigint;
  calls: bigint;
  whatsapp: bigint;
  meetings: bigint;
  flagged: bigint;
  total: bigint;
};

export async function queryRecapSummary(
  organizationId: string,
  ingestionJobId: string
): Promise<RecapSummary> {
  const rows = await prisma.$queryRaw<RecapSummaryQueryRow[]>`
    WITH base AS (
      SELECT
        NULLIF(TRIM(COALESCE(
          r."rawRowJson"->>'sdr_name', r."rawRowJson"->>'sdr',
          r."rawRowJson"->>'owner', r."rawRowJson"->>'rep', r."rawRowJson"->>'user'
        )), '') AS sdr,
        LOWER(COALESCE(
          r."rawRowJson"->>'channel', r."rawRowJson"->>'activity_type',
          r."rawRowJson"->>'activity_channel', ''
        )) AS channel_text,
        LOWER(COALESCE(
          r."rawRowJson"->>'meeting_booked', r."rawRowJson"->>'meeting', ''
        )) AS meeting_text,
        LOWER(COALESCE(
          r."rawRowJson"->>'manager_review_flag', r."rawRowJson"->>'flag',
          r."rawRowJson"->>'review_flag', ''
        )) AS flag_text
      FROM "V2IngestionRow" r
      WHERE r."organizationId" = ${organizationId}
        AND r."jobId" = ${ingestionJobId}
    )
    SELECT
      COALESCE(sdr, 'Unassigned') AS "sdr",
      COUNT(*) FILTER (WHERE channel_text LIKE '%email%')::bigint AS "emails",
      COUNT(*) FILTER (WHERE channel_text LIKE '%linkedin%')::bigint AS "linkedin",
      COUNT(*) FILTER (
        WHERE channel_text LIKE '%call%' OR channel_text LIKE '%voicemail%'
           OR channel_text LIKE '%phone%'
      )::bigint AS "calls",
      COUNT(*) FILTER (WHERE channel_text LIKE '%whatsapp%')::bigint AS "whatsapp",
      COUNT(*) FILTER (
        WHERE meeting_text IN ('yes','true','1','y') OR channel_text LIKE '%meeting%'
      )::bigint AS "meetings",
      COUNT(*) FILTER (
        WHERE flag_text IN ('yes','true','1','y','flag','flagged')
      )::bigint AS "flagged",
      COUNT(*)::bigint AS "total"
    FROM base
    GROUP BY COALESCE(sdr, 'Unassigned')
    ORDER BY "total" DESC, "sdr" ASC
  `;

  const summaryRows = rows.map((row) => ({
    sdr: row.sdr,
    emails: Number(row.emails),
    linkedin: Number(row.linkedin),
    calls: Number(row.calls),
    whatsapp: Number(row.whatsapp),
    meetings: Number(row.meetings),
    flagged: Number(row.flagged),
    total: Number(row.total),
  }));

  const totals = summaryRows.reduce(
    (acc, row) => ({
      emails: acc.emails + row.emails,
      linkedin: acc.linkedin + row.linkedin,
      calls: acc.calls + row.calls,
      whatsapp: acc.whatsapp + row.whatsapp,
      meetings: acc.meetings + row.meetings,
      flagged: acc.flagged + row.flagged,
      total: acc.total + row.total,
    }),
    { emails: 0, linkedin: 0, calls: 0, whatsapp: 0, meetings: 0, flagged: 0, total: 0 }
  );

  return { rows: summaryRows, totals, sdrCount: summaryRows.length };
}

// ---------------------------------------------------------------------------
// Standardized Activity table (bottom of the mock). Row-level, tenant-scoped,
// capped for the wizard view; client filters the loaded page.
// ---------------------------------------------------------------------------

export type StandardizedActivityRow = {
  id: string;
  sourceRowNumber: number;
  rowStatus: string;
  sdr: string | null;
  company: string | null;
  contact: string | null;
  channel: string | null;
  outcome: string | null;
  activityDate: string | null;
  note: string | null;
  managerReviewFlag: boolean;
  matchedCompanyId: string | null;
  matchedCompanyName: string | null;
  matchedContactId: string | null;
  matchedContactName: string | null;
};

type StandardizedActivityQueryRow = StandardizedActivityRow;

export async function queryStandardizedRows(
  organizationId: string,
  ingestionJobId: string,
  options: { limit?: number } = {}
): Promise<StandardizedActivityRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
  return prisma.$queryRaw<StandardizedActivityQueryRow[]>`
    SELECT
      r."id",
      r."sourceRowNumber",
      r."rowStatus"::text AS "rowStatus",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'sdr_name', r."rawRowJson"->>'sdr',
        r."rawRowJson"->>'owner', r."rawRowJson"->>'rep'
      )), '') AS "sdr",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'company', r."rawRowJson"->>'company_name',
        r."rawRowJson"->>'account_name'
      )), '') AS "company",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'contact_name', r."rawRowJson"->>'contact',
        r."rawRowJson"->>'full_name'
      )), '') AS "contact",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'channel', r."rawRowJson"->>'activity_type'
      )), '') AS "channel",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'outcome', r."rawRowJson"->>'status', r."rawRowJson"->>'result'
      )), '') AS "outcome",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'activity_date', r."rawRowJson"->>'date'
      )), '') AS "activityDate",
      NULLIF(TRIM(COALESCE(
        r."rawRowJson"->>'notes_details', r."rawRowJson"->>'notes', r."rawRowJson"->>'note'
      )), '') AS "note",
      (LOWER(COALESCE(
        r."rawRowJson"->>'manager_review_flag', r."rawRowJson"->>'flag',
        r."rawRowJson"->>'review_flag', ''
      )) IN ('yes','true','1','y','flag','flagged')) AS "managerReviewFlag",
      r."matchedCompanyId",
      c."name" AS "matchedCompanyName",
      r."matchedContactId",
      ct."fullName" AS "matchedContactName"
    FROM "V2IngestionRow" r
    LEFT JOIN "V2Company" c
      ON c."id" = r."matchedCompanyId" AND c."organizationId" = r."organizationId"
      AND c."status" = 'ACTIVE' AND c."deletedAt" IS NULL
    LEFT JOIN "V2Contact" ct
      ON ct."id" = r."matchedContactId" AND ct."organizationId" = r."organizationId"
      AND ct."status" = 'ACTIVE' AND ct."deletedAt" IS NULL
    WHERE r."organizationId" = ${organizationId}
      AND r."jobId" = ${ingestionJobId}
    ORDER BY r."sourceRowNumber" ASC
    LIMIT ${limit}
  `;
}
