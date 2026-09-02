import type { Prisma } from "@/app/generated/prisma/client";

import {
  companyTypeFromPrisma,
  datasetSplitFromPrisma,
  feedbackSourceFromPrisma,
  qualificationFromPrisma,
} from "@/lib/server/api/enums";
import { prisma } from "@/lib/server/prisma";

export type FeedbackListInput = {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  finalQualification?: Prisma.FeedbackExampleWhereInput["finalQualification"];
  finalCompanyType?: Prisma.FeedbackExampleWhereInput["finalCompanyType"];
  datasetSplit?: Prisma.FeedbackExampleWhereInput["datasetSplit"];
  approvedForLearning?: boolean;
  source?: Prisma.FeedbackExampleWhereInput["source"];
  uploadJobId?: string;
  companyRecordId?: string;
  companyScoreResultId?: string;
  feedbackImportJobId?: string;
};

export type FeedbackListRow = {
  id: string;
  companyRecordId: string | null;
  companyScoreResultId: string | null;
  uploadJobId: string | null;
  companyName: string;
  website: string | null;
  predictedCompanyScore: number | null;
  predictedCompanyType: string | null;
  predictedQualification: string | null;
  predictedReason: string | null;
  finalCompanyScore: number;
  finalCompanyType: string;
  finalQualification: string;
  finalNote: string | null;
  approvedForLearning: boolean;
  useForPromptRefinement: boolean;
  useForRuleTuning: boolean;
  useForModelTraining: boolean;
  useForEvaluationBenchmark: boolean;
  datasetSplit: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  company: {
    companyCountry: string | null;
    companyIndustry: string | null;
    archivedAt: Date | null;
    deletedAt: Date | null;
  } | null;
};

const feedbackListInclude = {
  companyRecord: {
    select: {
      uploadJobId: true,
      companyCountry: true,
      companyIndustry: true,
      archivedAt: true,
      deletedAt: true,
    },
  },
  companyScoreResult: {
    select: {
      companyRecord: {
        select: {
          uploadJobId: true,
          companyCountry: true,
          companyIndustry: true,
          archivedAt: true,
          deletedAt: true,
        },
      },
    },
  },
} satisfies Prisma.FeedbackExampleInclude;

type FeedbackWithContext = Prisma.FeedbackExampleGetPayload<{
  include: typeof feedbackListInclude;
}>;

export async function listFeedbackExamples({
  page,
  pageSize,
  skip,
  search,
  finalQualification,
  finalCompanyType,
  datasetSplit,
  approvedForLearning,
  source,
  uploadJobId,
  companyRecordId,
  companyScoreResultId,
  feedbackImportJobId,
}: FeedbackListInput) {
  const where: Prisma.FeedbackExampleWhereInput = {};

  const andFilters: Prisma.FeedbackExampleWhereInput[] = [];

  if (search) {
    andFilters.push({
      OR: [
        { companyName: { contains: search, mode: "insensitive" } },
        { website: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  if (finalQualification) {
    where.finalQualification = finalQualification;
  }

  if (finalCompanyType) {
    where.finalCompanyType = finalCompanyType;
  }

  if (datasetSplit) {
    where.datasetSplit = datasetSplit;
  }

  if (approvedForLearning !== undefined) {
    where.approvedForLearning = approvedForLearning;
  }

  if (source) {
    where.source = source;
  }

  if (companyRecordId) {
    where.companyRecordId = companyRecordId;
  }

  if (companyScoreResultId) {
    where.companyScoreResultId = companyScoreResultId;
  }

  if (feedbackImportJobId) {
    where.feedbackImportJobId = feedbackImportJobId;
  }

  if (uploadJobId) {
    andFilters.push({
      OR: [
        { companyRecord: { uploadJobId } },
        { companyScoreResult: { companyRecord: { uploadJobId } } },
      ],
    });
  }

  if (andFilters.length > 0) {
    where.AND = andFilters;
  }

  const [feedbackExamples, total] = await Promise.all([
    prisma.feedbackExample.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
      include: feedbackListInclude,
    }),
    prisma.feedbackExample.count({ where }),
  ]);

  return {
    data: feedbackExamples.map(mapFeedbackListRow),
    pagination: {
      page,
      pageSize,
      total,
    },
  };
}

function mapFeedbackListRow(
  feedbackExample: FeedbackWithContext
): FeedbackListRow {
  const linkedCompany =
    feedbackExample.companyRecord ??
    feedbackExample.companyScoreResult?.companyRecord ??
    null;

  return {
    id: feedbackExample.id,
    companyRecordId: feedbackExample.companyRecordId,
    companyScoreResultId: feedbackExample.companyScoreResultId,
    uploadJobId: linkedCompany?.uploadJobId ?? null,
    companyName: feedbackExample.companyName,
    website: feedbackExample.website,
    predictedCompanyScore: feedbackExample.predictedCompanyScore,
    predictedCompanyType: feedbackExample.predictedCompanyType
      ? companyTypeFromPrisma(feedbackExample.predictedCompanyType)
      : null,
    predictedQualification: feedbackExample.predictedQualification
      ? qualificationFromPrisma(feedbackExample.predictedQualification)
      : null,
    predictedReason: feedbackExample.predictedReason,
    finalCompanyScore: feedbackExample.finalCompanyScore,
    finalCompanyType: companyTypeFromPrisma(feedbackExample.finalCompanyType),
    finalQualification: qualificationFromPrisma(
      feedbackExample.finalQualification
    ),
    finalNote: feedbackExample.finalNote,
    approvedForLearning: feedbackExample.approvedForLearning,
    useForPromptRefinement: feedbackExample.useForPromptRefinement,
    useForRuleTuning: feedbackExample.useForRuleTuning,
    useForModelTraining: feedbackExample.useForModelTraining,
    useForEvaluationBenchmark: feedbackExample.useForEvaluationBenchmark,
    datasetSplit: datasetSplitFromPrisma(feedbackExample.datasetSplit),
    source: feedbackSourceFromPrisma(feedbackExample.source),
    createdAt: feedbackExample.createdAt,
    updatedAt: feedbackExample.updatedAt,
    company: linkedCompany
      ? {
          companyCountry: linkedCompany.companyCountry,
          companyIndustry: linkedCompany.companyIndustry,
          archivedAt: linkedCompany.archivedAt,
          deletedAt: linkedCompany.deletedAt,
        }
      : null,
  };
}
