import type { Prisma } from "@/app/generated/prisma/client";

import { prisma } from "@/lib/server/prisma";
import {
  companyTypeFromPrisma,
  datasetSplitFromPrisma,
  feedbackSourceFromPrisma,
  normalizeCompanyTypeForPrisma,
  normalizeQualificationForPrisma,
  qualificationFromPrisma,
  reviewStateFromPrisma,
} from "@/lib/server/api/enums";
import { buildCompanyDuplicateKey } from "@/lib/normalization/dedupeCompanyRows";
import { projectAiBriefFromRawResponse } from "@/lib/server/companyRecords/management";

export type CompanyViewMode = "unique" | "records";

export type EnrichedCompanyRow = {
  companyRecordId: string;
  uploadJobId: string | null;
  sourceRowIndex: number | null;
  companyName: string;
  website: string | null;
  normalizedDomain: string | null;
  companyLinkedInUrl: string | null;
  companyCountry: string | null;
  companyIndustry: string | null;
  companyStaffCountRange: string | null;
  duplicateKey: string | null;
  duplicateRecordCount: number;
  hiddenDuplicateRecordCount: number;
  duplicateUploadCount: number;
  archivedAt: Date | null;
  deletedAt: Date | null;
  scoreResult: {
    id: string;
    companyScore: number;
    qualification: string;
    companyType: string | null;
    confidence: number;
    reason: string;
    oneSentenceCompanySummary: string | null;
    hardRuleFlagsJson: unknown;
    reviewState: string;
    scoringSource: string;
    scoringVersion: string;
    createdAt: Date;
  } | null;
  websiteResearch: {
    id: string;
    status: string;
    quality: string;
    reachable: boolean;
    normalizedDomain: string | null;
    finalUrl: string | null;
    summary: string;
    signalsJson: unknown;
    classificationHintsJson: unknown;
    pagesCheckedJson: unknown;
    errorsJson: unknown;
    researchedAt: Date;
    createdAt: Date;
  } | null;
  latestFeedbackExample: {
    id: string;
    companyRecordId: string | null;
    companyScoreResultId: string | null;
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
    rawExampleJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  latestAiAssessment: {
    id: string;
    provider: string;
    modelName: string;
    promptVersion: string;
    mode: string;
    qualification: string;
    companyType: string;
    companyScore: number;
    confidence: number;
    reason: string;
    oneSentenceCompanySummary: string | null;
    brief: {
      icpSegment: string | null;
      outreachAngle: string | null;
      evidenceSummary: string | null;
      targetCustomers: string | null;
      productOrService: string | null;
      industry: string | null;
      niche: string | null;
      keyPainPoints: string[];
      risks: string | null;
      recommendedNextAction: string | null;
    };
    cacheHit: boolean;
    createdAt: Date;
    rawResponseJson: unknown;
  } | null;
  latestAiJob: {
    id: string;
    status: string;
    scope: string;
    provider: string;
    model: string;
    promptVersion: string;
    cacheHit: boolean;
    attemptCount: number;
    maxAttempts: number;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    nextAttemptAt: Date | null;
    lockedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  latestIcpInsight: {
    id: string;
    targetCustomerSegment: string | null;
    sdrMessagingAngle: string | null;
    source: string;
    createdAt: Date;
  } | null;
};

export async function getEnrichedCompanies({
  page,
  pageSize,
  skip,
  search,
  uploadJobId,
  country,
  qualification,
  companyType,
  reviewed,
  includeArchived = false,
  includeDeleted = false,
  rowState,
  companyView,
  exportAll = false,
}: {
  page: number;
  pageSize: number;
  skip: number;
  search?: string;
  uploadJobId?: string;
  country?: string;
  qualification?: string;
  companyType?: string;
  reviewed?: boolean;
  includeArchived?: boolean;
  includeDeleted?: boolean;
  rowState?: "active" | "archived" | "deleted" | "all";
  companyView?: CompanyViewMode;
  exportAll?: boolean;
}) {
  const where: Prisma.CompanyRecordWhereInput = {};
  const andFilters: Prisma.CompanyRecordWhereInput[] = [];
  const resolvedCompanyView = uploadJobId ? "records" : (companyView ?? "unique");

  applyVisibilityFilter(where, {
    includeArchived,
    includeDeleted,
    rowState,
  });

  if (uploadJobId) {
    where.uploadJobId = uploadJobId;
  }

  if (country) {
    where.companyCountry = { contains: country, mode: "insensitive" };
  }

  if (search) {
    where.OR = [
      { companyName: { contains: search, mode: "insensitive" } },
      { website: { contains: search, mode: "insensitive" } },
    ];
  }

  if (qualification) {
    andFilters.push(buildFinalQualificationFilter(qualification));
  }

  if (companyType) {
    andFilters.push(buildFinalCompanyTypeFilter(companyType));
  }

  if (reviewed === true) {
    where.feedbackExamples = { some: {} };
  }

  if (reviewed === false) {
    where.feedbackExamples = { none: {} };
  }

  if (andFilters.length > 0) {
    where.AND = andFilters;
  }

  if (resolvedCompanyView === "unique") {
    const companyRecords = await prisma.companyRecord.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: companyRecordInclude,
    });
    const deduped = collapseDuplicateCompanyRecords(companyRecords);
    const data = exportAll
      ? deduped.rows
      : deduped.rows.slice(skip, skip + pageSize);

    return {
      data,
      pagination: {
        page,
        pageSize: exportAll ? data.length : pageSize,
        total: deduped.rows.length,
      },
      companyView: resolvedCompanyView,
      duplicateSummary: {
        totalRecordsBeforeDedupe: companyRecords.length,
        uniqueCompaniesShown: deduped.rows.length,
        hiddenDuplicateRecords: deduped.hiddenDuplicateRecords,
      },
    };
  }

  const companyRecordQuery = {
    where,
    orderBy: { createdAt: "desc" },
    include: companyRecordInclude,
    ...(exportAll ? {} : { skip, take: pageSize }),
  } satisfies Prisma.CompanyRecordFindManyArgs;

  const [companyRecords, total] = await Promise.all([
    prisma.companyRecord.findMany(companyRecordQuery),
    prisma.companyRecord.count({ where }),
  ]);

  return {
    data: companyRecords.map((record) => mapEnrichedCompanyRow(record)),
    pagination: {
      page,
      pageSize: exportAll ? companyRecords.length : pageSize,
      total,
    },
    companyView: resolvedCompanyView,
    duplicateSummary: {
      totalRecordsBeforeDedupe: total,
      uniqueCompaniesShown: total,
      hiddenDuplicateRecords: 0,
    },
  };
}

