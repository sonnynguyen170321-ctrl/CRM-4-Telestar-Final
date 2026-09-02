import { createReviewItem } from "../manager-review/createReviewItem";
import type { ManagerReviewDb } from "../manager-review/types";
import { createNonRetryableJobError } from "../jobs/errors";
import type { V2JobHandler } from "../jobs/types";
import { normalizeCompanyName, normalizeIdentityDomain, splitPersonName, countryNameToIso } from "../identity";
import { assessLinkedInAccess } from "../crm/contactQuality";
import { upsertContactIdentifier, csvEmailValidationToStatus, type ContactIdentifierValidity } from "../crm/upsertContactIdentifier";
import { humanizeEmailLocalPart } from "../crm/resolveContactDisplayName";
import { enqueueCompanyEnrichmentJob } from "../company-intelligence";
import { enqueueIcpScoreJob } from "../scoring/runtime/enqueueScoringJobs";
import type { ImportRowKind } from "../activity-recaps/types";
import {
  DEFAULT_DB_BATCH_SIZE,
  V2IngestionMappingContextSchema,
  type V2IngestionDatabase,
} from "./types";

const UPSERT_SCHEMA_VERSION = "v2.ingestion.lead-assignment-upsert.v1";

type IngestionJobRecord = {
  id: string;
  organizationId: string;
  projectId: string | null;
  uploadedByUserId: string | null;
  mappingJson: unknown;
};

type UpsertRowRecord = {
  id: string;
  sourceRowHash: string;
  rowStatus: "MATCHED" | "NORMALIZED";
  matchedCompanyId: string | null;
  matchedContactId: string | null;
  normalizedRowJson: unknown;
};

type LeadAssignmentRow = {
  id: string;
  latestHardRuleAssessmentId: string | null;
};

type ActorMembership = {
  actorUserId: string;
  membershipId: string;
};

