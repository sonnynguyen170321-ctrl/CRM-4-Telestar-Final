import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { prisma } from "@/lib/server/prisma";
import { createIngestionJob, type V2IngestionDatabase } from "@/lib/v2/ingestion";
import {
  detectSpreadsheet,
  extractSheetToCsv,
  isSpreadsheetFileName,
  isSpreadsheetMimeType,
  SpreadsheetError,
} from "@telestar/core-ingest/parseSpreadsheet";
import { sanitizeDisplayHeaders } from "@telestar/core-ingest/headers";
import { requirePermission, V2TenantError } from "@/lib/v2/tenant";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const PREVIEW_ROW_LIMIT = 5;

type SpreadsheetIntake = {
  schemaVersion: "v2.ingestion.spreadsheet-intake.v1";
  selectedSheet: string;
  headerRow: number;
  availableSheets: Array<{ name: string; rowCount: number }>;
};

type ExistingIngestionJobRow = {
  id: string;
  mappingJson: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const tenantContext = await requirePermission("ingestion.apply");
    const formData = await request.formData();
    const file = formData.get("file");
    const clientRequestId = getFormString(formData, "clientRequestId");
    const clientAccountId = getFormString(formData, "clientAccountId");
    const projectId = getFormString(formData, "projectId");
    const icpVersionId = getFormString(formData, "icpVersionId");
    const jobTypeRaw = getFormString(formData, "jobType");
    const jobType = (jobTypeRaw === "CONTACT_UPLOAD" || jobTypeRaw === "ACTIVITY_RECAP")
      ? jobTypeRaw
      : "COMPANY_UPLOAD";

    if (!(file instanceof File)) {
      return ingestionJson(errorBody("UPLOAD_FILE_REQUIRED", "Upload one CSV or Excel file."), 400);
    }

    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return ingestionJson(
        errorBody("UPLOAD_FILE_SIZE_INVALID", "File is empty or exceeds the upload size limit."),
        400
      );
    }

    const isSpreadsheet = isSpreadsheetFileName(file.name) || isSpreadsheetMimeType(file.type);

    if (!isSpreadsheet && !isCsvFile(file)) {
      return ingestionJson(
        errorBody("UPLOAD_FILE_UNSUPPORTED", "Only CSV (.csv) or Excel (.xlsx) uploads are supported."),
        400
      );
    }

    // Resolve the upload to canonical CSV text. Excel uploads run a detect phase first:
    // with no chosen sheet/header row we return the auto-detected sheets + headers so the
    // wizard can render step 2; once the user confirms, we render the chosen sheet to CSV.
    let csvText: string;
    let spreadsheetIntake: SpreadsheetIntake | undefined;

    if (isSpreadsheet) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const selectedSheet = getFormString(formData, "selectedSheet");
      const headerRowRaw = getFormString(formData, "headerRow");

      if (!selectedSheet || headerRowRaw === null) {
        try {
          const detection = detectSpreadsheet(buffer, selectedSheet);
          return ingestionJson({
            ok: true,
            code: "SPREADSHEET_DETECTED",
            sheets: detection.sheets,
            selectedSheet: detection.selectedSheet,
            headerRow: detection.headerRow,
            headers: detection.headers,
            previewRows: detection.previewRows,
          });
        } catch (error) {
          return handleSpreadsheetError(error);
        }
      }

      const headerRow = Number.parseInt(headerRowRaw, 10);

      if (!Number.isInteger(headerRow) || headerRow < 0) {
        return ingestionJson(errorBody("SPREADSHEET_HEADER_ROW_INVALID", "Header row must be a non-negative integer."), 400);
      }

      try {
        const extraction = extractSheetToCsv(buffer, { selectedSheet, headerRow });
        const detection = detectSpreadsheet(buffer, selectedSheet);
        csvText = extraction.csvText;
        spreadsheetIntake = {
          schemaVersion: "v2.ingestion.spreadsheet-intake.v1",
          selectedSheet: extraction.selectedSheet,
          headerRow: extraction.headerRow,
          availableSheets: detection.sheets.map((sheet) => ({
            name: sheet.name,
            rowCount: sheet.rowCount,
          })),
        };
      } catch (error) {
        return handleSpreadsheetError(error);
      }
    } else {
      csvText = stripBom(await file.text());
    }

    // Job creation requires the full tenant context.
    if (!clientRequestId || !clientAccountId || !projectId || !icpVersionId) {
      return ingestionJson(
        errorBody("INGESTION_CONTEXT_REQUIRED", "Account, Project, ICP, and request id are required."),
        400
      );
    }

    const contextOk = await validateContext({
      organizationId: tenantContext.organizationId,
      clientAccountId,
      projectId,
      icpVersionId,
    });

    if (!contextOk) {
      return ingestionJson(
        errorBody("INGESTION_CONTEXT_NOT_FOUND", "Selected Account, Project, and ICP do not belong to this organization."),
        404
      );
    }

    const parsed = parseCsvPreview(csvText);

    if (!parsed.ok) {
      return ingestionJson(errorBody(parsed.code, parsed.message), 400);
    }

    const sourceFileStorageKey = buildSourceFileStorageKey({
      organizationId: tenantContext.organizationId,
      clientRequestId,
      projectId,
      icpVersionId,
    });
    const fileHash = stableHash(csvText);
    const headerHash = stableHash(JSON.stringify(parsed.headers));
    const existing = await findExistingIngestionJob({
      organizationId: tenantContext.organizationId,
      sourceFileStorageKey,
    });

    if (existing) {
      const existingIntake = readUploadIntake(existing.mappingJson);

      if (
        existingIntake?.fileHash !== fileHash ||
        existingIntake?.headerHash !== headerHash
      ) {
        return ingestionJson(
          errorBody("INGESTION_UPLOAD_CONFLICT", "This upload request id was already used for a different file."),
          409
        );
      }

      return ingestionJson({
        ok: true,
        code: "INGESTION_JOB_EXISTS",
        ingestionJobId: existing.id,
        headers: parsed.headers,
        previewRows: parsed.previewRows,
        links: buildLinks(existing.id),
      });
    }

    const created = await createIngestionJob(prisma as unknown as V2IngestionDatabase, {
      organizationId: tenantContext.organizationId,
      projectId,
      icpVersionId,
      uploadedByUserId: tenantContext.userId,
      runMode: "manual_mapping",
      clientRequestId,
      sourceFileStorageKey,
      fileHash,
      headerHash,
      headers: parsed.headers,
      previewRows: parsed.previewRows,
      fileSizeBytes: file.size,
      originalFileName: file.name,
      csvText,
      spreadsheetIntake,
      importProfileSuggestion: jobType === "CONTACT_UPLOAD" ? "contact_upload" : (jobType === "ACTIVITY_RECAP" ? "activity_event" : "company_upload"),
    });

    return ingestionJson({
      ok: true,
      code: "INGESTION_JOB_CREATED",
      ingestionJobId: created.ingestionJobId,
      enqueueResult: created.enqueueResult.kind,
      headers: parsed.headers,
      previewRows: parsed.previewRows,
      links: buildLinks(created.ingestionJobId),
    });
  } catch (error) {
    return handleIngestionError(error, "INGESTION_UPLOAD_FAILED");
  }
}

