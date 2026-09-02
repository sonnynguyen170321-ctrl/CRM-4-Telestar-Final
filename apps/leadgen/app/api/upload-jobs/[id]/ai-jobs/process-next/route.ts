import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { processDueAiJobs } from "@/lib/server/ai/companyAiJobs";
import { prisma } from "@/lib/server/prisma";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  if (process.env.AI_ADMIN_PROCESS_UI_ENABLED !== "true") {
    return errorResponse(
      "Admin AI processing action is disabled. Start the background worker instead.",
      403
    );
  }

  try {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!uploadJob) {
      return errorResponse("Upload job not found.", 404);
    }

    return ok(await processDueAiJobs({ uploadJobId: id, limit: 1 }));
  } catch (error) {
    return serverError(error);
  }
}
