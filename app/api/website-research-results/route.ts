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
import { websiteResearchResultCreateSchema } from "@/lib/server/api/schemas";
import { mapWebsiteResearchResultToCreateData } from "@/lib/server/websiteResearch/persistence";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const companyRecordId = searchParams.get("companyRecordId")?.trim();
    const uploadJobId = searchParams.get("uploadJobId")?.trim();
    const normalizedDomain = searchParams.get("normalizedDomain")?.trim();

    const where: Prisma.WebsiteResearchResultWhereInput = {};

    if (companyRecordId) {
      where.companyRecordId = companyRecordId;
    }

    if (uploadJobId) {
      where.uploadJobId = uploadJobId;
    }

    if (normalizedDomain) {
      where.normalizedDomain = normalizedDomain;
    }

    const [records, total] = await Promise.all([
      prisma.websiteResearchResult.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      prisma.websiteResearchResult.count({ where }),
    ]);

    return listOk(records, { page, pageSize, total });
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

  const parsed = websiteResearchResultCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const relationError = await validateOptionalRelations({
      companyRecordId: parsed.data.companyRecordId,
      uploadJobId: parsed.data.uploadJobId,
    });

    if (relationError) {
      return errorResponse(relationError, 400);
    }

    const record = await prisma.websiteResearchResult.create({
      data: mapWebsiteResearchResultToCreateData({
        companyRecordId: parsed.data.companyRecordId,
        uploadJobId: parsed.data.uploadJobId,
        result: parsed.data.result,
      }),
    });

    return ok(record);
  } catch (error) {
    return serverError(error);
  }
}

async function validateOptionalRelations({
  companyRecordId,
  uploadJobId,
}: {
  companyRecordId?: string;
  uploadJobId?: string;
}) {
  if (companyRecordId) {
    const companyRecord = await prisma.companyRecord.findUnique({
      where: { id: companyRecordId },
      select: { id: true },
    });

    if (!companyRecord) {
      return "Company record was not found.";
    }
  }

  if (uploadJobId) {
    const uploadJob = await prisma.uploadJob.findUnique({
      where: { id: uploadJobId },
      select: { id: true },
    });

    if (!uploadJob) {
      return "Upload job was not found.";
    }
  }

  return null;
}