async function validateContext(input: {
  organizationId: string;
  clientAccountId: string;
  projectId: string;
  icpVersionId: string;
}) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT icp."id"
    FROM "V2ClientAccount" account
    INNER JOIN "V2Project" project
      ON project."clientAccountId" = account."id"
      AND project."organizationId" = account."organizationId"
      AND project."status" = 'ACTIVE'
    INNER JOIN "V2Offer" offer
      ON offer."projectId" = project."id"
      AND offer."organizationId" = account."organizationId"
      AND offer."status" = 'ACTIVE'
    INNER JOIN "V2ICPProfile" profile
      ON profile."offerId" = offer."id"
      AND profile."organizationId" = account."organizationId"
      AND profile."status" = 'ACTIVE'
    INNER JOIN "V2ICPVersion" icp
      ON icp."icpProfileId" = profile."id"
      AND icp."organizationId" = account."organizationId"
      AND icp."status" = 'PUBLISHED'
      AND icp."deletedAt" IS NULL
      AND icp."rulesJson" IS NOT NULL
    WHERE account."organizationId" = ${input.organizationId}
      AND account."id" = ${input.clientAccountId}
      AND account."status" = 'ACTIVE'
      AND project."id" = ${input.projectId}
      AND icp."id" = ${input.icpVersionId}
    LIMIT 1
  `;

  return Boolean(rows[0]);
}

async function findExistingIngestionJob(input: {
  organizationId: string;
  sourceFileStorageKey: string;
}) {
  const rows = await prisma.$queryRaw<ExistingIngestionJobRow[]>`
    SELECT "id", "mappingJson"
    FROM "V2IngestionJob"
    WHERE "organizationId" = ${input.organizationId}
      AND "sourceFileStorageKey" = ${input.sourceFileStorageKey}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;

  return rows[0] ?? null;
}

