import { createNonRetryableJobError, createRetryableJobError } from "../jobs/errors";
import type { V2JobHandler } from "../jobs/types";
import { resolveIdentity, type NormalizedIdentityRow } from "../identity";
import {
  enqueueIngestionIdentityMatchJob,
  enqueueIngestionNormalizeJob,
  enqueueLeadAssignmentUpsertJob,
} from "./enqueueIngestionJobs";
import { parseCsvRows } from "./parseCsvRows";
import { normalizeHeaderName } from "./hash";
import { persistIngestionRows } from "./persistIngestionRows";
import { validateIngestionRow } from "./validateIngestionRow";
import {
  DEFAULT_DB_BATCH_SIZE,
  DEFAULT_MAX_CSV_ROWS,
  V2IngestionMappingContextSchema,
  type V2IngestionDatabase,
  type V2IngestionErrorSummary,
  type V2ImportProfile,
  type V2RowCountSummary,
} from "./types";
import { classifyImportProfile } from "./classifyImportProfile";

type IngestionJobRecord = {
  id: string;
  organizationId: string;
  uploadedByUserId: string | null;
  originalFileName: string;
  projectId: string | null;
  mappingJson: unknown;
};

type IngestionRowRecord = {
  id: string;
  rawRowJson: Record<string, unknown>;
  validationErrorsJson: unknown;
};

type IdentityMatchIngestionRowRecord = {
  id: string;
  rawRowJson: Record<string, unknown>;
  normalizedRowJson: unknown;
};

type IdentityCompanyRow = {
  id: string;
  organizationId: string;
  name: string;
  nameNormalized: string;
  canonicalDomain: string | null;
  websiteUrl: string | null;
};

type IdentityContactRow = {
  id: string;
  organizationId: string;
  companyId: string | null;
  email: string | null;
  linkedinUrl: string | null;
  isGeneric: boolean | null;
};

