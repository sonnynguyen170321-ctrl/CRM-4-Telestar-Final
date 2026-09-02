import { prisma } from "@/lib/server/prisma";
import { normalizeUploadJobStatusForPrisma } from "@/lib/server/api/enums";
import {
  errorResponse,
  listOk,
  ok,
  parsePagination,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { feedbackImportJobCreateSchema } from "@/lib/server/api/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { page, pageSize, skip } = parsePagination(
      new URL(request.url).searchParams
    );

    const [feedbackImportJobs, total] = await Promise.all([
      prisma.feedbackImportJob.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.feedbackImportJob.count(),
    ]);

    return listOk(feedbackImportJobs, { page, pageSize, total });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return errorResponse("Invalid JSON body.", 400);
  }

  const parsed = feedbackImportJobCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const feedbackImportJob = await prisma.feedbackImportJob.create({
      data: {
        fileName: parsed.data.fileName,
        status: parsed.data.status
          ? normalizeUploadJobStatusForPrisma(parsed.data.status)
          : undefined,
        totalRows: parsed.data.totalRows,
        processedRows: parsed.data.processedRows,
        errorMessage: parsed.data.errorMessage,
      },
    });

    return ok(feedbackImportJob);
  } catch (error) {
    return serverError(error);
  }
}