function parseCsvPreview(csvText: string):
  | { ok: true; headers: string[]; previewRows: Array<Record<string, string>> }
  | { ok: false; code: string; message: string } {
  if (!csvText.trim()) {
    return { ok: false, code: "CSV_EMPTY", message: "CSV file is empty." };
  }

  const rows = csvText
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  const rawHeaders = rows[0] ? splitCsvLine(rows[0]).map((field) => field.trim()) : [];

  if (rawHeaders.length === 0) {
    return { ok: false, code: "CSV_PARSE_FAILED", message: "CSV headers could not be parsed." };
  }

  // Real SDR exports carry blank + repeated header cells. Sanitize them (blank -> Column N,
  // duplicate -> Name (2)) instead of rejecting — the downstream parser dedupes the same
  // way, so mapping still resolves to the right column.
  const headers = sanitizeDisplayHeaders(rawHeaders);

  if (rows.length <= 1) {
    return { ok: false, code: "CSV_EMPTY", message: "CSV contains no data rows." };
  }

  return {
    ok: true,
    headers,
    previewRows: rows.slice(1, PREVIEW_ROW_LIMIT + 1).map((line) => {
      const values = splitCsvLine(line);
      const previewRow: Record<string, string> = {};

      for (let index = 0; index < headers.length; index += 1) {
        previewRow[headers[index]] = values[index] ?? "";
      }

      return previewRow;
    }),
  };
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());

  return values;
}

function readUploadIntake(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const uploadIntake = (value as { uploadIntake?: unknown }).uploadIntake;

  if (!uploadIntake || typeof uploadIntake !== "object" || Array.isArray(uploadIntake)) {
    return null;
  }

  return uploadIntake as { fileHash?: unknown; headerHash?: unknown };
}

function isCsvFile(file: File) {
  return (
    file.name.toLowerCase().endsWith(".csv") ||
    file.type === "text/csv" ||
    file.type === "application/vnd.ms-excel"
  );
}

function getFormString(formData: FormData, key: string) {
  const value = formData.get(key);

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildSourceFileStorageKey(input: {
  organizationId: string;
  clientRequestId: string;
  projectId: string;
  icpVersionId: string;
}) {
  return [
    "v2-upload",
    input.organizationId,
    input.projectId,
    input.icpVersionId,
    input.clientRequestId,
  ].join(":");
}

function buildLinks(ingestionJobId: string) {
  return {
    ingestion: `/v2/ingestion/${ingestionJobId}`,
    status: `/v2/ingestion/${ingestionJobId}/status`,
    mapping: `/v2/ingestion/${ingestionJobId}/mapping`,
    leads: "/v2/workspace/leads",
  };
}

function errorBody(code: string, message: string) {
  return { ok: false, code, message };
}

function handleSpreadsheetError(error: unknown) {
  if (error instanceof SpreadsheetError) {
    return ingestionJson(errorBody(error.code, error.message), 400);
  }

  console.error("SPREADSHEET_PARSE_FAILED", error);

  return ingestionJson(
    errorBody("SPREADSHEET_PARSE_FAILED", "The Excel file could not be read. Re-save it as .xlsx and try again."),
    400
  );
}

function handleIngestionError(error: unknown, code: string) {
  if (error instanceof V2TenantError) {
    return ingestionJson(
      errorBody(error.code === "UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN", "You do not have permission to upload ingestion files."),
      error.code === "UNAUTHENTICATED" ? 401 : 403
    );
  }

  console.error(code, error);

  return ingestionJson(errorBody(code, "Ingestion request failed."), 500);
}

function ingestionJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
