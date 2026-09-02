import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import {
  getCompanyRecordDetail,
  softDeleteCompanyRecord,
} from "@/lib/server/companyRecords/management";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as {
    confirm?: unknown;
  } | null;

  if (body?.confirm !== "DELETE") {
    return errorResponse("Soft delete requires confirm DELETE.", 400);
  }

  try {
    const existing = await getCompanyRecordDetail(id);

    if (!existing) {
      return errorResponse("Company record not found.", 404);
    }

    const result = await softDeleteCompanyRecord(id);

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