export const leadAssignmentUpsertIngestionJobHandler: V2JobHandler = async (
  context
) => {
  const payload = parseLeadAssignmentUpsertPayload(context.payload);
  const ingestionJobId = context.job.sourceId ?? payload.ingestionJobId;

  if (!ingestionJobId || ingestionJobId !== payload.ingestionJobId) {
    throw createNonRetryableJobError(
      "INGESTION_SOURCE_MISMATCH",
      "LEAD_ASSIGNMENT_UPSERT job sourceId must match payload ingestionJobId."
    );
  }

  const ingestionJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });
  const mappingContext = V2IngestionMappingContextSchema.safeParse(
    ingestionJob.mappingJson
  );
  const projectId =
    mappingContext.success && mappingContext.data.projectId
      ? mappingContext.data.projectId
      : ingestionJob.projectId;
  const icpVersionId =
    mappingContext.success && mappingContext.data.icpVersionId
      ? mappingContext.data.icpVersionId
      : null;

  const contextValidation = await validateProjectIcpContext(context.db, {
    organizationId: context.organizationId,
    projectId,
    icpVersionId,
  });

  if (!contextValidation.ok) {
    const touchedRows = await markProcessableRowsErrored(context.db, {
      organizationId: context.organizationId,
      ingestionJobId,
      projectId,
      icpVersionId,
      code: contextValidation.code,
    });

    return {
      resultSnapshotJson: {
        ingestionJobId,
        errorCode: contextValidation.code,
        errorRows: touchedRows,
        reviewItemsCreated: 0,
        reviewItemsExisting: 0,
        enrichCompanyIds: [],
        enrichmentJobs: [],
      },
      progressCurrent: touchedRows,
      progressTotal: touchedRows,
    };
  }
  const activeProjectId = projectId;
  const activeIcpVersionId = icpVersionId;

  if (!activeProjectId || !activeIcpVersionId) {
    throw createNonRetryableJobError(
      "NO_PROJECT_CONTEXT",
      "Project and ICP context are required for LEAD_ASSIGNMENT_UPSERT."
    );
  }

  let actorMembership: ActorMembership | null | undefined;
  const enrichCompanyIds = new Set<string>();
  const scoreLeadAssignmentIds = new Set<string>();
  const counts = {
    processedRows: 0,
    created: 0,
    existing: 0,
    reviewCreated: 0,
    reviewExisting: 0,
    skippedNone: 0,
    errors: 0,
  };

  while (true) {
    const rows = await loadProcessableRows(context.db, {
      organizationId: context.organizationId,
      ingestionJobId,
    });

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const normalizedRow = normalizeJsonObject(row.normalizedRowJson);
      const identityMatch = normalizeJsonObject(normalizedRow.identityMatch);

      try {
        if (row.rowStatus === "MATCHED") {
          let companyIdToUse = row.matchedCompanyId;

          if (!companyIdToUse && row.matchedContactId) {
            companyIdToUse = await loadCompanyIdForContact(context.db, {
              organizationId: context.organizationId,
              contactId: row.matchedContactId,
              projectId: activeProjectId,
            });
          }

          if (!companyIdToUse && row.matchedContactId) {
            const companyIdentity = extractCompanyIdentityFromNoneRow(row.normalizedRowJson);
            if (companyIdentity) {
              companyIdToUse = await createOrReuseCompanyFromNoneRow(context.db, {
                organizationId: context.organizationId,
                ...companyIdentity,
              });
            }
          }

          if (!companyIdToUse) {
            counts.errors += 1;
            await markRowError(context.db, {
              row,
              organizationId: context.organizationId,
              ingestionJobId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              code: "MATCHED_ROW_MISSING_COMPANY_ID",
            });
          } else {
            let contactIdToUse = row.matchedContactId;
            const contactIdentity = extractContactIdentityFromNoneRow(row.normalizedRowJson);
            if (!contactIdToUse) {
              if (contactIdentity) {
                contactIdToUse = await createOrReuseContactFromNoneRow(context.db, {
                  organizationId: context.organizationId,
                  ...contactIdentity,
                });
              }
            } else if (contactIdentity) {
              // Matched to an existing contact — merge the row's identifiers onto it (C-1) instead of
              // dropping the uploaded email/phone/linkedin, and backfill missing descriptive fields.
              await backfillContactTitle(context.db, context.organizationId, contactIdToUse, contactIdentity.title);
              await backfillContactDescriptive(context.db, context.organizationId, contactIdToUse, contactIdentity);
              await mergeContactIdentifiers(context.db, {
                organizationId: context.organizationId,
                contactId: contactIdToUse,
                email: contactIdentity.email,
                emailValidation: contactIdentity.emailValidation,
                linkedinUrl: contactIdentity.linkedinUrl,
                phone: contactIdentity.phone,
                phoneCountry: contactIdentity.phoneCountry,
              });
            }

            if (contactIdToUse) {
              await upsertCurrentContactEmployment(context.db, {
                organizationId: context.organizationId,
                contactId: contactIdToUse,
                companyId: companyIdToUse,
              });
            }

            const upserted = await upsertLeadAssignment(context.db, {
              organizationId: context.organizationId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              companyId: companyIdToUse,
              contactId: contactIdToUse,
            });
            counts[upserted.action] += 1;

            if (
              upserted.action === "created" ||
              !upserted.latestHardRuleAssessmentId
            ) {
              enrichCompanyIds.add(companyIdToUse);
              scoreLeadAssignmentIds.add(upserted.leadAssignmentId);
            }

            await markRowApplied(context.db, {
              row,
              organizationId: context.organizationId,
              ingestionJobId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              leadAssignmentId: upserted.leadAssignmentId,
              action: upserted.action,
            });
          }
        } else if (identityMatch.kind === "candidate") {
          if (actorMembership === undefined) {
            actorMembership = await loadActorMembership(context.db, {
              organizationId: context.organizationId,
              actorUserId:
                ingestionJob.uploadedByUserId ?? context.job.createdByUserId,
            });
          }

          if (!actorMembership) {
            counts.errors += 1;
            await markRowError(context.db, {
              row,
              organizationId: context.organizationId,
              ingestionJobId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              code: "REVIEW_ACTOR_MEMBERSHIP_NOT_FOUND",
            });
          } else {
            const reviewResult = await createReviewItem(
              {
                organizationId: context.organizationId,
                actorUserId: actorMembership.actorUserId,
                membershipId: actorMembership.membershipId,
                source: "MANAGER_REVIEW_RUNTIME",
                sourceType: "IDENTITY_MATCH",
                reasonCode: "FUZZY_NAME_ONLY",
                sourceId: row.id,
                ingestionJobId,
                ingestionRowId: row.id,
                sourceRowHash: row.sourceRowHash,
                projectId: activeProjectId,
                icpVersionId: activeIcpVersionId,
                companyId: readString(identityMatch.companyId),
                contactId: readString(identityMatch.contactId),
                sourceRefJson: {
                  ingestionJobId,
                  ingestionRowId: row.id,
                  identityMatch,
                },
                reasonDetail:
                  "Identity resolver returned a candidate only; human confirmation required before lead creation.",
                suggestedAction:
                  "Confirm the company/contact identity or dismiss the candidate.",
                priority: "NORMAL",
                confidence: "LOW",
                candidateSummariesJson: [identityMatch],
                metadataJson: {
                  schemaVersion: UPSERT_SCHEMA_VERSION,
                  ingestionJobId,
                  ingestionRowId: row.id,
                },
              },
              context.db as unknown as ManagerReviewDb
            );

            if (reviewResult.kind === "created") {
              counts.reviewCreated += 1;
              await markRowApplied(context.db, {
                row,
                organizationId: context.organizationId,
                ingestionJobId,
                projectId: activeProjectId,
                icpVersionId: activeIcpVersionId,
                leadAssignmentId: null,
                action: "review_created",
              });
            } else if (reviewResult.kind === "existing_active") {
              counts.reviewExisting += 1;
              await markRowApplied(context.db, {
                row,
                organizationId: context.organizationId,
                ingestionJobId,
                projectId: activeProjectId,
                icpVersionId: activeIcpVersionId,
                leadAssignmentId: null,
                action: "review_existing",
              });
            } else {
              counts.errors += 1;
              await markRowError(context.db, {
                row,
                organizationId: context.organizationId,
                ingestionJobId,
                projectId: activeProjectId,
                icpVersionId: activeIcpVersionId,
                code:
                  "code" in reviewResult
                    ? `REVIEW_${reviewResult.code}`
                    : "REVIEW_CREATE_FAILED",
              });
            }
          }
        } else if (identityMatch.kind === "none") {
          const companyIdentity = extractCompanyIdentityFromNoneRow(row.normalizedRowJson);
          if (!companyIdentity) {
            counts.errors += 1;
            await markRowError(context.db, {
              row,
              organizationId: context.organizationId,
              ingestionJobId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              code: "INSUFFICIENT_COMPANY_IDENTITY",
            });
          } else {
            const companyId = await createOrReuseCompanyFromNoneRow(context.db, {
              organizationId: context.organizationId,
              ...companyIdentity,
            });

            let contactIdToUse: string | null = null;
            const contactIdentity = extractContactIdentityFromNoneRow(row.normalizedRowJson);
            if (contactIdentity) {
              contactIdToUse = await createOrReuseContactFromNoneRow(context.db, {
                organizationId: context.organizationId,
                ...contactIdentity,
              });
            }

            if (contactIdToUse) {
              await upsertCurrentContactEmployment(context.db, {
                organizationId: context.organizationId,
                contactId: contactIdToUse,
                companyId,
              });
            }

            const upserted = await upsertLeadAssignment(context.db, {
              organizationId: context.organizationId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              companyId,
              contactId: contactIdToUse,
            });
            counts[upserted.action] += 1;

            if (
              upserted.action === "created" ||
              !upserted.latestHardRuleAssessmentId
            ) {
              enrichCompanyIds.add(companyId);
              scoreLeadAssignmentIds.add(upserted.leadAssignmentId);
            }

            await markRowApplied(context.db, {
              row,
              organizationId: context.organizationId,
              ingestionJobId,
              projectId: activeProjectId,
              icpVersionId: activeIcpVersionId,
              leadAssignmentId: upserted.leadAssignmentId,
              action: upserted.action,
            });
          }
        } else {
          counts.skippedNone += 1;
          await markRowSkippedNone(context.db, {
            row,
            organizationId: context.organizationId,
            ingestionJobId,
            projectId: activeProjectId,
            icpVersionId: activeIcpVersionId,
          });
        }
      } catch (error) {
        counts.errors += 1;
        await markRowError(context.db, {
          row,
          organizationId: context.organizationId,
          ingestionJobId,
          projectId: activeProjectId,
          icpVersionId: activeIcpVersionId,
          code: error instanceof Error ? error.message : "LEAD_UPSERT_ERROR",
        });
      }

      counts.processedRows += 1;
    }

    await context.updateProgress({ current: counts.processedRows });
  }

  const companyIds = Array.from(enrichCompanyIds).sort();
  const enrichmentJobs: Array<{
    companyId: string;
    result: "created" | "existing" | "conflict";
    idempotencyKey: string;
  }> = [];

  for (const companyId of companyIds) {
    const enrichmentJob = await enqueueCompanyEnrichmentJob(context.db, {
      organizationId: context.organizationId,
      companyId,
      createdByUserId:
        ingestionJob.uploadedByUserId ?? context.job.createdByUserId,
      // Bind enrichment to this ingestion job so the per-batch run control
      // drains it (and the handler forwards the binding onto ICP_SCORE),
      // keeping the whole pipeline reachable from one run scope.
      source: { sourceType: "INGESTION_JOB", sourceId: ingestionJobId },
    });

    enrichmentJobs.push({
      companyId,
      result: enrichmentJob.kind,
      idempotencyKey:
        enrichmentJob.kind === "conflict"
          ? enrichmentJob.existingJob.idempotencyKey
          : enrichmentJob.job.idempotencyKey,
    });
  }

  const scoreLeadAssignmentIdList = Array.from(scoreLeadAssignmentIds).sort();
  const directScoreJob = scoreLeadAssignmentIdList.length > 0
    ? await enqueueIcpScoreJob(context.db, {
        organizationId: context.organizationId,
        selection: { kind: "lead_assignment_ids", leadAssignmentIds: scoreLeadAssignmentIdList },
        createdByUserId: ingestionJob.uploadedByUserId ?? context.job.createdByUserId,
        source: { sourceType: "INGESTION_JOB", sourceId: ingestionJobId },
      })
    : null;
  let activityEventUpsertJob = null;
  const importProfile = (ingestionJob.mappingJson as { importProfile?: ImportRowKind } | null)?.importProfile as ImportRowKind;
  if (
    importProfile === "activity_event" ||
    importProfile === "wide_activity_bundle" ||
    importProfile === "meeting_tracker"
  ) {
    const { enqueueActivityEventUpsertJob } = await import("./enqueueIngestionJobs");
    const enqueued = await enqueueActivityEventUpsertJob(context.db, {
      organizationId: context.organizationId,
      ingestionJobId,
      createdByUserId: ingestionJob.uploadedByUserId ?? context.job.createdByUserId,
    });
    activityEventUpsertJob = {
      result: enqueued.kind,
      idempotencyKey: enqueued.kind === "conflict" ? enqueued.existingJob.idempotencyKey : enqueued.job.idempotencyKey,
    };
  }

  return {
    resultSnapshotJson: {
      ingestionJobId,
      counts,
      enrichCompanyIds: companyIds,
      enrichmentJobs,
      directScoreJob: directScoreJob
        ? {
            result: directScoreJob.kind,
            idempotencyKey: directScoreJob.kind === "conflict" ? directScoreJob.existingJob.idempotencyKey : directScoreJob.job.idempotencyKey,
          }
        : null,
      activityEventUpsertJob,
    },
    progressCurrent: counts.processedRows,
    progressTotal: counts.processedRows,
  };
};

