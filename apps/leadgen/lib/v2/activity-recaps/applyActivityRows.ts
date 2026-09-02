import "server-only";

import { createHash } from "node:crypto";

import { prisma } from "@/lib/server/prisma";
import { createReviewItem } from "@/lib/v2/manager-review/createReviewItem";
import type { V2JobHandler } from "@/lib/v2/jobs/types";
import { createNonRetryableJobError, createRetryableJobError } from "@/lib/v2/jobs/errors";
import { toJsonbParam, sanitizeNullableText } from "@/lib/v2/persistence/jsonbSanitizer";

import { resolveActivityMatch } from "./matchResolver";
import type {
  CanonicalActivityRow,
  TimestampQuality,
  V2ActivityCandidateCompany,
  V2ActivityCandidateContact,
  V2ActivityCandidateLeadAssignment,
} from "./types";

// ---------------------------------------------------------------------------
// Payload schema
// ---------------------------------------------------------------------------

export const ACTIVITY_APPLY_JOB_SCHEMA_VERSION = "activity-apply.v1";

export type ActivityApplyRow = {
  row: CanonicalActivityRow;
  eventIndexWithinRow: number;
  timestampQuality: TimestampQuality;
};

export type ActivityApplyJobPayload = {
  schemaVersion: typeof ACTIVITY_APPLY_JOB_SCHEMA_VERSION;
  organizationId: string;
  rows: ActivityApplyRow[];
  ingestionJobId?: string | null;
  createdByUserId?: string | null;
};

export function parseActivityApplyJobPayload(raw: unknown): ActivityApplyJobPayload {
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as Record<string, unknown>)["schemaVersion"] !== ACTIVITY_APPLY_JOB_SCHEMA_VERSION
  ) {
    throw new Error(
      `ACTIVITY_APPLY payload missing or wrong schemaVersion (expected "${ACTIVITY_APPLY_JOB_SCHEMA_VERSION}").`
    );
  }
  const p = raw as ActivityApplyJobPayload;
  if (!p.organizationId || !Array.isArray(p.rows)) {
    throw new Error("ACTIVITY_APPLY payload missing required organizationId or rows.");
  }
  return p;
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

export function buildActivityApplyJobIdempotencyKey(
  organizationId: string,
  rows: ActivityApplyRow[]
): string {
  const hashes = rows.map((r) => r.row.sourceActivityHash).sort();
  const digest = createHash("sha256").update(hashes.join("|")).digest("hex");
  return `activity-apply:${organizationId}:rows:${digest}`;
}

// ---------------------------------------------------------------------------
// Actor membership loader (same pattern as upsertLeadAssignments)
// ---------------------------------------------------------------------------

type ActorMembership = { actorUserId: string; membershipId: string };