export const parseIngestionJobHandler: V2JobHandler = async (context) => {
  const payload = parseParsePayload(context.payload);
  const ingestionJobId = context.job.sourceId ?? payload.ingestionJobId;

  if (!ingestionJobId || ingestionJobId !== payload.ingestionJobId) {
    throw createNonRetryableJobError(
      "INGESTION_SOURCE_MISMATCH",
      "INGESTION_PARSE job sourceId must match payload ingestionJobId."
    );
  }

  // The upload route normalizes every supported format (CSV + Excel) to canonical CSV
  // text BEFORE enqueue, so the parse stage always receives CSV in `payload.csvText`
  // regardless of the original file extension. Guard on the payload, not the file name.
  if (typeof payload.csvText !== "string" || payload.csvText.trim() === "") {
    throw createNonRetryableJobError(
      "INGESTION_EMPTY_PAYLOAD",
      "INGESTION_PARSE payload contained no CSV text."
    );
  }

  const ingestionJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });

  await setIngestionJobStatus(context.db, ingestionJobId, context.organizationId, "PROCESSING");

  const rowCounts: V2RowCountSummary = {
    totalRows: 0,
    persistedRows: 0,
    duplicateRows: 0,
    skippedRows: 0,
    rawRows: 0,
    normalizedRows: 0,
    errorRows: 0,
  };
  const errorSummary: V2IngestionErrorSummary = {
    fatal: false,
    code: null,
    message: null,
    warnings: [],
    parseErrors: 0,
    validationErrors: 0,
    invalidThresholdExceeded: false,
    stoppedEarly: false,
  };

  const parseResult = await parseCsvRows({
    csvText: payload.csvText,
    maxRows: DEFAULT_MAX_CSV_ROWS,
    onRows: async (rows) => {
      const result = await persistIngestionRows(context.db, {
        organizationId: context.organizationId,
        jobId: ingestionJobId,
        rows,
        batchSize: DEFAULT_DB_BATCH_SIZE,
      });
      rowCounts.totalRows += result.attemptedRows;
      rowCounts.persistedRows += result.insertedRows;
      rowCounts.duplicateRows += result.duplicateRows;
      rowCounts.errorRows += result.errorRows;
      errorSummary.parseErrors += result.errorRows;
      await context.updateProgress({
        current: rowCounts.totalRows,
      });
    },
  });

  if (parseResult.maxRowsExceeded) {
    errorSummary.fatal = true;
    errorSummary.code = "MAX_ROWS_EXCEEDED";
    errorSummary.message = `CSV row cap exceeded at ${DEFAULT_MAX_CSV_ROWS} rows.`;
    await updateIngestionJobSummaries(context.db, {
      organizationId: context.organizationId,
      ingestionJobId,
      status: "FAILED",
      rowCounts,
      errorSummary,
      mappingJson: ingestionJob.mappingJson,
    });
    throw createNonRetryableJobError("MAX_ROWS_EXCEEDED", errorSummary.message);
  }

  rowCounts.skippedRows = parseResult.blankRows;
  rowCounts.rawRows = Math.max(rowCounts.persistedRows - rowCounts.errorRows, 0);
  errorSummary.parseErrors = parseResult.parseErrors + rowCounts.errorRows;

  const mappingJson = updateMappingContext(ingestionJob.mappingJson, {
    headers: parseResult.headers,
    rowCounts,
  });
  await updateIngestionJobSummaries(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
    status: "VALIDATING",
    rowCounts,
    errorSummary,
    mappingJson,
  });
  const updatedIngestionJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });
  const runMode = readRunMode(updatedIngestionJob.mappingJson);
  const hasColumnMapping = !!(
    updatedIngestionJob.mappingJson &&
    typeof updatedIngestionJob.mappingJson === "object" &&
    "columnMapping" in updatedIngestionJob.mappingJson &&
    updatedIngestionJob.mappingJson.columnMapping
  );

  const normalizeEnqueue =
    runMode === "manual_mapping" && !hasColumnMapping
      ? null
      : await enqueueIngestionNormalizeJob(context.db, {
          organizationId: context.organizationId,
          ingestionJobId,
          createdByUserId: ingestionJob.uploadedByUserId,
        });

  return {
    resultSnapshotJson: {
      ingestionJobId,
      parseResult,
      rowCounts,
      errorSummary,
      normalizeJob: normalizeEnqueue?.kind ?? null,
      mappingRequired: runMode === "manual_mapping",
    },
    progressCurrent: rowCounts.totalRows,
    progressTotal: rowCounts.totalRows,
  };
};

