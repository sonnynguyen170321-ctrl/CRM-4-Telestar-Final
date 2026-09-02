import {
  errorResponse,
  ok,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import {
  getCompanyIcpInsights,
  saveCompanyIcpInsight,
  saveCompanyIcpInsightSchema,
} from "@/lib/server/companyRecords/icpInsights";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await getCompanyIcpInsights(id);

    if (!result) {
      return errorResponse("Company record not found.", 404);
    }

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = saveCompanyIcpInsightSchema.safeParse(body);

    if (!parsed.success) {
      return validationError(parsed.error);
    }

    const result = await saveCompanyIcpInsight(id, parsed.data);

    if (!result) {
      return errorResponse("Company record not found.", 404);
    }

    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