const companyRecordInclude = {
  scoreResults: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  websiteResearchResults: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  feedbackExamples: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  aiAssessments: {
    where: { errorMessage: null },
    orderBy: { createdAt: "desc" },
    take: 1,
  },
  aiJobs: {
    orderBy: { updatedAt: "desc" },
    take: 1,
  },
  icpInsights: {
    orderBy: { createdAt: "desc" },
    take: 1,
  },
} satisfies Prisma.CompanyRecordInclude;

type CompanyRecordWithLatestRelations = Prisma.CompanyRecordGetPayload<{
  include: typeof companyRecordInclude;
}>;

function buildFinalQualificationFilter(
  qualification: string
): Prisma.CompanyRecordWhereInput {
  const normalizedQualification = normalizeQualificationForPrisma(qualification);

  return {
    OR: [
      { feedbackExamples: { some: { finalQualification: normalizedQualification } } },
      {
        AND: [
          { feedbackExamples: { none: {} } },
          { scoreResults: { some: { qualification: normalizedQualification } } },
        ],
      },
    ],
  };
}

function buildFinalCompanyTypeFilter(
  companyType: string
): Prisma.CompanyRecordWhereInput {
  const normalizedCompanyType = normalizeCompanyTypeForPrisma(companyType);

  return {
    OR: [
      { feedbackExamples: { some: { finalCompanyType: normalizedCompanyType } } },
      {
        AND: [
          { feedbackExamples: { none: {} } },
          { scoreResults: { some: { companyType: normalizedCompanyType } } },
        ],
      },
    ],
  };
}