export const normalizeIngestionJobHandler: V2JobHandler = async (context) => {
  const payload = parseNormalizePayload(context.payload);
  const ingestionJobId = context.job.sourceId ?? payload.ingestionJobId;

  if (!ingestionJobId || ingestionJobId !== payload.ingestionJobId) {
    throw createNonRetryableJobError(
      "INGESTION_SOURCE_MISMATCH",
      "INGESTION_NORMALIZE job sourceId must match payload ingestionJobId."
    );
  }

  const ingestionJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });

  const parseJob = await context.db.$queryRaw<{ status: string }[]>`
    SELECT status FROM "V2Job"
    WHERE "organizationId" = ${context.organizationId}
      AND "sourceId" = ${ingestionJobId}
      AND "jobType" = 'INGESTION_PARSE'
    LIMIT 1
  `;

  if (parseJob.length > 0 && parseJob[0].status !== "SUCCEEDED" && parseJob[0].status !== "VALIDATED_WITH_ERRORS") {
    throw createRetryableJobError(
      "WAITING_FOR_PARSE",
      "Parse job is not finished yet, cannot normalize."
    );
  }

  await setIngestionJobStatus(context.db, ingestionJobId, context.organizationId, "VALIDATING");

  let processedRows = 0;
  let errorRows = 0;
  let consecutiveInvalidRows = 0;
  let stoppedEarly = false;
  const profileCounts = new Map<V2ImportProfile, number>();

  while (!stoppedEarly) {
    const rows = await context.db.$queryRaw<IngestionRowRecord[]>`
      SELECT "id", "rawRowJson", "validationErrorsJson"
      FROM "V2IngestionRow"
      WHERE "organizationId" = ${context.organizationId}
        AND "jobId" = ${ingestionJobId}
        AND "rowStatus" = 'RAW'
      ORDER BY "sourceRowNumber" ASC
      LIMIT ${DEFAULT_DB_BATCH_SIZE}
    `;

    if (rows.length === 0) {
      console.log("NORMALIZE ROWS FETCHED: 0. Breaking loop.");
      break;
    }
    console.log("NORMALIZE ROWS FETCHED:", rows.length);

    // No wrapping transaction: a full batch of validate + UPDATE can exceed Prisma's 5s
    // interactive-transaction cap on larger files. Each row UPDATE is independent and
    // idempotent (the SELECT only re-fetches RAW rows), so a partial batch resumes on re-run.
    for (const row of rows) {
      const mappedRawRowJson = applyColumnMapping(
        row.rawRowJson,
        ingestionJob.mappingJson
      );
      const headers = Object.keys(mappedRawRowJson);
      const validation = validateIngestionRow({
        headers,
        rawRowJson: mappedRawRowJson,
      });
      const nextStatus = validation.ok ? "NORMALIZED" : "ERROR";
      const errors = validation.ok ? [] : validation.errors;
      processedRows += 1;

      if (validation.ok) {
        consecutiveInvalidRows = 0;
      } else {
        errorRows += 1;
        consecutiveInvalidRows += 1;
      }

      profileCounts.set(
        validation.importProfile,
        (profileCounts.get(validation.importProfile) ?? 0) + 1
      );

      await context.db.$queryRaw`
        UPDATE "V2IngestionRow"
        SET
          "rowStatus" = ${nextStatus}::"V2IngestionRowStatus",
          "normalizedRowJson" = ${JSON.stringify(validation.normalizedRowJson)}::jsonb,
          "validationErrorsJson" = ${JSON.stringify(errors)}::jsonb,
          "errorMessage" = ${errors[0] ?? null}
        WHERE "id" = ${row.id}
          AND "organizationId" = ${context.organizationId}
          AND "jobId" = ${ingestionJobId}
      `;
    }

    await context.updateProgress({ current: processedRows });

    if (processedRows >= 100 && errorRows / processedRows > 0.1) {
      stoppedEarly = true;
    }

    if (consecutiveInvalidRows >= 100) {
      stoppedEarly = true;
    }
  }

  const existingCounts = await countRows(context.db, context.organizationId, ingestionJobId);
  const invalidThresholdExceeded = processedRows >= 100 && errorRows / processedRows > 0.1;
  const finalStatus =
    invalidThresholdExceeded || stoppedEarly || existingCounts.errorRows > 0
      ? "VALIDATED_WITH_ERRORS"
      : "COMPLETED";
  const rowCounts: V2RowCountSummary = {
    totalRows: existingCounts.totalRows,
    persistedRows: existingCounts.totalRows,
    duplicateRows: 0,
    skippedRows: 0,
    rawRows: existingCounts.rawRows,
    normalizedRows: existingCounts.normalizedRows,
    errorRows: existingCounts.errorRows,
  };
  const errorSummary: V2IngestionErrorSummary = {
    fatal: false,
    code: invalidThresholdExceeded ? "INVALID_THRESHOLD_EXCEEDED" : null,
    message: invalidThresholdExceeded
      ? "Invalid rows exceeded 10% after at least 100 processed rows."
      : null,
    warnings: stoppedEarly ? ["normalization_stopped_early"] : [],
    parseErrors: 0,
    validationErrors: existingCounts.errorRows,
    invalidThresholdExceeded,
    stoppedEarly,
  };
  const dominantProfile = getDominantProfile(profileCounts);
  const currentJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });
  const mappingJson = updateMappingContext(currentJob.mappingJson, {
    rowCounts,
    importProfileSuggestion: dominantProfile,
  });

  await updateIngestionJobSummaries(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
    status: finalStatus,
    rowCounts,
    errorSummary,
    mappingJson,
  });
  const identityMatchEnqueue = await enqueueIngestionIdentityMatchJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
    createdByUserId: ingestionJob.uploadedByUserId,
  });

  return {
    resultSnapshotJson: {
      ingestionJobId,
      rowCounts,
      errorSummary,
      importProfileSuggestion: dominantProfile,
      downstreamJobsEnqueued: [
        {
          jobType: "IDENTITY_MATCH",
          result: identityMatchEnqueue.kind,
        },
      ],
    },
    progressCurrent: processedRows,
    progressTotal: processedRows,
  };
};

