import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const feedbackImportJob = await prisma.feedbackImportJob.findUnique({
      where: { id },
      include: {
        _count: {
          select: { feedbackExamples: true },
        },
      },
    });

    if (!feedbackImportJob) {
      return errorResponse("Feedback import job not found.", 404);
    }

    return ok(feedbackImportJob);
  } catch (error) {
    return serverError(error);
  }
}
