import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { enqueueAiJobForCompanyRecord } from "@/lib/server/ai/companyAiJobs";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const companyRecord = await prisma.companyRecord.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });

    if (!companyRecord) {
      return errorResponse("Company record not found.", 404);
    }

    if (companyRecord.deletedAt) {
      return errorResponse("Deleted company records cannot be AI assessed.", 400);
    }

    const body = (await request.json().catch(() => ({}))) as {
      force?: boolean;
    };
    const summary = await enqueueAiJobForCompanyRecord(id, "all_active", {
      force: body.force === true,
    });

    if (!summary.success) {
      return errorResponse(summary.reason ?? "AI assessment could not be queued.", 400);
    }

    return ok(summary);
  } catch (error) {
    return serverError(error);
  }
}