async function loadIngestionJob(
  db: V2IngestionDatabase,
  input: { organizationId: string; ingestionJobId: string }
) {
  const rows = await db.$queryRaw<IngestionJobRecord[]>`
    SELECT "id", "organizationId", "projectId", "uploadedByUserId", "mappingJson"
    FROM "V2IngestionJob"
    WHERE "id" = ${input.ingestionJobId}
      AND "organizationId" = ${input.organizationId}
    LIMIT 1
  `;

  if (!rows[0]) {
    throw createNonRetryableJobError(
      "INGESTION_JOB_NOT_FOUND",
      "V2 ingestion job was not found for LEAD_ASSIGNMENT_UPSERT."
    );
  }

  return rows[0];
}

async function validateProjectIcpContext(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    projectId: string | null;
    icpVersionId: string | null;
  }
): Promise<{ ok: true } | { ok: false; code: string }> {
  if (!input.projectId || !input.icpVersionId) {
    return { ok: false, code: "NO_PROJECT_CONTEXT" };
  }

  const rows = await db.$queryRaw<Array<{ icpVersionId: string }>>`
    SELECT icp."id" AS "icpVersionId"
    FROM "V2Project" project
    INNER JOIN "V2Offer" offer
      ON offer."projectId" = project."id"
      AND offer."organizationId" = project."organizationId"
      AND offer."status" = 'ACTIVE'
    INNER JOIN "V2ICPProfile" profile
      ON profile."offerId" = offer."id"
      AND profile."organizationId" = project."organizationId"
      AND profile."status" = 'ACTIVE'
    INNER JOIN "V2ICPVersion" icp
      ON icp."icpProfileId" = profile."id"
      AND icp."organizationId" = project."organizationId"
      AND icp."status" = 'PUBLISHED'
      AND icp."deletedAt" IS NULL
      AND icp."rulesJson" IS NOT NULL
    WHERE project."id" = ${input.projectId}
      AND project."organizationId" = ${input.organizationId}
      AND project."status" = 'ACTIVE'
      AND icp."id" = ${input.icpVersionId}
    LIMIT 1
  `;

  return rows[0] ? { ok: true } : { ok: false, code: "INVALID_PROJECT_ICP_CONTEXT" };
}