export const identityMatchIngestionJobHandler: V2JobHandler = async (context) => {
  const payload = parseIdentityMatchPayload(context.payload);
  const ingestionJobId = context.job.sourceId ?? payload.ingestionJobId;

  if (!ingestionJobId || ingestionJobId !== payload.ingestionJobId) {
    throw createNonRetryableJobError(
      "INGESTION_SOURCE_MISMATCH",
      "IDENTITY_MATCH job sourceId must match payload ingestionJobId."
    );
  }

  const ingestionJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });
  const candidates = await loadIdentityCandidates(context.db, {
    organizationId: context.organizationId,
    projectId: ingestionJob.projectId,
  });
  let processedRows = 0;
  let matchedRows = 0;
  let candidateRows = 0;
  let noneRows = 0;
  let errorRows = 0;

  while (true) {
    const rows = await context.db.$queryRaw<IdentityMatchIngestionRowRecord[]>`
      SELECT "id", "rawRowJson", "normalizedRowJson"
      FROM "V2IngestionRow"
      WHERE "organizationId" = ${context.organizationId}
        AND "jobId" = ${ingestionJobId}
        AND "rowStatus" = 'NORMALIZED'
        AND (
          "normalizedRowJson" IS NULL
          OR ("normalizedRowJson"::jsonb ? 'identityMatch') = FALSE
        )
      ORDER BY "sourceRowNumber" ASC
      LIMIT ${DEFAULT_DB_BATCH_SIZE}
    `;

    if (rows.length === 0) {
      break;
    }

    // No wrapping transaction: resolveIdentity (fuzzy bigram over every candidate) is
    // CPU-heavy, and a full batch blew past Prisma's 5s interactive-transaction cap
    // ("expired transaction"). Each row UPDATE is independent and idempotent -- the SELECT
    // only re-fetches rows still NORMALIZED without an identityMatch -- so a partial batch
    // resumes safely on re-run.
    for (const row of rows) {
      try {
        const normalizedRow = normalizeJsonObject(row.normalizedRowJson);
        const identityRow = buildIdentityRow(row.rawRowJson, normalizedRow);
        const resolution = resolveIdentity({
          row: identityRow,
          context: {
            organizationId: context.organizationId,
          },
          candidates,
        });
        const identityMatch = {
          schemaVersion: "v2.ingestion.identity-match.v1",
          kind: resolution.kind,
          confidence: resolution.confidence,
          reasons: resolution.reasons,
          companyId: resolution.companyId ?? null,
          contactId: resolution.contactId ?? null,
        };
        const nextNormalizedRow = {
          ...normalizedRow,
          identityMatch,
        };
        const nextStatus =
          resolution.kind === "exact_company" || resolution.kind === "exact_contact"
            ? "MATCHED"
            : "NORMALIZED";

        if (nextStatus === "MATCHED") {
          matchedRows += 1;
        } else if (resolution.kind === "candidate") {
          candidateRows += 1;
        } else {
          noneRows += 1;
        }

        await context.db.$queryRaw`
          UPDATE "V2IngestionRow"
          SET
            "rowStatus" = ${nextStatus}::"V2IngestionRowStatus",
            "normalizedRowJson" = ${JSON.stringify(nextNormalizedRow)}::jsonb,
            "matchedCompanyId" = ${nextStatus === "MATCHED" ? resolution.companyId ?? null : null},
            "matchedContactId" = ${nextStatus === "MATCHED" ? resolution.contactId ?? null : null},
            "errorMessage" = NULL
          WHERE "id" = ${row.id}
            AND "organizationId" = ${context.organizationId}
            AND "jobId" = ${ingestionJobId}
        `;
      } catch (error) {
        errorRows += 1;
        await context.db.$queryRaw`
          UPDATE "V2IngestionRow"
          SET
            "rowStatus" = 'ERROR',
            "matchedCompanyId" = NULL,
            "matchedContactId" = NULL,
            "errorMessage" = ${error instanceof Error ? error.message : "identity_match_failed"}
          WHERE "id" = ${row.id}
            AND "organizationId" = ${context.organizationId}
            AND "jobId" = ${ingestionJobId}
        `;
      }

      processedRows += 1;
    }

    await context.updateProgress({ current: processedRows });
  }

  const counts = await countRows(context.db, context.organizationId, ingestionJobId);
  const rowCounts: V2RowCountSummary = {
    totalRows: counts.totalRows,
    persistedRows: counts.totalRows,
    duplicateRows: 0,
    skippedRows: 0,
    rawRows: counts.rawRows,
    normalizedRows: counts.normalizedRows,
    errorRows: counts.errorRows,
  };
  const currentJob = await loadIngestionJob(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
  });
  const errorSummary: V2IngestionErrorSummary = {
    fatal: false,
    code: counts.errorRows > 0 ? "INGESTION_ROWS_REQUIRE_REVIEW" : null,
    message: counts.errorRows > 0 ? "Some ingestion rows require review." : null,
    warnings: candidateRows > 0 || noneRows > 0 ? ["identity_match_reviewable_rows"] : [],
    parseErrors: 0,
    validationErrors: counts.errorRows,
    invalidThresholdExceeded: false,
    stoppedEarly: false,
  };

  await updateIngestionJobSummaries(context.db, {
    organizationId: context.organizationId,
    ingestionJobId,
    status: counts.errorRows > 0 ? "VALIDATED_WITH_ERRORS" : "COMPLETED",
    rowCounts,
    errorSummary,
    mappingJson: currentJob.mappingJson,
  });
  const leadAssignmentUpsertEnqueue = await enqueueLeadAssignmentUpsertJob(
    context.db,
    {
      organizationId: context.organizationId,
      ingestionJobId,
      createdByUserId: ingestionJob.uploadedByUserId,
    }
  );

  return {
    resultSnapshotJson: {
      ingestionJobId,
      matchedRows,
      candidateRows,
      noneRows,
      errorRows,
      processedRows,
      rowCounts,
      downstreamJobsEnqueued: [
        {
          jobType: "LEAD_ASSIGNMENT_UPSERT",
          result: leadAssignmentUpsertEnqueue.kind,
        },
      ],
    },
    progressCurrent: processedRows,
    progressTotal: processedRows,
  };
};

