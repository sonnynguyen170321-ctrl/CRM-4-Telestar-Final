import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";

import {
  AI_COMPANY_ICP_PROMPT_VERSION,
  buildCompanyIcpPrompts,
  companyIcpInsightResponseSchema,
  parseCompanyIcpInsightOutput,
} from "@/lib/server/ai/companyIcp";
import { getConfiguredAiProvider } from "@/lib/server/ai/providers";
import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";
import {
  companyTypeFromPrisma,
  feedbackSourceFromPrisma,
  qualificationFromPrisma,
} from "@/lib/server/api/enums";
import { prisma } from "@/lib/server/prisma";

const icpArraySchema = z
  .array(z.string().trim().min(1).max(120))
  .max(12)
  .default([]);

export const saveCompanyIcpInsightSchema = z.object({
  targetCustomerSegment: z.string().trim().max(500).optional().nullable(),
  targetVerticals: icpArraySchema,
  buyerPersonas: icpArraySchema,
  useCasesPainPoints: icpArraySchema,
  sdrMessagingAngle: z.string().trim().max(700).optional().nullable(),
  confidence: z.coerce.number().min(0).max(1).optional().nullable(),
  evidenceNote: z.string().trim().max(700).optional().nullable(),
});

export type SaveCompanyIcpInsightInput = z.infer<
  typeof saveCompanyIcpInsightSchema
>;

type CompanyIcpInsightRecord = Awaited<
  ReturnType<typeof prisma.companyIcpInsight.findMany>
>[number];