async function loadProcessableRows(
  db: V2IngestionDatabase,
  input: { organizationId: string; ingestionJobId: string }
) {
  return db.$queryRaw<UpsertRowRecord[]>`
    SELECT
      "id",
      "sourceRowHash",
      "rowStatus"::text AS "rowStatus",
      "matchedCompanyId",
      "matchedContactId",
      "normalizedRowJson"
    FROM "V2IngestionRow"
    WHERE "organizationId" = ${input.organizationId}
      AND "jobId" = ${input.ingestionJobId}
      AND "rowStatus" IN ('MATCHED', 'NORMALIZED')
      AND (
        "normalizedRowJson" IS NULL
        OR ("normalizedRowJson"::jsonb ? 'leadAssignmentUpsert') = FALSE
      )
    ORDER BY "sourceRowNumber" ASC
    LIMIT ${DEFAULT_DB_BATCH_SIZE}
  `;
}

async function upsertLeadAssignment(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    projectId: string;
    icpVersionId: string;
    companyId: string;
    contactId: string | null;
  }
): Promise<{
  action: "created" | "existing";
  leadAssignmentId: string;
  latestHardRuleAssessmentId: string | null;
}> {
  const assignmentLevel = input.contactId ? "CONTACT" : "COMPANY";
  const existing = await selectActiveLeadAssignment(db, input, assignmentLevel);

  if (existing) {
    return {
      action: "existing",
      leadAssignmentId: existing.id,
      latestHardRuleAssessmentId: existing.latestHardRuleAssessmentId,
    };
  }

  try {
    const createdRows = await db.$queryRaw<LeadAssignmentRow[]>`
      INSERT INTO "V2LeadAssignment" (
        "id",
        "organizationId",
        "projectId",
        "icpVersionId",
        "companyId",
        "contactId",
        "assignmentLevel",
        "workflowStatus",
        "status",
        "createdAt",
        "updatedAt"
      )
      VALUES (
        ${createLeadAssignmentId()},
        ${input.organizationId},
        ${input.projectId},
        ${input.icpVersionId},
        ${input.companyId},
        ${assignmentLevel === "CONTACT" ? input.contactId : null},
        ${assignmentLevel}::"V2LeadAssignmentLevel",
        'NEW',
        'ACTIVE',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING "id", "latestHardRuleAssessmentId"
    `;

    return {
      action: "created",
      leadAssignmentId: createdRows[0].id,
      latestHardRuleAssessmentId: createdRows[0].latestHardRuleAssessmentId,
    };
  } catch (error) {
    if (!isLeadAssignmentUniqueConflict(error)) {
      throw error;
    }

    const afterConflict = await selectActiveLeadAssignment(
      db,
      input,
      assignmentLevel
    );

    if (!afterConflict) {
      throw error;
    }

    return {
      action: "existing",
      leadAssignmentId: afterConflict.id,
      latestHardRuleAssessmentId: afterConflict.latestHardRuleAssessmentId,
    };
  }
}

async function selectActiveLeadAssignment(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    projectId: string;
    icpVersionId: string;
    companyId: string;
    contactId: string | null;
  },
  assignmentLevel: "COMPANY" | "CONTACT"
) {
  if (assignmentLevel === "CONTACT") {
    if (!input.contactId) {
      return null;
    }

    const rows = await db.$queryRaw<LeadAssignmentRow[]>`
      SELECT "id", "latestHardRuleAssessmentId"
      FROM "V2LeadAssignment"
      WHERE "organizationId" = ${input.organizationId}
        AND "projectId" = ${input.projectId}
        AND "icpVersionId" = ${input.icpVersionId}
        AND "companyId" = ${input.companyId}
        AND "contactId" = ${input.contactId}
        AND "assignmentLevel" = 'CONTACT'
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
      LIMIT 1
    `;

    return rows[0] ?? null;
  }

  const rows = await db.$queryRaw<LeadAssignmentRow[]>`
    SELECT "id", "latestHardRuleAssessmentId"
    FROM "V2LeadAssignment"
    WHERE "organizationId" = ${input.organizationId}
      AND "projectId" = ${input.projectId}
      AND "icpVersionId" = ${input.icpVersionId}
      AND "companyId" = ${input.companyId}
      AND "contactId" IS NULL
      AND "assignmentLevel" = 'COMPANY'
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    LIMIT 1
  `;

  return rows[0] ?? null;
}