async function loadIngestionJob(
  db: V2IngestionDatabase,
  input: { organizationId: string; ingestionJobId: string }
) {
  const rows = await db.$queryRaw<IngestionJobRecord[]>`
    SELECT "id", "organizationId", "uploadedByUserId", "originalFileName", "projectId", "mappingJson"
    FROM "V2IngestionJob"
    WHERE "id" = ${input.ingestionJobId}
      AND "organizationId" = ${input.organizationId}
    LIMIT 1
  `;

  if (!rows[0]) {
    throw createNonRetryableJobError(
      "INGESTION_JOB_NOT_FOUND",
      "V2 ingestion job was not found for the job tenant/source."
    );
  }

  return rows[0];
}

async function loadIdentityCandidates(
  db: V2IngestionDatabase,
  input: { organizationId: string; projectId: string | null }
) {
  const companies = await db.$queryRaw<IdentityCompanyRow[]>`
    SELECT "id", "organizationId", "name", "nameNormalized", "canonicalDomain", "websiteUrl"
    FROM "V2Company"
    WHERE "organizationId" = ${input.organizationId}
      AND "status" = 'ACTIVE'
      AND "deletedAt" IS NULL
    ORDER BY "createdAt" ASC, "id" ASC
  `;
  const contacts = await db.$queryRaw<IdentityContactRow[]>`
    SELECT DISTINCT
      c."id",
      c."organizationId",
      COALESCE(current_employment."companyId", current_lead."companyId") AS "companyId",
      MAX(CASE WHEN ci."type" = 'EMAIL' THEN ci."normalizedValue" ELSE NULL END) AS "email",
      MAX(CASE WHEN ci."type" = 'LINKEDIN' THEN ci."normalizedValue" ELSE NULL END) AS "linkedinUrl",
      BOOL_OR(CASE WHEN ci."type" = 'EMAIL' THEN ci."isGeneric" ELSE FALSE END) AS "isGeneric"
    FROM "V2Contact" c
    LEFT JOIN LATERAL (
      SELECT employment."companyId"
      FROM "V2ContactEmployment" employment
      INNER JOIN "V2Company" company
        ON company."id" = employment."companyId"
        AND company."organizationId" = employment."organizationId"
        AND company."status" = 'ACTIVE'
        AND company."deletedAt" IS NULL
      WHERE employment."organizationId" = c."organizationId"
        AND employment."contactId" = c."id"
        AND employment."isCurrent" = TRUE
      ORDER BY employment."updatedAt" DESC, employment."createdAt" DESC, employment."id" ASC
      LIMIT 1
    ) current_employment ON TRUE
    LEFT JOIN LATERAL (
      SELECT lead."companyId"
      FROM "V2LeadAssignment" lead
      INNER JOIN "V2Company" company
        ON company."id" = lead."companyId"
        AND company."organizationId" = lead."organizationId"
        AND company."status" = 'ACTIVE'
        AND company."deletedAt" IS NULL
      WHERE lead."organizationId" = c."organizationId"
        AND lead."contactId" = c."id"
        AND lead."status" = 'ACTIVE'
        AND lead."deletedAt" IS NULL
        AND (${input.projectId}::text IS NULL OR lead."projectId" = ${input.projectId})
      ORDER BY lead."updatedAt" DESC, lead."createdAt" DESC, lead."id" ASC
      LIMIT 1
    ) current_lead ON TRUE
    LEFT JOIN "V2ContactIdentifier" ci
      ON ci."contactId" = c."id"
      AND ci."organizationId" = c."organizationId"
      AND ci."isValid" = TRUE
    WHERE c."organizationId" = ${input.organizationId}
      AND c."status" = 'ACTIVE'
      AND c."deletedAt" IS NULL
    GROUP BY c."id", c."organizationId", current_employment."companyId", current_lead."companyId"
    ORDER BY c."id" ASC
  `;

  return {
    companies: companies.map((company) => ({
      id: company.id,
      organizationId: company.organizationId,
      canonicalDomain: company.canonicalDomain,
      website: company.websiteUrl,
      normalizedName: company.nameNormalized,
      displayName: company.name,
    })),
    contacts: contacts.map((contact) => ({
      id: contact.id,
      organizationId: contact.organizationId,
      companyId: contact.companyId ?? undefined,
      email: contact.email,
      normalizedEmail: contact.email,
      linkedinUrl: contact.linkedinUrl,
      normalizedLinkedinUrl: contact.linkedinUrl,
      isGenericEmail: contact.isGeneric === true,
    })),
  };
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function buildIdentityRow(
  rawRowJson: Record<string, unknown>,
  normalizedRowJson: Record<string, unknown>
): NormalizedIdentityRow {
  const hints = normalizeJsonObject(normalizedRowJson.hints);

  return {
    companyName:
      pickString(hints, ["companyName"]) ??
      pickString(rawRowJson, ["company", "company_name", "account_name"]),
    canonicalDomain: pickString(rawRowJson, ["domain", "canonical_domain"]),
    website:
      pickString(hints, ["website"]) ??
      pickString(rawRowJson, ["website", "company_website"]),
    contactEmail:
      pickString(hints, ["contactEmail"]) ??
      pickString(rawRowJson, ["email", "contact_email", "work_email"]),
    contactLinkedinUrl: pickString(rawRowJson, [
      "linkedin",
      "linkedin_url",
      "contact_linkedin",
      "contact_linkedin_url",
    ]),
  };
}

function pickString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = row[key];

    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return null;
}

