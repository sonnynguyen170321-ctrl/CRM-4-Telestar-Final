import {
  isCompanyTypeValue,
  isQualificationValue,
} from "@/lib/server/api/enums";
import { errorResponse, serverError } from "@/lib/server/api/responses";
import {
  getEnrichedCompanies,
  type CompanyViewMode,
} from "@/lib/server/companies/enrichedCompanies";
import { buildCompanyResultsCsv } from "@/lib/server/export/companyCsv";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

const validRowStates = ["active", "archived", "deleted", "all"] as const;

type ExportRowState = (typeof validRowStates)[number];

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const search = searchParams.get("search")?.trim();
    const uploadJobId = searchParams.get("uploadJobId")?.trim();
    const country = searchParams.get("country")?.trim();
    const qualification = searchParams.get("qualification")?.trim();
    const companyType = searchParams.get("companyType")?.trim();
    const reviewed = parseReviewedFilter(searchParams.get("reviewed"));
    const rowState = parseRowState(searchParams.get("rowState"));
    const includeArchived =
      searchParams.get("includeArchived")?.trim() === "true";
    const includeDeleted =
      searchParams.get("includeDeleted")?.trim() === "true";
    const companyView = parseCompanyView(searchParams.get("companyView"));
    const includeAi = searchParams.get("includeAi")?.trim() === "true";

    if (qualification && !isQualificationValue(qualification)) {
      return errorResponse("Invalid qualification filter.", 400);
    }

    if (companyType && !isCompanyTypeValue(companyType)) {
      return errorResponse("Invalid companyType filter.", 400);
    }

    if (reviewed === "invalid") {
      return errorResponse("Invalid reviewed filter.", 400);
    }

    if (rowState === "invalid") {
      return errorResponse("Invalid rowState filter.", 400);
    }

    if (companyView === "invalid") {
      return errorResponse("Invalid companyView filter.", 400);
    }

    const result = await getEnrichedCompanies({
      page: 1,
      pageSize: 0,
      skip: 0,
      search,
      uploadJobId,
      country,
      qualification,
      companyType,
      reviewed: reviewed ?? undefined,
      includeArchived,
      includeDeleted,
      rowState,
      companyView: companyView ?? undefined,
      exportAll: true,
    });
    const companies = result.data;
    const filename = buildExportFilename({
      uploadJobId,
      qualification,
      companyType,
      reviewed,
      rowState,
      companyView: result.companyView,
      includeAi,
    });
    const exportType = buildExportType({
      search,
      country,
      qualification,
      companyType,
      reviewed,
      rowState,
      companyView: result.companyView,
      includeAi,
    });
    const csv = buildCompanyResultsCsv(companies, { includeAi });

    await prisma.exportJob.create({
      data: {
        uploadJobId,
        fileName: filename,
        exportType,
        rowCount: companies.length,
      },
    });

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return serverError(error);
  }
}

function parseReviewedFilter(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return "invalid";
}

function parseRowState(value: string | null): ExportRowState | "invalid" {
  if (value === null || value.trim() === "") {
    return "active";
  }

  if (validRowStates.includes(value as ExportRowState)) {
    return value as ExportRowState;
  }

  return "invalid";
}

function parseCompanyView(value: string | null): CompanyViewMode | null | "invalid" {
  if (value === null || value.trim() === "") {
    return null;
  }

  if (value === "unique" || value === "records") {
    return value;
  }

  return "invalid";
}

function buildExportFilename({
  uploadJobId,
  qualification,
  companyType,
  reviewed,
  rowState,
  companyView,
  includeAi,
}: {
  uploadJobId?: string;
  qualification?: string;
  companyType?: string;
  reviewed: boolean | null | "invalid";
  rowState: ExportRowState;
  companyView: CompanyViewMode;
  includeAi: boolean;
}) {
  const scope = uploadJobId
    ? `upload-${sanitizeFilenamePart(uploadJobId)}`
    : companyView === "unique"
      ? "unique"
      : "all-records";
  const parts = ["telestar-companies", scope, rowState];

  if (reviewed === true) {
    parts.push("reviewed");
  }

  if (reviewed === false) {
    parts.push("unreviewed");
  }

  if (qualification) {
    parts.push(sanitizeFilenamePart(qualification));
  }

  if (companyType) {
    parts.push(sanitizeFilenamePart(companyType));
  }

  if (includeAi) {
    parts.push("with-ai");
  }

  parts.push(formatDateForFilename(new Date()));

  return `${parts.join("-")}.csv`;
}

function buildExportType({
  search,
  country,
  qualification,
  companyType,
  reviewed,
  rowState,
  companyView,
  includeAi,
}: {
  search?: string;
  country?: string;
  qualification?: string;
  companyType?: string;
  reviewed: boolean | null | "invalid";
  rowState: ExportRowState;
  companyView: CompanyViewMode;
  includeAi: boolean;
}) {
  const filters = [`rowState:${rowState}`, `companyView:${companyView}`];

  if (search) {
    filters.push("search");
  }

  if (country) {
    filters.push(`country:${country}`);
  }

  if (qualification) {
    filters.push(`qualification:${qualification}`);
  }

  if (companyType) {
    filters.push(`companyType:${companyType}`);
  }

  if (reviewed === true || reviewed === false) {
    filters.push(`reviewed:${reviewed}`);
  }

  if (includeAi) {
    filters.push("includeAi:true");
  }

  return `company_results:${filters.join(",")}`.slice(0, 190);
}

function sanitizeFilenamePart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatDateForFilename(date: Date) {
  return date.toISOString().slice(0, 10);
}