async function loadCompanyIdForContact(
  db: V2IngestionDatabase,
  input: { organizationId: string; contactId: string; projectId: string | null }
) {
  const rows = await db.$queryRaw<{ companyId: string }[]>`
    WITH candidate_companies AS (
      SELECT employment."companyId", 0 AS priority, employment."updatedAt", employment."createdAt", employment."id"
      FROM "V2ContactEmployment" employment
      WHERE employment."organizationId" = ${input.organizationId}
        AND employment."contactId" = ${input.contactId}
        AND employment."isCurrent" = TRUE

      UNION ALL

      SELECT lead."companyId", 1 AS priority, lead."updatedAt", lead."createdAt", lead."id"
      FROM "V2LeadAssignment" lead
      WHERE lead."organizationId" = ${input.organizationId}
        AND lead."contactId" = ${input.contactId}
        AND lead."status" = 'ACTIVE'
        AND lead."deletedAt" IS NULL
        AND (${input.projectId}::text IS NULL OR lead."projectId" = ${input.projectId})
    )
    SELECT candidates."companyId"
    FROM candidate_companies candidates
    INNER JOIN "V2Company" company
      ON company."id" = candidates."companyId"
      AND company."organizationId" = ${input.organizationId}
      AND company."status" = 'ACTIVE'
      AND company."deletedAt" IS NULL
    ORDER BY candidates.priority ASC, candidates."updatedAt" DESC, candidates."createdAt" DESC, candidates."id" ASC
    LIMIT 1
  `;

  return rows[0]?.companyId ?? null;
}

async function upsertCurrentContactEmployment(
  db: V2IngestionDatabase,
  input: { organizationId: string; contactId: string; companyId: string }
) {
  const existingRows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id"
    FROM "V2ContactEmployment"
    WHERE "organizationId" = ${input.organizationId}
      AND "contactId" = ${input.contactId}
      AND "companyId" = ${input.companyId}
      AND "isCurrent" = TRUE
    LIMIT 1
  `;

  if (existingRows[0]) {
    return existingRows[0].id;
  }

  const insertedRows = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "V2ContactEmployment" (
      "id",
      "organizationId",
      "contactId",
      "companyId",
      "isCurrent",
      "createdAt",
      "updatedAt"
    )
    VALUES (
      ${createContactEmploymentId()},
      ${input.organizationId},
      ${input.contactId},
      ${input.companyId},
      TRUE,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    RETURNING "id"
  `;

  return insertedRows[0]?.id ?? null;
}