async function setIngestionJobStatus(
  db: V2IngestionDatabase,
  ingestionJobId: string,
  organizationId: string,
  status: "PROCESSING" | "VALIDATING"
) {
  await db.$queryRaw`
    UPDATE "V2IngestionJob"
    SET "status" = ${status}::"V2IngestionJobStatus",
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${ingestionJobId}
      AND "organizationId" = ${organizationId}
  `;
}

async function updateIngestionJobSummaries(
  db: V2IngestionDatabase,
  input: {
    organizationId: string;
    ingestionJobId: string;
    status: "VALIDATING" | "VALIDATED_WITH_ERRORS" | "COMPLETED" | "FAILED";
    rowCounts: V2RowCountSummary;
    errorSummary: V2IngestionErrorSummary;
    mappingJson: unknown;
  }
) {
  await db.$queryRaw`
    UPDATE "V2IngestionJob"
    SET
      "status" = ${input.status}::"V2IngestionJobStatus",
      "rowCountsJson" = ${JSON.stringify(input.rowCounts)}::jsonb,
      "errorSummaryJson" = ${JSON.stringify(input.errorSummary)}::jsonb,
      "mappingJson" = ${JSON.stringify(input.mappingJson)}::jsonb,
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${input.ingestionJobId}
      AND "organizationId" = ${input.organizationId}
  `;
}

