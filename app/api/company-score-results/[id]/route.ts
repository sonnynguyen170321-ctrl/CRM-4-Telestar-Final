import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const scoreResult = await prisma.companyScoreResult.findUnique({
      where: { id },
      include: {
        companyRecord: {
          select: {
            id: true,
            companyName: true,
            website: true,
            companyCountry: true,
            type: true,
          },
        },
        _count: {
          select: { feedbackExamples: true },
        },
      },
    });

    if (!scoreResult) {
      return errorResponse("Company score result not found.", 404);
    }

    return ok(scoreResult);
  } catch (error) {
    return serverError(error);
  }
}
