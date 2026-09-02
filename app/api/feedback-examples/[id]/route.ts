import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const feedbackExample = await prisma.feedbackExample.findUnique({
      where: { id },
      include: {
        companyRecord: {
          select: {
            id: true,
            companyName: true,
            website: true,
          },
        },
        companyScoreResult: {
          select: {
            id: true,
            companyScore: true,
            qualification: true,
          },
        },
        feedbackImportJob: {
          select: {
            id: true,
            fileName: true,
            status: true,
          },
        },
      },
    });

    if (!feedbackExample) {
      return errorResponse("Feedback example not found.", 404);
    }

    return ok(feedbackExample);
  } catch (error) {
    return serverError(error);
  }
}
