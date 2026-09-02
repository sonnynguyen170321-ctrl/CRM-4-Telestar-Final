import type { Prisma } from "@/app/generated/prisma/client";

import { compareRuleAndAi } from "@/lib/ai/compareRuleAndAi";
import { prisma } from "@/lib/server/prisma";
import {
  companyTypeFromPrisma,
  datasetSplitFromPrisma,
  feedbackSourceFromPrisma,
  qualificationFromPrisma,
  reviewStateFromPrisma,
} from "@/lib/server/api/enums";

export type AiBriefProjection = {
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

export type CompanyRecordCounts = {
  scoreResults: number;
  websiteResearchResults: number;
  feedbackExamples: number;
  aiAssessments: number;
  icpInsights: number;
};

type CompanyRecordWithUploadPayload = Prisma.CompanyRecordGetPayload<{
  include: {
    uploadJob: {
      select: {
        id: true;
        fileName: true;
        createdAt: true;
      };
    };
  };
}>;

const companyRecordDetailInclude = {
  uploadJob: {
    select: {
      id: true,
      fileName: true,
      createdAt: true,
    },
  },
} satisfies Prisma.CompanyRecordInclude;

export async function getCompanyRecordCounts(
  companyRecordId: string
): Promise<CompanyRecordCounts> {
  const [
    scoreResults,
    websiteResearchResults,
    feedbackExamples,
    aiAssessments,
    icpInsights,
  ] = await Promise.all([
      prisma.companyScoreResult.count({
        where: { companyRecordId },
      }),
      prisma.websiteResearchResult.count({
        where: { companyRecordId },
      }),
      prisma.feedbackExample.count({
        where: {
          OR: [
            { companyRecordId },
            { companyScoreResult: { companyRecordId } },
          ],
        },
      }),
      prisma.companyAiAssessment.count({
        where: { companyRecordId },
      }),
      prisma.companyIcpInsight.count({
        where: { companyRecordId },
      }),
    ]);

  return {
    scoreResults,
    websiteResearchResults,
    feedbackExamples,
    aiAssessments,
    icpInsights,
  };
}

export async function getCompanyRecordDetail(companyRecordId: string) {
  const [
    companyRecord,
    counts,
    scoreResultHistory,
    websiteResearchHistory,
    feedbackHistory,
    aiAssessmentHistory,
    latestAiJob,
    latestIcpInsight,
  ] = await Promise.all([
    prisma.companyRecord.findUnique({
      where: { id: companyRecordId },
      include: companyRecordDetailInclude,
    }),
    getCompanyRecordCounts(companyRecordId),
    prisma.companyScoreResult.findMany({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.websiteResearchResult.findMany({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.feedbackExample.findMany({
      where: {
        OR: [{ companyRecordId }, { companyScoreResult: { companyRecordId } }],
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.companyAiAssessment.findMany({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.companyAiJob.findFirst({
      where: { companyRecordId },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.companyIcpInsight.findFirst({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!companyRecord) {
    return null;
  }

  return mapCompanyRecordDetail(
    companyRecord,
    counts,
    scoreResultHistory,
    websiteResearchHistory,
    feedbackHistory,
    aiAssessmentHistory,
    latestAiJob,
    latestIcpInsight
  );
}

export async function archiveCompanyRecord(companyRecordId: string) {
  await prisma.companyRecord.update({
    where: { id: companyRecordId },
    data: { archivedAt: new Date() },
  });

  return getCompanyRecordDetail(companyRecordId);
}

export async function restoreCompanyRecord(companyRecordId: string) {
  await prisma.companyRecord.update({
    where: { id: companyRecordId },
    data: {
      archivedAt: null,
      deletedAt: null,
    },
  });

  return getCompanyRecordDetail(companyRecordId);
}

export async function softDeleteCompanyRecord(companyRecordId: string) {
  const now = new Date();

  await prisma.companyRecord.update({
    where: { id: companyRecordId },
    data: {
      archivedAt: now,
      deletedAt: now,
    },
  });

  return getCompanyRecordDetail(companyRecordId);
}

export async function hardDeleteCompanyRecord(companyRecordId: string) {
  const counts = await getCompanyRecordCounts(companyRecordId);

  await prisma.$transaction(async (tx) => {
    await tx.feedbackExample.deleteMany({
      where: {
        OR: [
          { companyRecordId },
          { companyScoreResult: { companyRecordId } },
        ],
      },
    });

    await tx.companyAiAssessment.deleteMany({
      where: { companyRecordId },
    });

    await tx.companyIcpInsight.deleteMany({
      where: { companyRecordId },
    });

    await tx.companyScoreResult.deleteMany({
      where: { companyRecordId },
    });

    await tx.websiteResearchResult.deleteMany({
      where: { companyRecordId },
    });

    await tx.companyRecord.delete({
      where: { id: companyRecordId },
    });
  });

  return {
    deleted: true,
    companyRecordId,
    counts,
  };
}

function mapCompanyRecordDetail(
  companyRecord: CompanyRecordWithUploadPayload,
  counts: CompanyRecordCounts,
  scoreResultHistory: Awaited<
    ReturnType<typeof prisma.companyScoreResult.findMany>
  >,
  websiteResearchHistory: Awaited<
    ReturnType<typeof prisma.websiteResearchResult.findMany>
  >,
  feedbackHistory: Awaited<ReturnType<typeof prisma.feedbackExample.findMany>>,
  aiAssessmentHistory: Awaited<
    ReturnType<typeof prisma.companyAiAssessment.findMany>
  >,
  latestAiJob: Awaited<ReturnType<typeof prisma.companyAiJob.findFirst>>,
  latestIcpInsight: Awaited<
    ReturnType<typeof prisma.companyIcpInsight.findFirst>
  >
) {
  const latestScoreResult = scoreResultHistory[0] ?? null;
  const latestWebsiteResearchResult = websiteResearchHistory[0] ?? null;
  const latestFeedbackExample = feedbackHistory[0] ?? null;
  const latestAiAssessment = aiAssessmentHistory[0] ?? null;
  const mappedLatestScoreResult = latestScoreResult
    ? mapScoreResult(latestScoreResult)
    : null;
  const mappedLatestAiAssessment = latestAiAssessment
    ? mapAiAssessment(latestAiAssessment)
    : null;

  return {
    companyRecord: {
      id: companyRecord.id,
      uploadJobId: companyRecord.uploadJobId,
      sourceRowIndex: companyRecord.sourceRowIndex,
      companyName: companyRecord.companyName,
      website: companyRecord.website,
      companyCountry: companyRecord.companyCountry,
      companyLinkedInUrl: companyRecord.companyLinkedInUrl,
      companyIndustry: companyRecord.companyIndustry,
      companyPhone1: companyRecord.companyPhone1,
      companyStaffCountRange: companyRecord.companyStaffCountRange,
      type: companyRecord.type ? companyTypeFromPrisma(companyRecord.type) : null,
      note: companyRecord.note,
      rawRowJson: companyRecord.rawRowJson,
      archivedAt: companyRecord.archivedAt,
      deletedAt: companyRecord.deletedAt,
      createdAt: companyRecord.createdAt,
      updatedAt: companyRecord.updatedAt,
    },
    uploadJob: companyRecord.uploadJob,
    counts,
    latestScoreResult: mappedLatestScoreResult,
    latestWebsiteResearchResult: latestWebsiteResearchResult
      ? mapWebsiteResearchResult(latestWebsiteResearchResult)
      : null,
    latestFeedbackExample: latestFeedbackExample
      ? mapFeedbackExample(latestFeedbackExample)
      : null,
    latestAiAssessment: mappedLatestAiAssessment,
    latestAiJob: latestAiJob ? mapAiJob(latestAiJob) : null,
    latestIcpInsight: latestIcpInsight
      ? mapIcpInsight(latestIcpInsight)
      : null,
    aiRuleComparison: compareRuleAndAi({
      localScoreResult: mappedLatestScoreResult,
      aiAssessment: mappedLatestAiAssessment,
    }),
    scoreResultHistory: scoreResultHistory.map(mapScoreResult),
    websiteResearchHistory: websiteResearchHistory.map(
      mapWebsiteResearchResult
    ),
    feedbackHistory: feedbackHistory.map(mapFeedbackExample),
    aiAssessmentHistory: aiAssessmentHistory.map(mapAiAssessment),
  };
}

function mapAiJob(
  aiJob: NonNullable<Awaited<ReturnType<typeof prisma.companyAiJob.findFirst>>>
) {
  return {
    id: aiJob.id,
    uploadJobId: aiJob.uploadJobId,
    companyRecordId: aiJob.companyRecordId,
    status: aiJob.status,
    scope: aiJob.scope,
    provider: aiJob.provider,
    model: aiJob.model,
    promptVersion: aiJob.promptVersion,
    cacheHit: aiJob.cacheHit,
    attemptCount: aiJob.attemptCount,
    maxAttempts: aiJob.maxAttempts,
    nextAttemptAt: aiJob.nextAttemptAt,
    lockedAt: aiJob.lockedAt,
    startedAt: aiJob.startedAt,
    completedAt: aiJob.completedAt,
    lastErrorCode: aiJob.lastErrorCode,
    lastErrorMessage: aiJob.lastErrorMessage,
    createdAt: aiJob.createdAt,
    updatedAt: aiJob.updatedAt,
  };
}

function mapScoreResult(
  scoreResult: Awaited<ReturnType<typeof prisma.companyScoreResult.findMany>>[number]
) {
  return {
    id: scoreResult.id,
    companyType: companyTypeFromPrisma(scoreResult.companyType),
    companyScore: scoreResult.companyScore,
    qualification: qualificationFromPrisma(scoreResult.qualification),
    confidence: Number(scoreResult.confidence),
    reason: scoreResult.reason,
    oneSentenceCompanySummary: scoreResult.oneSentenceCompanySummary,
    hardRuleFlagsJson: scoreResult.hardRuleFlags,
    reviewState: reviewStateFromPrisma(scoreResult.reviewState),
    scoringSource: scoreResult.scoringSource,
    scoringVersion: scoreResult.scoringVersion,
    createdAt: scoreResult.createdAt,
  };
}

function mapWebsiteResearchResult(
  websiteResearchResult: Awaited<
    ReturnType<typeof prisma.websiteResearchResult.findMany>
  >[number]
) {
  return {
    id: websiteResearchResult.id,
    status: websiteResearchResult.status,
    quality: websiteResearchResult.quality,
    reachable: websiteResearchResult.reachable,
    normalizedDomain: websiteResearchResult.normalizedDomain,
    finalUrl: websiteResearchResult.finalUrl,
    httpStatus: websiteResearchResult.httpStatus,
    summary: websiteResearchResult.summary,
    signalsJson: websiteResearchResult.signalsJson,
    classificationHintsJson: websiteResearchResult.classificationHintsJson,
    pagesCheckedJson: websiteResearchResult.pagesCheckedJson,
    errorsJson: websiteResearchResult.errorsJson,
    researchedAt: websiteResearchResult.researchedAt,
    createdAt: websiteResearchResult.createdAt,
  };
}

function mapFeedbackExample(
  feedbackExample: Awaited<ReturnType<typeof prisma.feedbackExample.findMany>>[number]
) {
  return {
    id: feedbackExample.id,
    companyScoreResultId: feedbackExample.companyScoreResultId,
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
    rawExampleJson: feedbackExample.rawExampleJson,
    createdAt: feedbackExample.createdAt,
    updatedAt: feedbackExample.updatedAt,
  };
}

function mapAiAssessment(
  aiAssessment: Awaited<
    ReturnType<typeof prisma.companyAiAssessment.findMany>
  >[number]
) {
  return {
    id: aiAssessment.id,
    companyRecordId: aiAssessment.companyRecordId,
    localScoreResultId: aiAssessment.localScoreResultId,
    provider: aiAssessment.provider,
    modelName: aiAssessment.modelName,
    promptVersion: aiAssessment.promptVersion,
    mode: aiAssessment.mode,
    qualification: aiAssessment.qualification,
    companyType: aiAssessment.companyType,
    companyScore: aiAssessment.companyScore,
    confidence: aiAssessment.confidence,
    reason: aiAssessment.reason,
    oneSentenceCompanySummary: aiAssessment.oneSentenceCompanySummary,
    brief: projectAiBriefFromRawResponse(aiAssessment.rawResponseJson),
    inputSnapshotJson: aiAssessment.inputSnapshotJson,
    websiteSignalsSnapshotJson: aiAssessment.websiteSignalsSnapshotJson,
    finishReason: aiAssessment.finishReason,
    inputTokens: aiAssessment.inputTokens,
    outputTokens: aiAssessment.outputTokens,
    latencyMs: aiAssessment.latencyMs,
    errorMessage: aiAssessment.errorMessage,
    cacheHit: aiAssessment.cacheHit,
    createdAt: aiAssessment.createdAt,
  };
}

export function projectAiBriefFromRawResponse(
  value: Prisma.JsonValue | null
): AiBriefProjection {
  const root = asRecord(value);
  const nested = firstRecord(
    root.brief,
    root.companyBrief,
    root.aiBrief,
    root.assessment,
    root.result
  );
  const source = nested ?? root;

  return {
    icpSegment: readString(source, [
      "icpSegment",
      "targetSegment",
      "targetCustomerSegment",
      "customerSegment",
    ]),
    outreachAngle: readString(source, [
      "outreachAngle",
      "sdrMessagingAngle",
      "messagingAngle",
    ]),
    evidenceSummary: readString(source, [
      "evidenceSummary",
      "evidence",
      "sourceEvidence",
      "briefEvidence",
    ]),
    targetCustomers: readString(source, [
      "targetCustomers",
      "targetCustomer",
      "customers",
      "buyerPersona",
      "buyerPersonas",
    ]),
    productOrService: readString(source, [
      "productOrService",
      "product",
      "service",
      "solution",
      "offering",
    ]),
    industry: readString(source, ["industry", "vertical", "market"]),
    niche: readString(source, ["niche", "subIndustry", "category"]),
    keyPainPoints: readBriefStringArray(source, [
      "keyPainPoints",
      "painPoints",
      "customerPainPoints",
    ]),
    risks: readString(source, ["risks", "risk", "caveats"]),
    recommendedNextAction: readString(source, [
      "recommendedNextAction",
      "nextAction",
      "recommendedAction",
    ]),
  };
}

function firstRecord(...values: unknown[]) {
  return values.find((value): value is Record<string, unknown> =>
    isRecord(value)
  );
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim()) {
      return truncateBriefValue(value.trim());
    }

    if (Array.isArray(value)) {
      const joined = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ");

      if (joined) {
        return truncateBriefValue(joined);
      }
    }
  }

  return null;
}

function readBriefStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value
        .filter((item): item is string => typeof item === "string")
        .map((item) => truncateBriefValue(item.trim(), 180))
        .filter(Boolean)
        .slice(0, 6);
    }

    if (typeof value === "string" && value.trim()) {
      return value
        .split(/\n|;|\u2022/)
        .map((item) => truncateBriefValue(item.trim(), 180))
        .filter(Boolean)
        .slice(0, 6);
    }
  }

  return [];
}

function truncateBriefValue(value: string, maxLength = 700) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function mapIcpInsight(
  insight: NonNullable<
    Awaited<ReturnType<typeof prisma.companyIcpInsight.findFirst>>
  >
) {
  return {
    id: insight.id,
    companyRecordId: insight.companyRecordId,
    targetCustomerSegment: insight.targetCustomerSegment,
    targetVerticals: readStringArray(insight.targetVerticalsJson),
    buyerPersonas: readStringArray(insight.buyerPersonasJson),
    useCasesPainPoints: readStringArray(insight.useCasesPainPointsJson),
    sdrMessagingAngle: insight.sdrMessagingAngle,
    confidence: insight.confidence,
    evidenceNote: insight.evidenceNote,
    source: insight.source,
    provider: insight.provider,
    modelName: insight.modelName,
    promptVersion: insight.promptVersion,
    errorMessage: insight.errorMessage,
    createdAt: insight.createdAt,
    updatedAt: insight.updatedAt,
  };
}

function readStringArray(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
