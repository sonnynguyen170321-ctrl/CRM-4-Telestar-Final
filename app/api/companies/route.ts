import {
  isCompanyTypeValue,
  isQualificationValue,
} from "@/lib/server/api/enums";
import {
  errorResponse,
  parsePagination,
  serverError,
} from "@/lib/server/api/responses";
import {
  getEnrichedCompanies,
  type CompanyViewMode,
} from "@/lib/server/companies/enrichedCompanies";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
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
      page,
      pageSize,
      skip,
      search,
      uploadJobId,
      country,
      qualification,
      companyType,
      reviewed: reviewed ?? undefined,
      includeArchived,
      includeDeleted,
      rowState: rowState ?? undefined,
      companyView: companyView ?? undefined,
    });

    return Response.json({
      data: result.data,
      pagination: result.pagination,
      companyView: result.companyView,
      duplicateSummary: result.duplicateSummary,
    });
  } catch (error) {
    return serverError(error);
  }
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

function parseRowState(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }

  if (
    value === "active" ||
    value === "archived" ||
    value === "deleted" ||
    value === "all"
  ) {
    return value;
  }

  return "invalid";
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