async function loadActorMembership(
  organizationId: string,
  actorUserId: string | null | undefined
): Promise<ActorMembership | null> {
  if (!actorUserId) return null;
  const rows = await prisma.$queryRaw<ActorMembership[]>`
    SELECT membership."id" AS "membershipId", membership."userId" AS "actorUserId"
    FROM "V2OrganizationMembership" membership
    INNER JOIN "V2User" app_user
      ON app_user."id" = membership."userId"
      AND app_user."status" = 'ACTIVE'
    WHERE membership."organizationId" = ${organizationId}
      AND membership."userId" = ${actorUserId}
      AND membership."status" = 'ACTIVE'
    ORDER BY membership."createdAt" ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Candidate loader (org-scoped, active, non-deleted)
// ---------------------------------------------------------------------------

async function loadCandidates(organizationId: string): Promise<{
  companies: V2ActivityCandidateCompany[];
  contacts: V2ActivityCandidateContact[];
  leadAssignments: V2ActivityCandidateLeadAssignment[];
}> {
  const [companies, contacts, leadAssignments] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        canonicalDomain: string | null;
        nameNormalized: string | null;
        displayName: string | null;
        websiteUrl: string | null;
      }>
    >`
      SELECT id, "organizationId", "canonicalDomain", "nameNormalized", "displayName", "websiteUrl"
      FROM "V2Company"
      WHERE "organizationId" = ${organizationId}
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
    `,

    prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        fullName: string | null;
        normalizedName: string | null;
        primaryEmail: string | null;
        normalizedPrimaryEmail: string | null;
        linkedinUrl: string | null;
        primaryPhone: string | null;
        companyId: string | null;
      }>
    >`
      SELECT id, "organizationId", "fullName", "normalizedName",
             "primaryEmail", "normalizedPrimaryEmail", "linkedinUrl",
             "primaryPhone", "companyId"
      FROM "V2Contact"
      WHERE "organizationId" = ${organizationId}
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
    `,

    prisma.$queryRaw<
      Array<{
        id: string;
        organizationId: string;
        projectId: string;
        icpVersionId: string | null;
        companyId: string;
        contactId: string | null;
        status: string;
        ownerUserId: string | null;
      }>
    >`
      SELECT id, "organizationId", "projectId", "icpVersionId",
             "companyId", "contactId", status, "ownerUserId"
      FROM "V2LeadAssignment"
      WHERE "organizationId" = ${organizationId}
        AND status = 'ACTIVE'
        AND "deletedAt" IS NULL
    `,
  ]);

  return {
    companies: companies.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      canonicalDomain: c.canonicalDomain,
      normalizedName: c.nameNormalized,
      displayName: c.displayName,
      website: c.websiteUrl,
    })),
    contacts: contacts.map((c) => ({
      id: c.id,
      organizationId: c.organizationId,
      fullName: c.fullName,
      normalizedName: c.normalizedName,
      email: c.primaryEmail,
      normalizedEmail: c.normalizedPrimaryEmail,
      linkedinUrl: c.linkedinUrl,
      phone: c.primaryPhone,
      companyId: c.companyId,
    })),
    leadAssignments: leadAssignments.map((la) => ({
      id: la.id,
      organizationId: la.organizationId,
      projectId: la.projectId,
      icpVersionId: la.icpVersionId,
      companyId: la.companyId,
      contactId: la.contactId,
      status: la.status,
      ownerUserId: la.ownerUserId,
    })),
  };
}

// ---------------------------------------------------------------------------
// Insert one V2ActivityRecord (idempotent via ON CONFLICT DO NOTHING)
// ---------------------------------------------------------------------------

async function insertActivityRecord(
  organizationId: string,
  leadAssignmentId: string,
  companyId: string,
  contactId: string | null,
  applyRow: ActivityApplyRow
): Promise<"created" | "existing"> {
  const { row } = applyRow;
  const occurredAt = row.activityDate ? new Date(row.activityDate) : new Date();
  const eventKind = `activity.${row.activityType}`;

  const result = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "V2ActivityRecord" (
      id, "organizationId", "leadAssignmentId", "companyId", "contactId",
      channel, "activityType", outcome, "eventKind", "occurredAt",
      "timestampQuality", "sourceActivityHash", "sourceRowNumber",
      note, "metadataJson", "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid()::text,
      ${organizationId},
      ${leadAssignmentId},
      ${companyId},
      ${contactId},
      ${row.channel},
      ${row.activityType},
      ${row.outcome},
      ${eventKind},
      ${occurredAt},
      ${applyRow.timestampQuality},
      ${row.sourceActivityHash},
      ${row.sourceRowNumber ?? null},
      ${sanitizeNullableText(row.note ?? null)},
      ${toJsonbParam({ sdrUser: row.sdrUser, sourceFileName: row.sourceFileName })}::jsonb,
      now(),
      now()
    )
    ON CONFLICT ("organizationId", "sourceActivityHash") DO NOTHING
    RETURNING id
  `;

  return result.length > 0 ? "created" : "existing";
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

type ApplyRowOutcome =
  | { kind: "inserted"; sourceActivityHash: string }
  | { kind: "existing"; sourceActivityHash: string }
  | { kind: "review_created"; sourceActivityHash: string; reviewItemId: string }
  | { kind: "review_existing"; sourceActivityHash: string }
  | { kind: "skipped_no_lead"; sourceActivityHash: string; reason: string }
  | { kind: "error"; sourceActivityHash: string; error: string };

export const activityApplyJobHandler: V2JobHandler = async (context) => {
  if (context.signal.aborted) {
    throw createRetryableJobError("JOB_ABORTED", "ACTIVITY_APPLY aborted before start.");
  }

  if (context.organizationId !== context.job.organizationId) {
    throw createNonRetryableJobError(
      "TENANT_MISMATCH",
      "ACTIVITY_APPLY job org does not match context org."
    );
  }

  let payload: ActivityApplyJobPayload;
  try {
    payload = parseActivityApplyJobPayload(context.payload);
  } catch (err) {
    throw createNonRetryableJobError(
      "INVALID_PAYLOAD",
      err instanceof Error ? err.message : "Invalid ACTIVITY_APPLY payload."
    );
  }

  if (payload.organizationId !== context.organizationId) {
    throw createNonRetryableJobError(
      "TENANT_MISMATCH",
      "ACTIVITY_APPLY payload org does not match job org."
    );
  }

  const { rows, ingestionJobId, createdByUserId } = payload;

  await context.updateProgress({ current: 0, total: rows.length });

  const [candidates, actorMembership] = await Promise.all([
    loadCandidates(context.organizationId),
    loadActorMembership(
      context.organizationId,
      createdByUserId ?? context.job.createdByUserId
    ),
  ]);

  const outcomes: ApplyRowOutcome[] = [];

  for (let i = 0; i < rows.length; i++) {
    const applyRow = rows[i];
    const { row } = applyRow;

    try {
      const matchResult = resolveActivityMatch({
        activity: row,
        candidates,
        context: {
          organizationId: context.organizationId,
          timestampQuality: applyRow.timestampQuality,
          sourceActivityHash: row.sourceActivityHash,
        },
      });

      if (
        matchResult.overallConfidence === "auto_match" &&
        matchResult.matchedLeadAssignmentId &&
        matchResult.matchedCompanyId
      ) {
        // Auto match → insert activity record (idempotent)
        const insertResult = await insertActivityRecord(
          context.organizationId,
          matchResult.matchedLeadAssignmentId,
          matchResult.matchedCompanyId,
          matchResult.matchedContactId ?? null,
          applyRow
        );
        outcomes.push({
          kind: insertResult === "created" ? "inserted" : "existing",
          sourceActivityHash: row.sourceActivityHash,
        });
      } else if (
        matchResult.overallConfidence === "auto_match" &&
        !matchResult.matchedLeadAssignmentId
      ) {
        // auto_match on company domain but no lead assignment found
        outcomes.push({
          kind: "skipped_no_lead",
          sourceActivityHash: row.sourceActivityHash,
          reason: "auto_match_but_no_lead_assignment",
        });
      } else {
        // suggested_match / needs_review / no_match → manager review
        if (!actorMembership) {
          outcomes.push({
            kind: "error",
            sourceActivityHash: row.sourceActivityHash,
            error: "REVIEW_ACTOR_MEMBERSHIP_NOT_FOUND: no active membership for createdByUserId",
          });
        } else {
          // Map activity match confidence to valid ManagerReviewReasonCode values
          const reasonCode =
            matchResult.overallConfidence === "suggested_match"
              ? "FUZZY_NAME_ONLY"
              : matchResult.overallConfidence === "needs_review"
                ? (matchResult.reasonCodes.includes("multiple_company_candidates")
                    ? "MULTIPLE_COMPANY_CANDIDATES"
                    : matchResult.reasonCodes.includes("multiple_contact_candidates")
                      ? "MULTIPLE_CONTACT_CANDIDATES"
                      : "FUZZY_NAME_ONLY")
                : "NO_MATCH_FROM_RECAP";

          const reviewResult = await createReviewItem({
            organizationId: context.organizationId,
            actorUserId: actorMembership.actorUserId,
            membershipId: actorMembership.membershipId,
            source: "MANAGER_REVIEW_RUNTIME",
            sourceType: "ACTIVITY_RECAP_ROW",
            reasonCode,
            ingestionJobId: ingestionJobId ?? null,
            ingestionRowId: null,
            sourceRowHash: row.sourceRowHash,
            eventIndexWithinRow: applyRow.eventIndexWithinRow,
            reasonDetail: matchResult.reasonCodes.join(", "),
            suggestedAction: matchResult.suggestedActions[0] ?? null,
            candidateSummariesJson: {
              matchResult,
              row: {
                channel: row.channel,
                activityType: row.activityType,
                outcome: row.outcome,
              },
            },
            metadataJson: {
              sourceActivityHash: row.sourceActivityHash,
              confidence: matchResult.overallConfidence,
            },
          });

          if (reviewResult.kind === "created") {
            outcomes.push({
              kind: "review_created",
              sourceActivityHash: row.sourceActivityHash,
              reviewItemId: reviewResult.item.id,
            });
          } else if (reviewResult.kind === "existing_active") {
            outcomes.push({
              kind: "review_existing",
              sourceActivityHash: row.sourceActivityHash,
            });
          } else {
            outcomes.push({
              kind: "error",
              sourceActivityHash: row.sourceActivityHash,
              error: reviewResult.message,
            });
          }
        }
      }
    } catch (err) {
      outcomes.push({
        kind: "error",
        sourceActivityHash: row.sourceActivityHash,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    await context.updateProgress({ current: i + 1, total: rows.length });
  }

  const inserted = outcomes.filter((o) => o.kind === "inserted").length;
  const existing = outcomes.filter((o) => o.kind === "existing").length;
  const reviewCreated = outcomes.filter((o) => o.kind === "review_created").length;
  const reviewExisting = outcomes.filter((o) => o.kind === "review_existing").length;
  const skipped = outcomes.filter((o) => o.kind === "skipped_no_lead").length;
  const errors = outcomes.filter((o) => o.kind === "error").length;

  return {
    resultSnapshotJson: {
      schemaVersion: ACTIVITY_APPLY_JOB_SCHEMA_VERSION,
      totalRows: rows.length,
      inserted,
      existing,
      reviewCreated,
      reviewExisting,
      skipped,
      errors,
      outcomes,
    },
    progressCurrent: rows.length,
    progressTotal: rows.length,
  };
};
