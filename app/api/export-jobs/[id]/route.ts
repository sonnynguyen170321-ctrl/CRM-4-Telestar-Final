import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const exportJob = await prisma.exportJob.findUnique({
      where: { id },
    });

    if (!exportJob) {
      return errorResponse("Export job not found.", 404);
    }

    return ok(exportJob);
  } catch (error) {
    return serverError(error);
  }
}