async function countRows(
  db: V2IngestionDatabase,
  organizationId: string,
  ingestionJobId: string
) {
  const rows = await db.$queryRaw<
    {
      totalRows: bigint;
      rawRows: bigint;
      normalizedRows: bigint;
      errorRows: bigint;
    }[]
  >`
    SELECT
      COUNT(*) AS "totalRows",
      COUNT(*) FILTER (WHERE "rowStatus" = 'RAW') AS "rawRows",
      COUNT(*) FILTER (WHERE "rowStatus" = 'NORMALIZED') AS "normalizedRows",
      COUNT(*) FILTER (WHERE "rowStatus" = 'ERROR') AS "errorRows"
    FROM "V2IngestionRow"
    WHERE "organizationId" = ${organizationId}
      AND "jobId" = ${ingestionJobId}
  `;
  const row = rows[0];

  return {
    totalRows: Number(row?.totalRows ?? 0),
    rawRows: Number(row?.rawRows ?? 0),
    normalizedRows: Number(row?.normalizedRows ?? 0),
    errorRows: Number(row?.errorRows ?? 0),
  };
}

function updateMappingContext(
  value: unknown,
  input: {
    headers?: string[];
    rowCounts: V2RowCountSummary;
    importProfileSuggestion?: V2ImportProfile | null;
  }
) {
  const parsed = V2IngestionMappingContextSchema.safeParse(value);
  const fallback = {
    schemaVersion: "v2.ingestion.mapping.v1" as const,
    originalFileName: "unknown.csv",
    importProfileSuggestion: "unknown_mixed" as const,
    importProfileConfidence: "low" as const,
    notes: [] as string[],
  };
  const current = parsed.success ? parsed.data : fallback;
  const importProfileSuggestion =
    input.importProfileSuggestion ??
    (input.headers
      ? classifyImportProfile({ headers: input.headers })
      : current.importProfileSuggestion);

  return V2IngestionMappingContextSchema.parse({
    ...current,
    importProfileSuggestion,
    importProfileConfidence:
      importProfileSuggestion === "unknown_mixed" ? "low" : "medium",
    validationSummary: {
      totalRows: input.rowCounts.totalRows,
      validRows: input.rowCounts.normalizedRows,
      invalidRows: input.rowCounts.errorRows,
      duplicateRows: input.rowCounts.duplicateRows,
      skippedRows: input.rowCounts.skippedRows,
    },
  });
}

