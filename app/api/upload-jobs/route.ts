import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  errorResponse,
  ok,
  parsePagination,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { uploadJobCreateSchema } from "@/lib/server/api/schemas";
import {
  isUploadJobStatusValue,
  normalizeUploadJobStatusForPrisma,
} from "@/lib/server/api/enums";
import { listManagedUploadJobs } from "@/lib/server/uploadJobs/management";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const status = searchParams.get("status")?.trim();
    const search = searchParams.get("search")?.trim();
    const includeArchived = parseBooleanParam(
      searchParams.get("includeArchived")
    );
    const includeDeleted = parseBooleanParam(searchParams.get("includeDeleted"));
    const sort = searchParams.get("sort")?.trim() || "createdAt_desc";

    if (status && !isUploadJobStatusValue(status)) {
      return errorResponse("Invalid status filter.", 400);
    }

    if (includeArchived === "invalid") {
      return errorResponse("Invalid includeArchived filter.", 400);
    }

    if (includeDeleted === "invalid") {
      return errorResponse("Invalid includeDeleted filter.", 400);
    }

    if (sort !== "createdAt_desc") {
      return errorResponse("Invalid sort filter.", 400);
    }

    const where: Prisma.UploadJobWhereInput = {};

    if (status) {
      where.status = normalizeUploadJobStatusForPrisma(status);
    }

    if (includeArchived !== true) {
      where.archivedAt = null;
    }

    if (includeDeleted !== true) {
      where.deletedAt = null;
    }

    if (search) {
      where.fileName = { contains: search, mode: "insensitive" };
    }

    const { items, pagination } = await listManagedUploadJobs({
      where,
      page,
      pageSize,
      skip,
    });

    return Response.json({
      data: items,
      items,
      pagination,
    });
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

  const parsed = uploadJobCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const uploadJob = await prisma.uploadJob.create({
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

    return ok(uploadJob);
  } catch (error) {
    return serverError(error);
  }
}

function parseBooleanParam(value: string | null) {
  if (value === null || value.trim() === "") {
    return false;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return "invalid";
}
