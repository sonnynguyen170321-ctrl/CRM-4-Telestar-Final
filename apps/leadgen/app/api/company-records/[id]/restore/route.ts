import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import {
  getCompanyRecordDetail,
  restoreCompanyRecord,
} from "@/lib/server/companyRecords/management";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const existing = await getCompanyRecordDetail(id);

    if (!existing) {
      return errorResponse("Company record not found.", 404);
    }

    const result = await restoreCompanyRecord(id);

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