function applyVisibilityFilter(
  where: Prisma.CompanyRecordWhereInput,
  {
    includeArchived,
    includeDeleted,
    rowState,
  }: {
    includeArchived: boolean;
    includeDeleted: boolean;
    rowState?: "active" | "archived" | "deleted" | "all";
  }
) {
  if (rowState === "all") {
    return;
  }

  if (rowState === "archived") {
    where.archivedAt = { not: null };
    where.deletedAt = null;
    return;
  }

  if (rowState === "deleted") {
    where.deletedAt = { not: null };
    return;
  }

  if (!includeArchived) {
    where.archivedAt = null;
  }

  if (!includeDeleted) {
    where.deletedAt = null;
  }
}

function mapEnrichedCompanyRow(
  companyRecord: CompanyRecordWithLatestRelations,
  duplicateMetadata?: {
    duplicateKey: string;
    duplicateRecordCount: number;
    hiddenDuplicateRecordCount: number;
    duplicateUploadCount: number;
  }
): EnrichedCompanyRow {
  const latestScore = companyRecord.scoreResults[0] ?? null;
  const latestResearch = companyRecord.websiteResearchResults[0] ?? null;
  const latestFeedback = companyRecord.feedbackExamples[0] ?? null;
  const latestAiAssessment = companyRecord.aiAssessments[0] ?? null;
  const latestAiJob = companyRecord.aiJobs[0] ?? null;
  const latestIcpInsight = companyRecord.icpInsights[0] ?? null;

  return {
    companyRecordId: companyRecord.id,
    uploadJobId: companyRecord.uploadJobId,
    sourceRowIndex: companyRecord.sourceRowIndex,
    companyName: companyRecord.companyName,
    website: companyRecord.website,
    normalizedDomain: latestResearch?.normalizedDomain ?? null,
    companyLinkedInUrl: companyRecord.companyLinkedInUrl,
    companyCountry: companyRecord.companyCountry,
    companyIndustry: companyRecord.companyIndustry,
    companyStaffCountRange: companyRecord.companyStaffCountRange,
    duplicateKey: duplicateMetadata?.duplicateKey ?? null,
    duplicateRecordCount: duplicateMetadata?.duplicateRecordCount ?? 1,
    hiddenDuplicateRecordCount:
      duplicateMetadata?.hiddenDuplicateRecordCount ?? 0,
    duplicateUploadCount: duplicateMetadata?.duplicateUploadCount ?? 1,
    archivedAt: companyRecord.archivedAt,
    deletedAt: companyRecord.deletedAt,
    scoreResult: latestScore
      ? {
          id: latestScore.id,
          companyScore: latestScore.companyScore,
          qualification: qualificationFromPrisma(latestScore.qualification),
          companyType: latestScore.companyType
            ? companyTypeFromPrisma(latestScore.companyType)
            : companyRecord.type
              ? companyTypeFromPrisma(companyRecord.type)
              : null,
          confidence: Number(latestScore.confidence),
          reason: latestScore.reason,
          oneSentenceCompanySummary: latestScore.oneSentenceCompanySummary,
          hardRuleFlagsJson: latestScore.hardRuleFlags,
          reviewState: reviewStateFromPrisma(latestScore.reviewState),
          scoringSource: latestScore.scoringSource,
          scoringVersion: latestScore.scoringVersion,
          createdAt: latestScore.createdAt,
        }
      : null,
    websiteResearch: latestResearch
      ? {
          id: latestResearch.id,
          status: latestResearch.status,
          quality: latestResearch.quality,
          reachable: latestResearch.reachable,
          normalizedDomain: latestResearch.normalizedDomain,
          finalUrl: latestResearch.finalUrl,
          summary: latestResearch.summary,
          signalsJson: latestResearch.signalsJson,
          classificationHintsJson: latestResearch.classificationHintsJson,
          pagesCheckedJson: latestResearch.pagesCheckedJson,
          errorsJson: latestResearch.errorsJson,
          researchedAt: latestResearch.researchedAt,
          createdAt: latestResearch.createdAt,
        }
      : null,
    latestFeedbackExample: latestFeedback
      ? {
          id: latestFeedback.id,
          companyRecordId: latestFeedback.companyRecordId,
          companyScoreResultId: latestFeedback.companyScoreResultId,
          predictedCompanyScore: latestFeedback.predictedCompanyScore,
          predictedCompanyType: latestFeedback.predictedCompanyType
            ? companyTypeFromPrisma(latestFeedback.predictedCompanyType)
            : null,
          predictedQualification: latestFeedback.predictedQualification
            ? qualificationFromPrisma(latestFeedback.predictedQualification)
            : null,
          predictedReason: latestFeedback.predictedReason,
          finalCompanyScore: latestFeedback.finalCompanyScore,
          finalCompanyType: companyTypeFromPrisma(
            latestFeedback.finalCompanyType
          ),
          finalQualification: qualificationFromPrisma(
            latestFeedback.finalQualification
          ),
          finalNote: latestFeedback.finalNote,
          approvedForLearning: latestFeedback.approvedForLearning,
          useForPromptRefinement: latestFeedback.useForPromptRefinement,
          useForRuleTuning: latestFeedback.useForRuleTuning,
          useForModelTraining: latestFeedback.useForModelTraining,
          useForEvaluationBenchmark:
            latestFeedback.useForEvaluationBenchmark,
          datasetSplit: datasetSplitFromPrisma(latestFeedback.datasetSplit),
          source: feedbackSourceFromPrisma(latestFeedback.source),
          rawExampleJson: latestFeedback.rawExampleJson,
          createdAt: latestFeedback.createdAt,
          updatedAt: latestFeedback.updatedAt,
        }
      : null,
    latestAiAssessment: latestAiAssessment
      ? {
          id: latestAiAssessment.id,
          provider: latestAiAssessment.provider,
          modelName: latestAiAssessment.modelName,
          promptVersion: latestAiAssessment.promptVersion,
          mode: latestAiAssessment.mode,
          qualification: latestAiAssessment.qualification,
          companyType: latestAiAssessment.companyType,
          companyScore: latestAiAssessment.companyScore,
          confidence: latestAiAssessment.confidence,
          reason: latestAiAssessment.reason,
          oneSentenceCompanySummary:
            latestAiAssessment.oneSentenceCompanySummary,
          brief: projectAiBriefFromRawResponse(
            latestAiAssessment.rawResponseJson
          ),
          cacheHit: latestAiAssessment.cacheHit,
          createdAt: latestAiAssessment.createdAt,
          rawResponseJson: latestAiAssessment.rawResponseJson,
        }
      : null,
    latestAiJob: latestAiJob
      ? {
        id: latestAiJob.id,
        status: latestAiJob.status,
        scope: latestAiJob.scope,
        provider: latestAiJob.provider,
        model: latestAiJob.model,
        promptVersion: latestAiJob.promptVersion,
        cacheHit: latestAiJob.cacheHit,
        attemptCount: latestAiJob.attemptCount,
        maxAttempts: latestAiJob.maxAttempts,
        lastErrorCode: latestAiJob.lastErrorCode,
        lastErrorMessage: latestAiJob.lastErrorMessage,
        nextAttemptAt: latestAiJob.nextAttemptAt,
        lockedAt: latestAiJob.lockedAt,
        startedAt: latestAiJob.startedAt,
        completedAt: latestAiJob.completedAt,
        createdAt: latestAiJob.createdAt,
        updatedAt: latestAiJob.updatedAt,
      }
      : null,
    latestIcpInsight: latestIcpInsight
      ? {
          id: latestIcpInsight.id,
          targetCustomerSegment: latestIcpInsight.targetCustomerSegment,
          sdrMessagingAngle: latestIcpInsight.sdrMessagingAngle,
          source: latestIcpInsight.source,
          createdAt: latestIcpInsight.createdAt,
        }
      : null,
  };
}

