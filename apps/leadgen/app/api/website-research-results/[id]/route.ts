import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const record = await prisma.websiteResearchResult.findUnique({
      where: { id },
      include: {
        companyRecord: {
          select: {
            id: true,
            companyName: true,
            website: true,
            companyCountry: true,
          },
        },
        uploadJob: {
          select: {
            id: true,
            fileName: true,
            status: true,
          },
        },
      },
    });

    if (!record) {
      return errorResponse("Website research result not found.", 404);
    }

    return ok(record);
  } catch (error) {
    return serverError(error);
  }
}
