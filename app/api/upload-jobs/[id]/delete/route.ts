import { prisma } from "@/lib/server/prisma";
import {
  errorResponse,
  ok,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { deleteConfirmationSchema } from "@/lib/server/api/schemas";
import { softDeleteUploadJob } from "@/lib/server/uploadJobs/management";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const parsed = deleteConfirmationSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!uploadJob) {
      return errorResponse("Upload job not found.", 404);
    }

    const result = await softDeleteUploadJob(id);
    return ok(result);
  } catch (error) {
    return serverError(error);
  }
}