function collapseDuplicateCompanyRecords(
  companyRecords: CompanyRecordWithLatestRelations[]
) {
  const groups = new Map<string, CompanyRecordWithLatestRelations[]>();

  for (const companyRecord of companyRecords) {
    const key = buildCompanyDuplicateKey({
      website: companyRecord.website,
      companyLinkedInUrl: companyRecord.companyLinkedInUrl,
      companyName: companyRecord.companyName,
      companyCountry: companyRecord.companyCountry,
      fallbackKey: `record:${companyRecord.id}`,
    });

    if (key.type === "unique_row") {
      groups.set(key.value, [companyRecord]);
      continue;
    }

    const existing = groups.get(key.value) ?? [];
    existing.push(companyRecord);
    groups.set(key.value, existing);
  }

  const rows = Array.from(groups.entries())
    .map(([duplicateKey, records]) => {
      const canonicalRecord = [...records].sort(compareCanonicalRows)[0];
      const uploadIds = new Set(
        records
          .map((record) => record.uploadJobId)
          .filter((value): value is string => Boolean(value))
      );

      return mapEnrichedCompanyRow(canonicalRecord, {
        duplicateKey,
        duplicateRecordCount: records.length,
        hiddenDuplicateRecordCount: Math.max(records.length - 1, 0),
        duplicateUploadCount: uploadIds.size,
      });
    })
    .sort(compareEnrichedRowsByCanonicalRecency);

  return {
    rows,
    hiddenDuplicateRecords: rows.reduce(
      (total, row) => total + row.hiddenDuplicateRecordCount,
      0
    ),
  };
}