function readRunMode(value: unknown) {
  const parsed = V2IngestionMappingContextSchema.safeParse(value);

  return parsed.success ? parsed.data.runMode : "auto_after_parse";
}

function applyColumnMapping(
  rawRowJson: Record<string, unknown>,
  mappingJson: unknown
) {
  const parsed = V2IngestionMappingContextSchema.safeParse(mappingJson);
  const columnMapping = parsed.success ? parsed.data.columnMapping : undefined;

  if (!columnMapping) {
    return rawRowJson;
  }

  const mapped: Record<string, unknown> = {};

  for (const [canonicalField, sourceHeader] of Object.entries(columnMapping.fields)) {
    const rawKey = sourceHeader ? resolveRawRowKey(rawRowJson, sourceHeader) : null;

    if (rawKey) {
      mapped[canonicalField] = rawRowJson[rawKey];
    }
  }

  return mapped;
}

function resolveRawRowKey(rawRowJson: Record<string, unknown>, sourceHeader: string) {
  if (Object.prototype.hasOwnProperty.call(rawRowJson, sourceHeader)) {
    return sourceHeader;
  }

  const normalized = normalizeHeaderName(sourceHeader);

  if (normalized && Object.prototype.hasOwnProperty.call(rawRowJson, normalized)) {
    return normalized;
  }

  return null;
}

function getDominantProfile(profileCounts: Map<V2ImportProfile, number>) {
  let selected: V2ImportProfile = "unknown_mixed";
  let selectedCount = 0;

  for (const [profile, count] of profileCounts) {
    if (count > selectedCount) {
      selected = profile;
      selectedCount = count;
    }
  }

  return selected;
}

function parseParsePayload(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      "v2.ingestion.parse-job.v1" ||
    typeof (value as { ingestionJobId?: unknown }).ingestionJobId !== "string" ||
    typeof (value as { originalFileName?: unknown }).originalFileName !== "string" ||
    typeof (value as { csvText?: unknown }).csvText !== "string"
  ) {
    throw createNonRetryableJobError(
      "INVALID_INGESTION_PARSE_PAYLOAD",
      "INGESTION_PARSE payload was invalid."
    );
  }

  return value as {
    schemaVersion: "v2.ingestion.parse-job.v1";
    ingestionJobId: string;
    originalFileName: string;
    csvText: string;
  };
}

function parseNormalizePayload(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      "v2.ingestion.normalize-job.v1" ||
    typeof (value as { ingestionJobId?: unknown }).ingestionJobId !== "string"
  ) {
    throw createNonRetryableJobError(
      "INVALID_INGESTION_NORMALIZE_PAYLOAD",
      "INGESTION_NORMALIZE payload was invalid."
    );
  }

  return value as {
    schemaVersion: "v2.ingestion.normalize-job.v1";
    ingestionJobId: string;
  };
}

function parseIdentityMatchPayload(value: unknown) {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      "v2.ingestion.identity-match-job.v1" ||
    typeof (value as { ingestionJobId?: unknown }).ingestionJobId !== "string"
  ) {
    throw createNonRetryableJobError(
      "INVALID_IDENTITY_MATCH_PAYLOAD",
      "IDENTITY_MATCH payload was invalid."
    );
  }

  return value as {
    schemaVersion: "v2.ingestion.identity-match-job.v1";
    ingestionJobId: string;
  };
}
