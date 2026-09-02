import { getUploadAiUsageSummary } from "@/lib/server/ai/aiUsageSummary";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!uploadJob) {
      return errorResponse("Upload job not found.", 404);
    }

    const summary = await getUploadAiUsageSummary(id);

    return ok(summary);
  } catch (error) {
    return serverError(error);
  }
}