export async function getCompanyIcpInsights(companyRecordId: string) {
  const companyRecord = await prisma.companyRecord.findUnique({
    where: { id: companyRecordId },
    select: { id: true },
  });

  if (!companyRecord) {
    return null;
  }

  const [latestInsight, historyCount] = await Promise.all([
    prisma.companyIcpInsight.findFirst({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.companyIcpInsight.count({
      where: { companyRecordId },
    }),
  ]);

  return {
    latestInsight: latestInsight ? mapCompanyIcpInsight(latestInsight) : null,
    historyCount,
  };
}

export async function saveCompanyIcpInsight(
  companyRecordId: string,
  input: SaveCompanyIcpInsightInput
) {
  const companyRecord = await prisma.companyRecord.findUnique({
    where: { id: companyRecordId },
    select: { id: true },
  });

  if (!companyRecord) {
    return null;
  }

  const saved = await prisma.companyIcpInsight.create({
    data: {
      companyRecordId,
      targetCustomerSegment: normalizeOptionalText(input.targetCustomerSegment),
      targetVerticalsJson: input.targetVerticals,
      buyerPersonasJson: input.buyerPersonas,
      useCasesPainPointsJson: input.useCasesPainPoints,
      sdrMessagingAngle: normalizeOptionalText(input.sdrMessagingAngle),
      confidence: input.confidence ?? null,
      evidenceNote: normalizeOptionalText(input.evidenceNote),
      source: "sdr_edit",
    },
  });

  return mapCompanyIcpInsight(saved);
}

export async function generateCompanyIcpInsight(companyRecordId: string) {
  const status = await getEffectiveAiStatus();

  if (!status.usable) {
    return {
      ok: false as const,
      status: 400,
      error: status.reason ?? "AI is not usable.",
    };
  }

  const context = await getCompanyIcpContext(companyRecordId);

  if (!context) {
    return {
      ok: false as const,
      status: 404,
      error: "Company record not found.",
    };
  }

  const provider = getConfiguredAiProvider();
  const prompts = buildCompanyIcpPrompts(context.inputSnapshot);

  try {
    const response = await provider.generateText({
      systemPrompt: prompts.systemPrompt,
      userPrompt: prompts.userPrompt,
      model: status.model,
      temperature: 0.2,
      maxOutputTokens: 900,
      responseMimeType: "application/json",
      responseSchema: companyIcpInsightResponseSchema,
      requestId: crypto.randomUUID(),
      metadata: {
        route: "/api/company-records/[id]/icp-insights/generate",
        companyRecordId,
      },
    });
    const parsed = parseCompanyIcpInsightOutput(response.text);

    const saved = await prisma.companyIcpInsight.create({
      data: {
        companyRecordId,
        targetCustomerSegment: parsed.targetCustomerSegment,
        targetVerticalsJson: parsed.targetVerticals,
        buyerPersonasJson: parsed.buyerPersonas,
        useCasesPainPointsJson: parsed.useCasesPainPoints,
        sdrMessagingAngle: parsed.sdrMessagingAngle,
        confidence: parsed.confidence,
        evidenceNote: parsed.evidenceNote,
        source: "ai",
        provider: response.provider,
        modelName: response.model,
        promptVersion: AI_COMPANY_ICP_PROMPT_VERSION,
        rawAiResponseJson: {
          text: response.text,
          finishReason: response.finishReason,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs: response.latencyMs,
        },
      },
    });

    return {
      ok: true as const,
      data: mapCompanyIcpInsight(saved),
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Company ICP generation failed.";

    const saved = await prisma.companyIcpInsight.create({
      data: {
        companyRecordId,
        source: "ai",
        provider: status.provider,
        modelName: status.model,
        promptVersion: AI_COMPANY_ICP_PROMPT_VERSION,
        rawAiResponseJson: context.inputSnapshot,
        errorMessage: message,
      },
    });

    return {
      ok: false as const,
      status: 400,
      error: message,
      data: mapCompanyIcpInsight(saved),
    };
  }
}

function mapCompanyIcpInsight(insight: CompanyIcpInsightRecord) {
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
    createdAt: insight.createdAt.toISOString(),
    updatedAt: insight.updatedAt.toISOString(),
  };
}

async function getCompanyIcpContext(companyRecordId: string) {
  const [
    companyRecord,
    latestScore,
    latestWebsiteResearch,
    latestAiAssessment,
    latestFeedback,
  ] = await Promise.all([
    prisma.companyRecord.findUnique({
      where: { id: companyRecordId },
    }),
    prisma.companyScoreResult.findFirst({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.websiteResearchResult.findFirst({
      where: { companyRecordId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.companyAiAssessment.findFirst({
      where: { companyRecordId, errorMessage: null },
      orderBy: { createdAt: "desc" },
    }),
    prisma.feedbackExample.findFirst({
      where: {
        OR: [{ companyRecordId }, { companyScoreResult: { companyRecordId } }],
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  if (!companyRecord) {
    return null;
  }

  return {
    inputSnapshot: {
      company: {
        companyName: companyRecord.companyName,
        website: companyRecord.website,
        companyCountry: companyRecord.companyCountry,
        companyIndustry: companyRecord.companyIndustry,
        companyLinkedInUrl: companyRecord.companyLinkedInUrl,
        companyStaffCountRange: companyRecord.companyStaffCountRange,
        note: companyRecord.note,
      },
      websiteEvidence: latestWebsiteResearch
        ? {
            reachable: latestWebsiteResearch.reachable,
            status: latestWebsiteResearch.status,
            quality: latestWebsiteResearch.quality,
            normalizedDomain: latestWebsiteResearch.normalizedDomain,
            finalUrl: latestWebsiteResearch.finalUrl,
            summary: latestWebsiteResearch.summary,
            signals: latestWebsiteResearch.signalsJson,
            classificationHints:
              latestWebsiteResearch.classificationHintsJson,
          }
        : {
            available: false,
          },
      localRuleResult: latestScore
        ? {
            qualification: qualificationFromPrisma(latestScore.qualification),
            companyType: companyTypeFromPrisma(latestScore.companyType),
            companyScore: latestScore.companyScore,
            confidence: Number(latestScore.confidence),
            reason: latestScore.reason,
            oneSentenceCompanySummary:
              latestScore.oneSentenceCompanySummary,
          }
        : null,
      aiAssessment: latestAiAssessment
        ? {
            qualification: latestAiAssessment.qualification,
            companyType: latestAiAssessment.companyType,
            companyScore: latestAiAssessment.companyScore,
            confidence: latestAiAssessment.confidence,
            reason: latestAiAssessment.reason,
            oneSentenceCompanySummary:
              latestAiAssessment.oneSentenceCompanySummary,
          }
        : null,
      sdrFeedback: latestFeedback
        ? {
            finalCompanyScore: latestFeedback.finalCompanyScore,
            finalCompanyType: companyTypeFromPrisma(
              latestFeedback.finalCompanyType
            ),
            finalQualification: qualificationFromPrisma(
              latestFeedback.finalQualification
            ),
            finalNote: latestFeedback.finalNote,
            source: feedbackSourceFromPrisma(latestFeedback.source),
          }
        : null,
    } satisfies Prisma.JsonObject,
  };
}

function normalizeOptionalText(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}

function readStringArray(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}
