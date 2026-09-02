import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { getAiJobStatusForUpload } from "@/lib/server/ai/companyAiJobs";
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

    return ok(await getAiJobStatusForUpload(id));
  } catch (error) {
    return serverError(error);
  }
}