function createContactEmploymentId() {
  return `emp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
async function loadActorMembership(
  db: V2IngestionDatabase,
  input: { organizationId: string; actorUserId: string | null }
): Promise<ActorMembership | null> {
  if (input.actorUserId) {
    const rows = await db.$queryRaw<ActorMembership[]>`
      SELECT membership."id" AS "membershipId", membership."userId" AS "actorUserId"
      FROM "V2OrganizationMembership" membership
      INNER JOIN "V2User" app_user
        ON app_user."id" = membership."userId"
        AND app_user."status" = 'ACTIVE'
      WHERE membership."organizationId" = ${input.organizationId}
        AND membership."userId" = ${input.actorUserId}
        AND membership."status" = 'ACTIVE'
      ORDER BY membership."createdAt" ASC
      LIMIT 1
    `;
    if (rows[0]) return rows[0];
  }

  // Fallback to any active membership in the organization (preferably an admin, but any active will do)
  const fallbackRows = await db.$queryRaw<ActorMembership[]>`
    SELECT membership."id" AS "membershipId", membership."userId" AS "actorUserId"
    FROM "V2OrganizationMembership" membership
    INNER JOIN "V2User" app_user
      ON app_user."id" = membership."userId"
      AND app_user."status" = 'ACTIVE'
    WHERE membership."organizationId" = ${input.organizationId}
      AND membership."status" = 'ACTIVE'
    ORDER BY membership."role" ASC, membership."createdAt" ASC
    LIMIT 1
  `;

  return fallbackRows[0] ?? null;
}

async function markProcessableRowsErrored(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    projectId: string | null;
    icpVersionId: string | null;
    code: string;
  }
) {
  const rows = await db.$queryRaw<Array<{ id: string; normalizedRowJson: unknown }>>`
    SELECT "id", "normalizedRowJson"
    FROM "V2IngestionRow"
    WHERE "organizationId" = ${input.organizationId}
      AND "jobId" = ${input.ingestionJobId}
      AND "rowStatus" IN ('MATCHED', 'NORMALIZED')
      AND (
        "normalizedRowJson" IS NULL
        OR ("normalizedRowJson"::jsonb ? 'leadAssignmentUpsert') = FALSE
      )
  `;

  for (const row of rows) {
    const merged = mergeLeadAssignmentUpsert(row.normalizedRowJson, {
      schemaVersion: UPSERT_SCHEMA_VERSION,
      leadAssignmentId: null,
      action: "error",
      projectId: input.projectId,
      icpVersionId: input.icpVersionId,
    });
    await db.$queryRaw`
      UPDATE "V2IngestionRow"
      SET
        "rowStatus" = 'ERROR',
        "errorMessage" = ${input.code},
        "normalizedRowJson" = ${JSON.stringify(merged)}::jsonb
      WHERE "id" = ${row.id}
        AND "organizationId" = ${input.organizationId}
        AND "jobId" = ${input.ingestionJobId}
    `;
  }

  return rows.length;
}

async function markRowApplied(
  db: V2IngestionDatabase,
  input: {
    row: UpsertRowRecord;
    organizationId: string;
    ingestionJobId: string;
    projectId: string;
    icpVersionId: string;
    leadAssignmentId: string | null;
    action: "created" | "existing" | "review_created" | "review_existing";
  }
) {
  const merged = mergeLeadAssignmentUpsert(input.row.normalizedRowJson, {
    schemaVersion: UPSERT_SCHEMA_VERSION,
    leadAssignmentId: input.leadAssignmentId,
    action: input.action,
    projectId: input.projectId,
    icpVersionId: input.icpVersionId,
  });

  await db.$queryRaw`
    UPDATE "V2IngestionRow"
    SET
      "rowStatus" = 'APPLIED',
      "errorMessage" = NULL,
      "normalizedRowJson" = ${JSON.stringify(merged)}::jsonb
    WHERE "id" = ${input.row.id}
      AND "organizationId" = ${input.organizationId}
      AND "jobId" = ${input.ingestionJobId}
  `;
}

async function markRowSkippedNone(
  db: V2IngestionDatabase,
  input: {
    row: UpsertRowRecord;
    organizationId: string;
    ingestionJobId: string;
    projectId: string;
    icpVersionId: string;
  }
) {
  const merged = mergeLeadAssignmentUpsert(input.row.normalizedRowJson, {
    schemaVersion: UPSERT_SCHEMA_VERSION,
    leadAssignmentId: null,
    action: "skipped_none",
    projectId: input.projectId,
    icpVersionId: input.icpVersionId,
  });

  await db.$queryRaw`
    UPDATE "V2IngestionRow"
    SET
      "normalizedRowJson" = ${JSON.stringify(merged)}::jsonb,
      "errorMessage" = NULL
    WHERE "id" = ${input.row.id}
      AND "organizationId" = ${input.organizationId}
      AND "jobId" = ${input.ingestionJobId}
  `;
}

async function markRowError(
  db: V2IngestionDatabase,
  input: {
    row: UpsertRowRecord;
    organizationId: string;
    ingestionJobId: string;
    projectId: string;
    icpVersionId: string;
    code: string;
  }
) {
  const merged = mergeLeadAssignmentUpsert(input.row.normalizedRowJson, {
    schemaVersion: UPSERT_SCHEMA_VERSION,
    leadAssignmentId: null,
    action: "error",
    projectId: input.projectId,
    icpVersionId: input.icpVersionId,
  });

  await db.$queryRaw`
    UPDATE "V2IngestionRow"
    SET
      "rowStatus" = 'ERROR',
      "errorMessage" = ${input.code},
      "normalizedRowJson" = ${JSON.stringify(merged)}::jsonb
    WHERE "id" = ${input.row.id}
      AND "organizationId" = ${input.organizationId}
      AND "jobId" = ${input.ingestionJobId}
  `;
}

function mergeLeadAssignmentUpsert(
  normalizedRowJson: unknown,
  leadAssignmentUpsert: {
    schemaVersion: string;
    leadAssignmentId: string | null;
    action:
      | "created"
      | "existing"
      | "skipped_none"
      | "review_created"
      | "review_existing"
      | "error";
    projectId: string | null;
    icpVersionId: string | null;
  }
) {
  const normalizedRow = normalizeJsonObject(normalizedRowJson);

  return {
    ...normalizedRow,
    leadAssignmentUpsert,
  };
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseLeadAssignmentUpsertPayload(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      "v2.ingestion.lead-assignment-upsert-job.v1" ||
    typeof (value as { ingestionJobId?: unknown }).ingestionJobId !== "string"
  ) {
    throw createNonRetryableJobError(
      "INVALID_LEAD_ASSIGNMENT_UPSERT_PAYLOAD",
      "LEAD_ASSIGNMENT_UPSERT payload was invalid."
    );
  }

  return value as {
    schemaVersion: "v2.ingestion.lead-assignment-upsert-job.v1";
    ingestionJobId: string;
  };
}

function isLeadAssignmentUniqueConflict(error: unknown) {
  const text = String(
    (error as { code?: unknown; message?: unknown; meta?: unknown })?.code ??
      (error as { message?: unknown })?.message ??
      (error as { meta?: unknown })?.meta ??
      ""
  );

  return (
    text.includes("23505") ||
    text.includes("P2002") ||
    text.includes("V2LeadAssignment_active_company_assignment_key") ||
    text.includes("V2LeadAssignment_active_contact_assignment_key")
  );
}

function createLeadAssignmentId() {
  return `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function extractCompanyIdentityFromNoneRow(normalizedRowJson: unknown) {
  const normalizedRow = normalizeJsonObject(normalizedRowJson);
  const companyStr = readString(normalizedRow.company);
  const websiteStr = readString(normalizedRow.website);
  const domainStr = readString(normalizedRow.domain);
  const hints = normalizeJsonObject(normalizedRow.hints);

  const rawWebsite = websiteStr ?? readString(hints.website);
  const rawDomain =
    domainStr ??
    readString(hints.canonicalDomain) ??
    (rawWebsite ? normalizeIdentityDomain(rawWebsite) : null);

  const rawName = companyStr ?? readString(hints.companyName) ?? rawDomain;
  const nameNormalized = normalizeCompanyName(rawName);

  if (!rawName || !nameNormalized) {
    return null;
  }

  return {
    name: rawName,
    nameNormalized,
    canonicalDomain: rawDomain ? normalizeIdentityDomain(rawDomain) : null,
    websiteUrl: rawWebsite,
    // Descriptive fields (previously discarded). industry/employeeCountRange feed scoring; all feed filters.
    industry: readString(normalizedRow.companyIndustry) ?? readString(hints.companyIndustry),
    country: readString(normalizedRow.companyCountry) ?? readString(hints.companyCountry),
    employeeCountRange: readString(normalizedRow.companyStaffCount) ?? readString(hints.companyStaffCount),
    revenue: readString(normalizedRow.companyRevenue) ?? readString(hints.companyRevenue),
  };
}

async function createOrReuseCompanyFromNoneRow(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    name: string;
    nameNormalized: string;
    canonicalDomain: string | null;
    websiteUrl: string | null;
    industry?: string | null;
    country?: string | null;
    employeeCountRange?: string | null;
    revenue?: string | null;
  }
) {
  if (input.canonicalDomain) {
    const rows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "V2Company"
      WHERE "organizationId" = ${input.organizationId}
        AND "canonicalDomain" = ${input.canonicalDomain}
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
      LIMIT 1
    `;
    if (rows[0]) { await backfillCompanyDescriptive(db, input.organizationId, rows[0].id, input); return rows[0].id; }
  }

  const nameRows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "V2Company"
    WHERE "organizationId" = ${input.organizationId}
      AND "nameNormalized" = ${input.nameNormalized}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    LIMIT 1
  `;
  if (nameRows[0]) { await backfillCompanyDescriptive(db, input.organizationId, nameRows[0].id, input); return nameRows[0].id; }

  try {
    const createdRows = await db.$queryRaw<{ id: string }[]>`
      INSERT INTO "V2Company" (
        "id", "organizationId", "name", "nameNormalized", "canonicalDomain", "websiteUrl",
        "country", "industry", "employeeCountRange", "revenue", "status", "createdAt", "updatedAt"
      ) VALUES (
        ${createCompanyId()},
        ${input.organizationId},
        ${input.name},
        ${input.nameNormalized},
        ${input.canonicalDomain},
        ${input.websiteUrl},
        ${input.country ?? null},
        ${input.industry ?? null},
        ${input.employeeCountRange ?? null},
        ${input.revenue ?? null},
        'ACTIVE',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
      RETURNING "id"
    `;
    return createdRows[0].id;
  } catch (error) {
    if (input.canonicalDomain) {
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "V2Company"
        WHERE "organizationId" = ${input.organizationId}
          AND "canonicalDomain" = ${input.canonicalDomain}
          AND "status" = 'ACTIVE'
          AND "deletedAt" IS NULL
        LIMIT 1
      `;
      if (rows[0]) return rows[0].id;
    }

    const nameRows = await db.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "V2Company"
      WHERE "organizationId" = ${input.organizationId}
        AND "nameNormalized" = ${input.nameNormalized}
        AND "status" = 'ACTIVE'
        AND "deletedAt" IS NULL
      LIMIT 1
    `;
    if (nameRows[0]) return nameRows[0].id;

    throw error;
  }
}

function createCompanyId() {
  return `comp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Fill an existing company's descriptive fields from an upload only where currently empty. */
async function backfillCompanyDescriptive(
  db: V2IngestionDatabase,
  organizationId: string,
  companyId: string,
  input: { industry?: string | null; country?: string | null; employeeCountRange?: string | null; revenue?: string | null }
): Promise<void> {
  if (!input.industry && !input.country && !input.employeeCountRange && !input.revenue) return;
  await db.$executeRaw`
    UPDATE "V2Company" SET
      "industry" = COALESCE("industry", ${input.industry ?? null}),
      "country" = COALESCE("country", ${input.country ?? null}),
      "employeeCountRange" = COALESCE("employeeCountRange", ${input.employeeCountRange ?? null}),
      "revenue" = COALESCE("revenue", ${input.revenue ?? null}),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${companyId} AND "organizationId" = ${organizationId}
  `;
}

export function extractContactIdentityFromNoneRow(normalizedRowJson: unknown) {
  const normalizedRow = normalizeJsonObject(normalizedRowJson);
  const emailStr = readString(normalizedRow.email);
  const contactStr = readString(normalizedRow.contact);
  const linkedinStr = readString(normalizedRow.linkedin);
  const hints = normalizeJsonObject(normalizedRow.hints);

  const contactLinkedinStr = readString(normalizedRow.contactLinkedin);
  const contactPhoneStr = readString(normalizedRow.contactPhone);

  const rawEmail = emailStr ?? readString(hints.contactEmail);
  const rawName = contactStr ?? readString(hints.contactName);
  const rawLinkedin = contactLinkedinStr ?? linkedinStr ?? readString(hints.linkedinUrl) ?? readString(hints.linkedin);
  const rawPhone = contactPhoneStr ?? readString(hints.contactPhone) ?? readString(hints.phone);

  const rawFirstName = readString(normalizedRow.firstName);
  const rawLastName = readString(normalizedRow.lastName);

  if (!rawEmail && !rawName && !rawLinkedin && !rawPhone && !rawFirstName && !rawLastName) {
    return null;
  }

  let firstName = rawFirstName;
  let lastName = rawLastName;

  // Split a single full-name field with Vietnamese Surname-first order in mind ("Nguyễn Văn Minh" ->
  // given Minh / family Nguyễn), instead of the old blind first = token[0] (Inv 11).
  if (rawName && !firstName && !lastName) {
    const split = splitPersonName(rawName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  // No raw email-as-name: when only an email exists, store a humanized local-part ("john.doe" ->
  // "John Doe") so the leads table/drawer read like a person, not a mailbox. resolveContactDisplayName
  // at read time still cleans any legacy rows.
  const emailLocal = rawEmail ? rawEmail.split("@")[0] : null;
  const computedName =
    rawName ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    (emailLocal ? humanizeEmailLocalPart(emailLocal) || emailLocal : "Unknown");

  const title = readString(normalizedRow.title) ?? readString(hints.contactTitle);
  const contactCountry = readString(normalizedRow.contactCountry) ?? readString(hints.contactCountry);
  const companyCountry = readString(normalizedRow.companyCountry) ?? readString(hints.companyCountry);
  // Country for phone normalization + the CSV's own email-validation verdict — both previously ignored.
  const phoneCountry = contactCountry ?? companyCountry;
  const emailValidation = readString(normalizedRow.contactEmailValidation) ?? readString(hints.contactEmailValidation);
  const city = readString(normalizedRow.contactCity) ?? readString(hints.contactCity);
  const department = readString(normalizedRow.department) ?? readString(hints.contactDepartment);
  const seniority = readString(normalizedRow.seniority) ?? readString(hints.contactSeniority);

  return {
    email: rawEmail ? rawEmail.toLowerCase() : null,
    name: computedName,
    firstName,
    lastName,
    title,
    linkedinUrl: rawLinkedin,
    phone: rawPhone,
    phoneCountry: phoneCountry ?? null,
    emailValidation: emailValidation ?? null,
    city: city ?? null,
    country: contactCountry ?? null,
    department: department ?? null,
    seniority: seniority ?? null,
  };
}

// Merge a row's email/phone/linkedin identifiers onto a contact via the single shared writer. Called
// both when a contact is newly created AND when it already exists (matched by id/email/linkedin) — the
// latter was the bug where re-uploading a file to add emails to known contacts did nothing (C-1).
// Idempotent: the shared helper upserts on (org, contact, type, normalizedValue).
async function mergeContactIdentifiers(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    contactId: string;
    email: string | null;
    emailValidation: string | null;
    linkedinUrl: string | null;
    phone: string | null;
    phoneCountry: string | null;
  }
): Promise<void> {
  if (input.email) {
    await upsertContactIdentifier(db, {
      organizationId: input.organizationId, contactId: input.contactId, type: "EMAIL",
      rawValue: input.email, validityStatus: csvEmailValidationToStatus(input.emailValidation),
      source: "INGESTION",
    });
  }
  if (input.linkedinUrl) {
    // Shape-check keeps a malformed / company-page LinkedIn out of the "usable" filters.
    const access = assessLinkedInAccess({ url: input.linkedinUrl });
    const linkedinStatus: ContactIdentifierValidity = access === "MALFORMED" ? "INVALID" : "UNKNOWN";
    await upsertContactIdentifier(db, {
      organizationId: input.organizationId, contactId: input.contactId, type: "LINKEDIN",
      rawValue: input.linkedinUrl, validityStatus: linkedinStatus, isGeneric: false, source: "INGESTION",
    });
  }
  if (input.phone) {
    await upsertContactIdentifier(db, {
      organizationId: input.organizationId, contactId: input.contactId, type: "PHONE",
      rawValue: input.phone, source: "INGESTION",
      defaultPhoneCountry: countryNameToIso(input.phoneCountry),
    });
  }
}

async function createOrReuseContactFromNoneRow(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    email: string | null;
    name: string;
    firstName: string | null;
    lastName: string | null;
    title: string | null;
    linkedinUrl: string | null;
    phone: string | null;
    phoneCountry: string | null;
    emailValidation: string | null;
    city?: string | null;
    country?: string | null;
    department?: string | null;
    seniority?: string | null;
  }
) {
  const mergeInput = {
    organizationId: input.organizationId,
    email: input.email,
    emailValidation: input.emailValidation,
    linkedinUrl: input.linkedinUrl,
    phone: input.phone,
    phoneCountry: input.phoneCountry,
  };

  // Reuse an existing contact matched by email or linkedin — but still MERGE the row's other
  // identifiers onto it (previously the early return dropped a new phone/email for a known contact).
  const existingId = await findContactIdByIdentifier(db, input.organizationId, input.email, input.linkedinUrl);
  if (existingId) {
    await backfillContactTitle(db, input.organizationId, existingId, input.title);
    await backfillContactDescriptive(db, input.organizationId, existingId, input);
    await mergeContactIdentifiers(db, { ...mergeInput, contactId: existingId });
    return existingId;
  }

  const contactId = createContactId();

  await db.$queryRaw`
    INSERT INTO "V2Contact" (
      "id", "organizationId", "fullName", "firstName", "lastName", "title",
      "city", "country", "department", "seniority", "status", "createdAt", "updatedAt"
    ) VALUES (
      ${contactId},
      ${input.organizationId},
      ${input.name},
      ${input.firstName},
      ${input.lastName},
      ${input.title},
      ${input.city ?? null},
      ${input.country ?? null},
      ${input.department ?? null},
      ${input.seniority ?? null},
      'ACTIVE',
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;

  await mergeContactIdentifiers(db, { ...mergeInput, contactId });

  return contactId;
}

function createContactId() {
  return `cnt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** First contact id matching the row's email or linkedin identifier, or null. */
async function findContactIdByIdentifier(
  db: V2IngestionDatabase,
  organizationId: string,
  email: string | null,
  linkedinUrl: string | null
): Promise<string | null> {
  if (email) {
    const rows = await db.$queryRaw<{ contactId: string }[]>`
      SELECT "contactId" FROM "V2ContactIdentifier"
      WHERE "organizationId" = ${organizationId} AND "type" = 'EMAIL' AND "normalizedValue" = ${email}
      LIMIT 1
    `;
    if (rows[0]) return rows[0].contactId;
  }
  if (linkedinUrl) {
    const rows = await db.$queryRaw<{ contactId: string }[]>`
      SELECT "contactId" FROM "V2ContactIdentifier"
      WHERE "organizationId" = ${organizationId} AND "type" = 'LINKEDIN' AND "normalizedValue" = ${linkedinUrl}
      LIMIT 1
    `;
    if (rows[0]) return rows[0].contactId;
  }
  return null;
}

/** Fill a contact's title from an upload only when it is currently empty (never clobber). */
async function backfillContactTitle(
  db: V2IngestionDatabase,
  organizationId: string,
  contactId: string,
  title: string | null
): Promise<void> {
  if (!title) return;
  await db.$executeRaw`
    UPDATE "V2Contact" SET "title" = ${title}, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${contactId} AND "organizationId" = ${organizationId}
      AND ("title" IS NULL OR "title" = '')
  `;
}

/** Fill an existing contact's descriptive fields (city/country/department/seniority) only where empty. */
async function backfillContactDescriptive(
  db: V2IngestionDatabase,
  organizationId: string,
  contactId: string,
  input: { city?: string | null; country?: string | null; department?: string | null; seniority?: string | null }
): Promise<void> {
  if (!input.city && !input.country && !input.department && !input.seniority) return;
  await db.$executeRaw`
    UPDATE "V2Contact" SET
      "city" = COALESCE("city", ${input.city ?? null}),
      "country" = COALESCE("country", ${input.country ?? null}),
      "department" = COALESCE("department", ${input.department ?? null}),
      "seniority" = COALESCE("seniority", ${input.seniority ?? null}),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${contactId} AND "organizationId" = ${organizationId}
  `;
}
