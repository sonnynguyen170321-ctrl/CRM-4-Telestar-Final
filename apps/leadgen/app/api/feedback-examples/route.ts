import { prisma } from "@/lib/server/prisma";
import {
  isCompanyTypeValue,
  isDatasetSplitValue,
  isFeedbackSourceValue,
  isQualificationValue,
  normalizeCompanyTypeForPrisma,
  normalizeDatasetSplitForPrisma,
  normalizeFeedbackSourceForPrisma,
  normalizeQualificationForPrisma,
} from "@/lib/server/api/enums";
import {
  errorResponse,
  listOk,
  ok,
  parsePagination,
  serverError,
  validationError,
} from "@/lib/server/api/responses";
import { feedbackExampleCreateSchema } from "@/lib/server/api/schemas";
import { toPrismaJsonObject } from "@/lib/server/api/json";
import { listFeedbackExamples } from "@/lib/server/feedback/listFeedbackExamples";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);
    const finalQualification = searchParams.get("finalQualification")?.trim();
    const finalCompanyType = searchParams.get("finalCompanyType")?.trim();
    const datasetSplit = searchParams.get("datasetSplit")?.trim();
    const source = searchParams.get("source")?.trim();
    const approvedForLearning = parseBooleanFilter(
      searchParams.get("approvedForLearning")
    );
    const search = searchParams.get("search")?.trim();
    const uploadJobId = searchParams.get("uploadJobId")?.trim();
    const companyRecordId = searchParams.get("companyRecordId")?.trim();
    const companyScoreResultId = searchParams
      .get("companyScoreResultId")
      ?.trim();
    const feedbackImportJobId = searchParams
      .get("feedbackImportJobId")
      ?.trim();

    if (finalQualification && !isQualificationValue(finalQualification)) {
      return errorResponse("Invalid finalQualification filter.", 400);
    }

    if (finalCompanyType && !isCompanyTypeValue(finalCompanyType)) {
      return errorResponse("Invalid finalCompanyType filter.", 400);
    }

    if (datasetSplit && !isDatasetSplitValue(datasetSplit)) {
      return errorResponse("Invalid datasetSplit filter.", 400);
    }

    if (source && !isFeedbackSourceValue(source)) {
      return errorResponse("Invalid source filter.", 400);
    }

    if (approvedForLearning === "invalid") {
      return errorResponse("Invalid approvedForLearning filter.", 400);
    }

    const result = await listFeedbackExamples({
      page,
      pageSize,
      skip,
      search,
      uploadJobId,
      companyRecordId,
      companyScoreResultId,
      feedbackImportJobId,
      finalQualification: finalQualification
        ? normalizeQualificationForPrisma(finalQualification)
        : undefined,
      finalCompanyType: finalCompanyType
        ? normalizeCompanyTypeForPrisma(finalCompanyType)
        : undefined,
      approvedForLearning:
        approvedForLearning === null ? undefined : approvedForLearning,
      datasetSplit: datasetSplit
        ? normalizeDatasetSplitForPrisma(datasetSplit)
        : undefined,
      source: source ? normalizeFeedbackSourceForPrisma(source) : undefined,
    });

    return listOk(result.data, result.pagination);
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

  const parsed = feedbackExampleCreateSchema.safeParse(body);

  if (!parsed.success) {
    return validationError(parsed.error);
  }

  try {
    const feedbackExample = await prisma.feedbackExample.create({
      data: {
        companyRecordId: parsed.data.companyRecordId,
        companyScoreResultId: parsed.data.companyScoreResultId,
        feedbackImportJobId: parsed.data.feedbackImportJobId,
        companyName: parsed.data.companyName,
        website: parsed.data.website,
        predictedCompanyScore: parsed.data.predictedCompanyScore,
        predictedCompanyType: parsed.data.predictedCompanyType
          ? normalizeCompanyTypeForPrisma(parsed.data.predictedCompanyType)
          : undefined,
        predictedQualification: parsed.data.predictedQualification
          ? normalizeQualificationForPrisma(parsed.data.predictedQualification)
          : undefined,
        predictedReason: parsed.data.predictedReason,
        finalCompanyScore: parsed.data.finalCompanyScore,
        finalCompanyType: normalizeCompanyTypeForPrisma(
          parsed.data.finalCompanyType
        ),
        finalQualification: normalizeQualificationForPrisma(
          parsed.data.finalQualification
        ),
        finalNote: parsed.data.finalNote,
        approvedForLearning: parsed.data.approvedForLearning,
        useForPromptRefinement: parsed.data.useForPromptRefinement,
        useForRuleTuning: parsed.data.useForRuleTuning,
        useForModelTraining: parsed.data.useForModelTraining,
        useForEvaluationBenchmark: parsed.data.useForEvaluationBenchmark,
        datasetSplit: parsed.data.datasetSplit
          ? normalizeDatasetSplitForPrisma(parsed.data.datasetSplit)
          : undefined,
        promptVersion: parsed.data.promptVersion,
        ruleVersion: parsed.data.ruleVersion,
        modelVersion: parsed.data.modelVersion,
        source: parsed.data.source
          ? normalizeFeedbackSourceForPrisma(parsed.data.source)
          : undefined,
        rawExampleJson: toPrismaJsonObject(parsed.data.rawExampleJson),
      },
    });

    return ok(feedbackExample);
  } catch (error) {
    return serverError(error);
  }
}

function parseBooleanFilter(value: string | null) {
  if (value === null || value.trim() === "") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return "invalid";
}
