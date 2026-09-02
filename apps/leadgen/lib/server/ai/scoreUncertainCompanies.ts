import type { Prisma } from "@/app/generated/prisma/client";

import type { AiScoringMode } from "@/lib/server/ai/config";
import {
  AI_COMPANY_SCORING_PROMPT_VERSION,
  aiCompanyScoringResponseSchema,
  buildAiCompanyScoringPrompts,
  parseAiCompanyScoringOutput,
  validateAiLabels,
} from "@/lib/server/ai/companyScoring";
import { getConfiguredAiProvider } from "@/lib/server/ai/providers";
import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";
import { prisma } from "@/lib/server/prisma";

type AiScoreResultStatus = "scored" | "skipped" | "failed";
type PersistedAiScoringMode = Exclude<AiScoringMode, "disabled">;

export type ScoreCompaniesWithAiSummary = {
  success: true;
  skipped: boolean;
  reason: string | null;
  uploadJobId: string;
  candidateCount: number;
  alreadyAssessedCount: number;
  scoredCount: number;
  failedCount: number;
  skippedDueToCapCount: number;
  maxRowsPerUpload: number;
  provider: string;
  model: string;
  promptVersion: string;
  mode: AiScoringMode;
  results: Array<{
    companyRecordId: string;
    companyName: string;
    status: AiScoreResultStatus;
    reason?: string;
  }>;
};

type CompanyRecordForAi = Prisma.CompanyRecordGetPayload<{
  include: {
    scoreResults: {
      orderBy: { createdAt: "desc" };
      take: 1;
    };
    websiteResearchResults: {
      orderBy: { createdAt: "desc" };
      take: 1;
    };
  };
}>;

export async function scoreUncertainCompaniesForUpload(
  uploadJobId: string
): Promise<ScoreCompaniesWithAiSummary> {
  return scoreCompaniesWithAiForUpload(uploadJobId, {
    forcedMode: "uncertain_only",
  });
}

