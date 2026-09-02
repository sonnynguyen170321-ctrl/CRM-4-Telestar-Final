import { getDashboardAggregate } from "@/lib/server/dashboard/aggregates";
import { serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getDashboardAggregate();
    return Response.json({ data });
  } catch (error) {
    return serverError(error);
  }
}