function compareCanonicalRows(
  a: CompanyRecordWithLatestRelations,
  b: CompanyRecordWithLatestRelations
) {
  const activeDelta = Number(isActiveRecord(b)) - Number(isActiveRecord(a));

  if (activeDelta !== 0) {
    return activeDelta;
  }

  const feedbackDelta =
    getLatestFeedbackTime(b) - getLatestFeedbackTime(a);

  if (feedbackDelta !== 0) {
    return feedbackDelta;
  }

  const scoreDelta = getLatestScoreTime(b) - getLatestScoreTime(a);

  if (scoreDelta !== 0) {
    return scoreDelta;
  }

  return b.createdAt.getTime() - a.createdAt.getTime();
}

function compareEnrichedRowsByCanonicalRecency(
  a: EnrichedCompanyRow,
  b: EnrichedCompanyRow
) {
  return getEnrichedRowRecency(b) - getEnrichedRowRecency(a);
}

function getEnrichedRowRecency(row: EnrichedCompanyRow) {
  return (
    row.latestFeedbackExample?.createdAt.getTime() ??
    row.scoreResult?.createdAt.getTime() ??
    row.websiteResearch?.createdAt.getTime() ??
    0
  );
}

function isActiveRecord(record: CompanyRecordWithLatestRelations) {
  return !record.archivedAt && !record.deletedAt;
}

function getLatestFeedbackTime(record: CompanyRecordWithLatestRelations) {
  return record.feedbackExamples[0]?.createdAt.getTime() ?? 0;
}

function getLatestScoreTime(record: CompanyRecordWithLatestRelations) {
  return record.scoreResults[0]?.createdAt.getTime() ?? 0;
}
