import { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  errorResponse,
  listOk,
  ok,
  parsePagination,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { exportJobCreateSchema } from "@/lib/server/api/schemas";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const uploadJobId = searchParams.get("uploadJobId")?.trim();
    const exportType = searchParams.get("exportType")?.trim();

    const where: Prisma.ExportJobWhereInput = {};

    if (uploadJobId) {
      where.uploadJobId = uploadJobId;
    }

    if (exportType) {
      where.exportType = exportType;
    }

    const [exportJobs, total] = await Promise.all([
      prisma.exportJob.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.exportJob.count({ where }),
    ]);

    return listOk(exportJobs, { page, pageSize, total });
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

  const parsed = exportJobCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const exportJob = await prisma.exportJob.create({
      data: {
        uploadJobId: parsed.data.uploadJobId,
        fileName: parsed.data.fileName,
        exportType: parsed.data.exportType ?? "company_results",
        rowCount: parsed.data.rowCount,
      },
    });

    return ok(exportJob);
  } catch (error) {
    return serverError(error);
  }
}
