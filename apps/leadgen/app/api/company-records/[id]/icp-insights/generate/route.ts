import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { generateCompanyIcpInsight } from "@/lib/server/companyRecords/icpInsights";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const result = await generateCompanyIcpInsight(id);

    if (!result.ok) {
      return errorResponse(result.error, result.status);
    }

    return ok(result.data);
  } catch (error) {
    return serverError(error);
  }
}
