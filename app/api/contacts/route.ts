import { listContacts } from "@/lib/server/contacts/contacts";
import {
  errorResponse,
  parsePagination,
  serverError,
} from "@/lib/server/api/responses";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const search = searchParams.get("search")?.trim();
    const sdrName = searchParams.get("sdrName")?.trim();
    const companyRecordId = searchParams.get("companyRecordId")?.trim();
    const hasCompanyMatch = parseBoolean(searchParams.get("hasCompanyMatch"));
    const hasManagerReview = parseBoolean(searchParams.get("hasManagerReview"));

    if (hasCompanyMatch === "invalid") {
      return errorResponse("Invalid hasCompanyMatch filter.", 400);
    }

    if (hasManagerReview === "invalid") {
      return errorResponse("Invalid hasManagerReview filter.", 400);
    }

    const result = await listContacts({
      search,
      sdrName,
      companyRecordId,
      hasCompanyMatch:
        typeof hasCompanyMatch === "boolean" ? hasCompanyMatch : undefined,
      hasManagerReview:
        typeof hasManagerReview === "boolean" ? hasManagerReview : undefined,
      page,
      pageSize,
      skip,
    });

    return Response.json(result);
  } catch (error) {
    return serverError(error);
  }
}

function parseBoolean(value: string | null) {
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