export async function scoreCompaniesWithAiForUpload(
  uploadJobId: string,
  options: { forcedMode?: PersistedAiScoringMode } = {}
): Promise<ScoreCompaniesWithAiSummary> {
  const status = await getEffectiveAiStatus();
  const mode = options.forcedMode ?? status.mode;

  if (!status.usable || mode === "disabled") {
    return {
      success: true,
      skipped: true,
      reason: status.reason ?? "AI is not usable.",
      uploadJobId,
      candidateCount: 0,
      alreadyAssessedCount: 0,
      scoredCount: 0,
      failedCount: 0,
      skippedDueToCapCount: 0,
      maxRowsPerUpload: status.maxRowsPerUpload,
      provider: status.provider,
      model: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode,
      results: [],
    };
  }

  const assessmentMode = mode as PersistedAiScoringMode;

  const companyRecords = await prisma.companyRecord.findMany({
    where: {
      uploadJobId,
      archivedAt: null,
      deletedAt: null,
    },
    orderBy: { createdAt: "asc" },
    include: {
      scoreResults: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      websiteResearchResults: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  const candidates = companyRecords.filter((companyRecord) => {
    const latestScore = companyRecord.scoreResults[0];

    if (!latestScore) {
      return false;
    }

    if (assessmentMode === "uncertain_only") {
      return latestScore.qualification === "UNCERTAIN";
    }

    return true;
  });

  const provider = getConfiguredAiProvider();
  const modelName = status.model;
  const results: ScoreCompaniesWithAiSummary["results"] = [];
  let alreadyAssessedCount = 0;
  let scoredCount = 0;
  let failedCount = 0;
  const existingSuccessfulAssessmentCount =
    await prisma.companyAiAssessment.count({
      where: {
        companyRecord: { uploadJobId },
        provider: status.provider,
        modelName,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        mode: assessmentMode,
        errorMessage: null,
      },
    });

  const pendingCandidates: CompanyRecordForAi[] = [];

  for (const companyRecord of candidates) {
    const latestScore = companyRecord.scoreResults[0];

    if (!latestScore) {
      continue;
    }

    const existingAssessment = await prisma.companyAiAssessment.findFirst({
      where: {
        companyRecordId: companyRecord.id,
        localScoreResultId: latestScore.id,
        provider: status.provider,
        modelName,
        promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
        mode: assessmentMode,
        errorMessage: null,
      },
      select: { id: true },
    });

    if (existingAssessment) {
      alreadyAssessedCount += 1;
      results.push({
        companyRecordId: companyRecord.id,
        companyName: companyRecord.companyName,
        status: "skipped",
        reason: "Already assessed for the latest local score.",
      });
      continue;
    }

    pendingCandidates.push(companyRecord);
  }

  const remainingCapacity = Math.max(
    status.maxRowsPerUpload - existingSuccessfulAssessmentCount,
    0
  );
  const candidatesWithinCap = pendingCandidates.slice(0, remainingCapacity);
  const skippedDueToCapCount = Math.max(
    pendingCandidates.length - candidatesWithinCap.length,
    0
  );

  if (remainingCapacity <= 0) {
    for (const companyRecord of pendingCandidates) {
      results.push({
        companyRecordId: companyRecord.id,
        companyName: companyRecord.companyName,
        status: "skipped",
        reason: "AI max rows per upload cap reached.",
      });
    }

    return {
      success: true,
      skipped: false,
      reason: null,
      uploadJobId,
      candidateCount: candidates.length,
      alreadyAssessedCount,
      scoredCount: 0,
      failedCount: 0,
      skippedDueToCapCount,
      maxRowsPerUpload: status.maxRowsPerUpload,
      provider: status.provider,
      model: modelName,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: assessmentMode,
      results,
    };
  }

  for (const companyRecord of candidatesWithinCap) {
    const latestScore = companyRecord.scoreResults[0];
    const latestWebsiteResearch = companyRecord.websiteResearchResults[0] ?? null;

    if (!latestScore) {
      continue;
    }

    try {
      const inputSnapshot = buildAiInputSnapshot(
        companyRecord,
        latestScore,
        latestWebsiteResearch
      );
      const websiteSignalsSnapshot = buildWebsiteSignalsSnapshot(
        latestWebsiteResearch
      );
      const prompts = buildAiCompanyScoringPrompts(inputSnapshot);
      const response = await provider.generateText({
        systemPrompt: prompts.systemPrompt,
        userPrompt: prompts.userPrompt,
        model: modelName,
        temperature: 0.1,
        maxOutputTokens: 1200,
        responseMimeType: "application/json",
        responseSchema: aiCompanyScoringResponseSchema,
        requestId: crypto.randomUUID(),
        metadata: {
          route: "/api/upload-jobs/[id]/ai-score",
          aiScoringMode: assessmentMode,
          uploadJobId,
          companyRecordId: companyRecord.id,
        },
      });
      const parsed = parseAiCompanyScoringOutput(response.text);
      validateAiLabels(parsed);

      await prisma.companyAiAssessment.create({
        data: {
          companyRecordId: companyRecord.id,
          localScoreResultId: latestScore.id,
          provider: response.provider,
          modelName: response.model,
          promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
          mode: assessmentMode,
          qualification: parsed.qualification,
          companyType: parsed.companyType,
          companyScore: parsed.companyScore,
          confidence: parsed.confidence,
          reason: parsed.reason,
          oneSentenceCompanySummary: parsed.oneSentenceCompanySummary,
          inputSnapshotJson: inputSnapshot,
          websiteSignalsSnapshotJson: websiteSignalsSnapshot,
          rawResponseJson: {
            text: response.text,
          },
          finishReason: response.finishReason,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs: response.latencyMs,
        },
      });

      scoredCount += 1;
      results.push({
        companyRecordId: companyRecord.id,
        companyName: companyRecord.companyName,
        status: "scored",
      });
    } catch (error) {
      failedCount += 1;
      results.push({
        companyRecordId: companyRecord.id,
        companyName: companyRecord.companyName,
        status: "failed",
        reason:
          error instanceof Error
            ? error.message
            : "AI assessment failed for this row.",
      });
    }
  }

  for (const companyRecord of pendingCandidates.slice(remainingCapacity)) {
    results.push({
      companyRecordId: companyRecord.id,
      companyName: companyRecord.companyName,
      status: "skipped",
      reason: "AI max rows per upload cap reached.",
    });
  }

  return {
    success: true,
    skipped: false,
    reason: null,
    uploadJobId,
    candidateCount: candidates.length,
    alreadyAssessedCount,
    scoredCount,
    failedCount,
    skippedDueToCapCount,
    maxRowsPerUpload: status.maxRowsPerUpload,
    provider: status.provider,
    model: modelName,
    promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
    mode: assessmentMode,
    results,
  };
}

function buildAiInputSnapshot(
  companyRecord: CompanyRecordForAi,
  latestScore: CompanyRecordForAi["scoreResults"][number],
  latestWebsiteResearch: CompanyRecordForAi["websiteResearchResults"][number] | null
) {
  return {
    company: {
      companyName: companyRecord.companyName,
      website: companyRecord.website,
      companyCountry: companyRecord.companyCountry,
      companyIndustry: companyRecord.companyIndustry,
      companyStaffCountRange: companyRecord.companyStaffCountRange,
      companyLinkedInUrl: companyRecord.companyLinkedInUrl,
      notes: companyRecord.note,
    },
    localScore: {
      localScoreResultId: latestScore.id,
      localScore: latestScore.companyScore,
      localQualification: latestScore.qualification.toLowerCase(),
      localCompanyType: latestScore.companyType,
      localReason: latestScore.reason,
      localConfidence: Number(latestScore.confidence),
      hardRuleFlags: latestScore.hardRuleFlags,
    },
    websiteEvidence: buildWebsiteSignalsSnapshot(latestWebsiteResearch),
  };
}

function buildWebsiteSignalsSnapshot(
  latestWebsiteResearch: CompanyRecordForAi["websiteResearchResults"][number] | null
) {
  if (!latestWebsiteResearch) {
    return {
      available: false,
      reason: "No website research result is linked to this company row.",
    };
  }

  return {
    available: true,
    reachable: latestWebsiteResearch.reachable,
    status: latestWebsiteResearch.status,
    quality: latestWebsiteResearch.quality,
    normalizedUrl: latestWebsiteResearch.normalizedUrl,
    normalizedDomain: latestWebsiteResearch.normalizedDomain,
    finalUrl: latestWebsiteResearch.finalUrl,
    httpStatus: latestWebsiteResearch.httpStatus,
    summary: latestWebsiteResearch.summary,
    signals: latestWebsiteResearch.signalsJson,
    classificationHints: latestWebsiteResearch.classificationHintsJson,
    errors: latestWebsiteResearch.errorsJson,
  };
}
