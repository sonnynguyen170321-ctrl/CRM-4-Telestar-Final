import "server-only";

import { prisma } from "@/lib/server/prisma";

// "Manager Review Rules & Flags" read-model for the wizard (the 6 cards in the mock).
// Pure data-quality dashboard derived from the job's V2IngestionRow rows — read-only,
// tenant-scoped (invariant #5). It does NOT create review items: match-quality routing
// to V2ManagerReviewItem already happens in the ACTIVITY_APPLY stage
// (lib/v2/activity-recaps/applyActivityRows.ts via createReviewItem). These flags surface
// quality signals (future dates, missing outcomes, volume outliers, duplicates) for the
// reviewer; matching gaps (unmatched company/contact) mirror the pipeline's match state.

export type ReviewFlagCounts = {
  activityDateInFuture: number;
  missingOutcome: number;
  unmatchedCompany: number;
  unmatchedContact: number;
  highVolumeOutlier: number;
  duplicateContacts: number;
};

type ReviewFlagQueryRow = {
  activityDateInFuture: bigint;
  missingOutcome: bigint;
  unmatchedCompany: bigint;
  unmatchedContact: bigint;
  highVolumeOutlier: bigint;
  duplicateContacts: bigint;
};

const HIGH_VOLUME_THRESHOLD = 250;

export async function queryReviewFlags(
  organizationId: string,
  ingestionJobId: string
): Promise<ReviewFlagCounts> {
  const rows = await prisma.$queryRaw<ReviewFlagQueryRow[]>`
    WITH base AS (
      SELECT
        NULLIF(TRIM(COALESCE(
          r."rawRowJson"->>'sdr_name', r."rawRowJson"->>'sdr', r."rawRowJson"->>'owner'
        )), '') AS sdr,
        NULLIF(TRIM(COALESCE(
          r."rawRowJson"->>'company', r."rawRowJson"->>'company_name',
          r."rawRowJson"->>'account_name'
        )), '') AS company,
        NULLIF(TRIM(COALESCE(
          r."rawRowJson"->>'contact_name', r."rawRowJson"->>'contact',
          r."rawRowJson"->>'full_name'
        )), '') AS contact,
        LOWER(NULLIF(TRIM(COALESCE(
          r."rawRowJson"->>'email', r."rawRowJson"->>'contact_email'
        )), '')) AS email,
        NULLIF(TRIM(COALESCE(
          r."rawRowJson"->>'outcome', r."rawRowJson"->>'status', r."rawRowJson"->>'result'
        )), '') AS outcome,
        TRIM(COALESCE(r."rawRowJson"->>'activity_date', r."rawRowJson"->>'date', '')) AS date_text,
        r."matchedCompanyId",
        r."matchedContactId"
      FROM "V2IngestionRow" r
      WHERE r."organizationId" = ${organizationId}
        AND r."jobId" = ${ingestionJobId}
    ),
    parsed AS (
      SELECT *,
        CASE
          WHEN date_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN to_timestamp(SUBSTRING(date_text FROM 1 FOR 10), 'YYYY-MM-DD')
          WHEN date_text ~ '^[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'
            THEN to_timestamp(REPLACE(SUBSTRING(date_text FROM 1 FOR 20), ',', ''), 'Mon DD YYYY')
          ELSE NULL
        END AS activity_ts
      FROM base
    ),
    day_counts AS (
      SELECT COALESCE(sdr, 'Unassigned') AS sdr, date_trunc('day', activity_ts) AS day, COUNT(*) AS c
      FROM parsed
      WHERE activity_ts IS NOT NULL
      GROUP BY 1, 2
    ),
    contact_keys AS (
      SELECT COALESCE(email, LOWER(contact)) AS k, COUNT(*) AS c
      FROM parsed
      WHERE COALESCE(email, contact) IS NOT NULL
      GROUP BY 1
    )
    SELECT
      COUNT(*) FILTER (WHERE activity_ts IS NOT NULL AND activity_ts > now())::bigint
        AS "activityDateInFuture",
      COUNT(*) FILTER (
        WHERE outcome IS NULL OR LOWER(outcome) IN ('n/a','na','unknown','-','none')
      )::bigint AS "missingOutcome",
      COUNT(*) FILTER (WHERE company IS NOT NULL AND "matchedCompanyId" IS NULL)::bigint
        AS "unmatchedCompany",
      COUNT(*) FILTER (WHERE contact IS NOT NULL AND "matchedContactId" IS NULL)::bigint
        AS "unmatchedContact",
      (SELECT COUNT(*) FROM day_counts WHERE c > ${HIGH_VOLUME_THRESHOLD})::bigint
        AS "highVolumeOutlier",
      (SELECT COALESCE(SUM(c), 0) FROM contact_keys WHERE c > 1)::bigint
        AS "duplicateContacts"
    FROM parsed
  `;

  const row = rows[0];

  return {
    activityDateInFuture: Number(row?.activityDateInFuture ?? 0),
    missingOutcome: Number(row?.missingOutcome ?? 0),
    unmatchedCompany: Number(row?.unmatchedCompany ?? 0),
    unmatchedContact: Number(row?.unmatchedContact ?? 0),
    highVolumeOutlier: Number(row?.highVolumeOutlier ?? 0),
    duplicateContacts: Number(row?.duplicateContacts ?? 0),
  };
}
