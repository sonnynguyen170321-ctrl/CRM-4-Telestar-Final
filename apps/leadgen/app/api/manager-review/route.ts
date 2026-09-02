import {
  errorResponse,
  ok,
  parsePagination,
  serverError,
} from "@/lib/server/api/responses";
import {
  listManagerReviewItems,
  type ManagerReviewPriority,
  type ManagerReviewStatus,
} from "@/lib/server/managerReview/managerReviewItems";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const status = parseStatus(searchParams.get("status"));
    const priority = parsePriority(searchParams.get("priority"));
    const sdrName = searchParams.get("sdrName")?.trim();
    const search = searchParams.get("search")?.trim();

    if (status === "invalid") {
      return errorResponse("Invalid manager review status filter.", 400);
    }

    if (priority === "invalid") {
      return errorResponse("Invalid manager review priority filter.", 400);
    }

    const result = await listManagerReviewItems({
      status: status ?? "open",
      priority: priority ?? "all",
      sdrName,
      search,
      page,
      pageSize,
      skip,
    });

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}

function parseStatus(value: string | null): ManagerReviewStatus | "all" | null | "invalid" {
  if (value === null || value.trim() === "") {
    return null;
  }

  if (
    value === "open" ||
    value === "reviewed" ||
    value === "needs_follow_up" ||
    value === "dismissed" ||
    value === "all"
  ) {
    return value;
  }

  return "invalid";
}

function parsePriority(
  value: string | null
): ManagerReviewPriority | "all" | null | "invalid" {
  if (value === null || value.trim() === "") {
    return null;
  }

  if (value === "high" || value === "medium" || value === "low" || value === "all") {
    return value;
  }

  return "invalid";
}
