import { prisma } from "@/lib/server/prisma";
import { errorResponse, ok, serverError } from "@/lib/server/api/responses";
import {
  getUploadJobDetail,
  hardDeleteUploadJob,
} from "@/lib/server/uploadJobs/management";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  try {
    const detail = await getUploadJobDetail(id);

    if (!detail) {
      return errorResponse("Upload job not found.", 404);
    }

    return ok(detail);
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const confirm = new URL(request.url).searchParams.get("confirm");

  if (confirm !== "DELETE") {
    return errorResponse("Hard delete requires confirm=DELETE.", 400);
  }

  try {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!uploadJob) {
      return errorResponse("Upload job not found.", 404);
    }

    const result = await hardDeleteUploadJob(id);
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
