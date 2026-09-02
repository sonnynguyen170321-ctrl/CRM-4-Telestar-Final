import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import { restoreUploadJob } from "@/lib/server/uploadJobs/management";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!uploadJob) {
      return errorResponse("Upload job not found.", 404);
    }

    const result = await restoreUploadJob(id);
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
