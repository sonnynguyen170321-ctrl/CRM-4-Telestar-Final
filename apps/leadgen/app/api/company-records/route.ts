import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  errorResponse,
  listOk,
  ok,
  parsePagination,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { companyRecordCreateSchema } from "@/lib/server/api/schemas";
import { normalizeCompanyTypeForPrisma } from "@/lib/server/api/enums";
import { toPrismaJsonObject } from "@/lib/server/api/json";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const uploadJobId = searchParams.get("uploadJobId")?.trim();
    const search = searchParams.get("search")?.trim();
    const includeArchived =
      searchParams.get("includeArchived")?.trim() === "true";
    const includeDeleted =
      searchParams.get("includeDeleted")?.trim() === "true";

    const where: Prisma.CompanyRecordWhereInput = {};

    if (!includeArchived) {
      where.archivedAt = null;
    }

    if (!includeDeleted) {
      where.deletedAt = null;
    }

    if (uploadJobId) {
      where.uploadJobId = uploadJobId;
    }

    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: "insensitive" } },
        { website: { contains: search, mode: "insensitive" } },
      ];
    }

    const [companyRecords, total] = await Promise.all([
      prisma.companyRecord.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.companyRecord.count({ where }),
    ]);

    return listOk(companyRecords, { page, pageSize, total });
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

  const parsed = companyRecordCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const companyRecord = await prisma.companyRecord.create({
      data: {
        uploadJobId: parsed.data.uploadJobId,
        sourceRowIndex: parsed.data.sourceRowIndex,
        companyName: parsed.data.companyName,
        website: parsed.data.website,
        companyCountry: parsed.data.companyCountry,
        companyLinkedInUrl: parsed.data.companyLinkedInUrl,
        companyIndustry: parsed.data.companyIndustry,
        companyPhone1: parsed.data.companyPhone1,
        companyStaffCountRange: parsed.data.companyStaffCountRange,
        type: parsed.data.type
          ? normalizeCompanyTypeForPrisma(parsed.data.type)
          : undefined,
        note: parsed.data.note,
        rawRowJson: toPrismaJsonObject(parsed.data.rawRowJson),
      },
    });

    return ok(companyRecord);
  } catch (error) {
    return serverError(error);
  }
}
