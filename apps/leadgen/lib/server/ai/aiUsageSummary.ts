import { AI_COMPANY_SCORING_PROMPT_VERSION } from "@/lib/server/ai/companyScoring";
import { getEffectiveAiStatus } from "@/lib/server/ai/runtimeSettings";
import { prisma } from "@/lib/server/prisma";

export type UploadAiUsageSummary = {
  uploadJobId: string;
  provider: string;
  model: string;
  promptVersion: string;
  mode: string;
  maxRowsPerUpload: number;
  assessmentCount: number;
  successfulAssessmentCount: number;
  failedAssessmentCount: number;
  remainingCapacity: number;
  capReached: boolean;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  averageLatencyMs: number | null;
  latestAssessmentAt: string | null;
};

export async function getUploadAiUsageSummary(uploadJobId: string) {
  const status = await getEffectiveAiStatus();
  const assessments = await prisma.companyAiAssessment.findMany({
    where: {
      companyRecord: { uploadJobId },
      provider: status.provider,
      modelName: status.model,
      promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
      mode: status.mode === "disabled" ? undefined : status.mode,
    },
    orderBy: { createdAt: "desc" },
    select: {
      errorMessage: true,
      inputTokens: true,
      outputTokens: true,
      latencyMs: true,
      createdAt: true,
    },
  });
  const successfulAssessments = assessments.filter(
    (assessment) => !assessment.errorMessage
  );
  const failedAssessmentCount =
    assessments.length - successfulAssessments.length;
  const totalInputTokens = sumNullable(
    successfulAssessments.map((assessment) => assessment.inputTokens)
  );
  const totalOutputTokens = sumNullable(
    successfulAssessments.map((assessment) => assessment.outputTokens)
  );
  const averageLatencyMs = averageNullable(
    successfulAssessments.map((assessment) => assessment.latencyMs)
  );
  const remainingCapacity = Math.max(
    status.maxRowsPerUpload - successfulAssessments.length,
    0
  );

  return {
    uploadJobId,
    provider: status.provider,
    model: status.model,
    promptVersion: AI_COMPANY_SCORING_PROMPT_VERSION,
    mode: status.mode,
    maxRowsPerUpload: status.maxRowsPerUpload,
    assessmentCount: assessments.length,
    successfulAssessmentCount: successfulAssessments.length,
    failedAssessmentCount,
    remainingCapacity,
    capReached: remainingCapacity <= 0,
    totalInputTokens,
    totalOutputTokens,
    totalTokens:
      totalInputTokens === null && totalOutputTokens === null
        ? null
        : (totalInputTokens ?? 0) + (totalOutputTokens ?? 0),
    averageLatencyMs,
    latestAssessmentAt: assessments[0]?.createdAt.toISOString() ?? null,
  } satisfies UploadAiUsageSummary;
}

function sumNullable(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);

  if (present.length === 0) {
    return null;
  }

  return present.reduce((sum, value) => sum + value, 0);
}

function averageNullable(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null);

  if (present.length === 0) {
    return null;
  }

  return Math.round(
    present.reduce((sum, value) => sum + value, 0) / present.length
  );
}
