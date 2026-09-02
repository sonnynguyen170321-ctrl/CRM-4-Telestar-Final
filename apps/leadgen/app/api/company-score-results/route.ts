import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  isCompanyTypeValue,
  isQualificationValue,
  isReviewStateValue,
  normalizeCompanyTypeForPrisma,
  normalizeQualificationForPrisma,
  normalizeReviewStateForPrisma,
} from "@/lib/server/api/enums";
import {
  errorResponse,
  listOk,
  ok,
  parsePagination,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { companyScoreResultCreateSchema } from "@/lib/server/api/schemas";
import { toRequiredPrismaJsonObject } from "@/lib/server/api/json";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const companyRecordId = searchParams.get("companyRecordId")?.trim();
    const qualification = searchParams.get("qualification")?.trim();
    const reviewState = searchParams.get("reviewState")?.trim();
    const companyType = searchParams.get("companyType")?.trim();

    if (qualification && !isQualificationValue(qualification)) {
      return errorResponse("Invalid qualification filter.", 400);
    }

    if (reviewState && !isReviewStateValue(reviewState)) {
      return errorResponse("Invalid reviewState filter.", 400);
    }

    if (companyType && !isCompanyTypeValue(companyType)) {
      return errorResponse("Invalid companyType filter.", 400);
    }

    const where: Prisma.CompanyScoreResultWhereInput = {};

    if (companyRecordId) {
      where.companyRecordId = companyRecordId;
    }

    if (qualification) {
      where.qualification = normalizeQualificationForPrisma(qualification);
    }

    if (reviewState) {
      where.reviewState = normalizeReviewStateForPrisma(reviewState);
    }

    if (companyType) {
      where.companyType = normalizeCompanyTypeForPrisma(companyType);
    }

    const [scoreResults, total] = await Promise.all([
      prisma.companyScoreResult.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        include: {
          companyRecord: {
            select: {
              id: true,
              companyName: true,
              website: true,
              companyCountry: true,
              type: true,
            },
          },
        },
      }),
      prisma.companyScoreResult.count({ where }),
    ]);

    return listOk(scoreResults, { page, pageSize, total });
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

  const parsed = companyScoreResultCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const scoreResult = await prisma.companyScoreResult.create({
      data: {
        companyRecordId: parsed.data.companyRecordId,
        companyType: parsed.data.companyType
          ? normalizeCompanyTypeForPrisma(parsed.data.companyType)
          : undefined,
        companyScore: parsed.data.companyScore,
        qualification: normalizeQualificationForPrisma(
          parsed.data.qualification
        ),
        confidence: parsed.data.confidence,
        reason: parsed.data.reason,
        oneSentenceCompanySummary: parsed.data.oneSentenceCompanySummary,
        hardRuleFlags: toRequiredPrismaJsonObject(parsed.data.hardRuleFlags),
        reviewState: parsed.data.reviewState
          ? normalizeReviewStateForPrisma(parsed.data.reviewState)
          : undefined,
        scoringSource: parsed.data.scoringSource,
        scoringVersion: parsed.data.scoringVersion,
      },
    });

    return ok(scoreResult);
  } catch (error) {
    return serverError(error);
  }
}
