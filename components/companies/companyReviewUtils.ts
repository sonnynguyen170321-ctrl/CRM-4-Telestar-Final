import { compareRuleAndAi, type RuleAiComparison } from "@/lib/ai/compareRuleAndAi";

export type CompanyReviewRow = {
  companyRecordId: string;
  uploadJobId: string | null;
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
  archivedAt: string | null;
  deletedAt: string | null;
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
    createdAt: string;
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
    researchedAt: string;
    createdAt: string;
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
    createdAt: string;
    updatedAt: string;
  } | null;
  latestAiJob: {
    id: string;
    status: string;
    scope: string;
    provider?: string;
    model?: string;
    promptVersion?: string;
    cacheHit?: boolean;
    attemptCount?: number;
    maxAttempts?: number;
    lastErrorCode: string | null;
    lastErrorMessage: string | null;
    nextAttemptAt: string | null;
    lockedAt?: string | null;
    startedAt?: string | null;
    completedAt?: string | null;
    createdAt: string;
    updatedAt: string;
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
    brief: CompanyAiBriefFields;
    cacheHit: boolean;
    createdAt: string;
  } | null;
  latestIcpInsight?: {
    id: string;
    targetCustomerSegment: string | null;
    sdrMessagingAngle: string | null;
    source: string;
    createdAt: string;
  } | null;
};

export type CompanyAiBriefFields = {
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

export type AiDisplayState =
  | "no_ai"
  | "queued"
  | "running"
  | "retry_scheduled"
  | "failed"
  | "skipped"
  | "done";

export type AiDisplayTone = "slate" | "blue" | "amber" | "rose" | "green";

export type AiDisplayModel = {
  state: AiDisplayState;
  label: string;
  tone: AiDisplayTone;
  shortSummary: string;
  recommendedAction: string;
  canRetry: boolean;
  showAssessment: boolean;
  showJobError: boolean;
};

type AiDisplayInput = {
  latestAiAssessment: CompanyReviewRow["latestAiAssessment"];
  latestAiJob: CompanyReviewRow["latestAiJob"];
};

export function getAiDisplayState({
  latestAiAssessment,
  latestAiJob,
}: AiDisplayInput): AiDisplayModel {
  if (latestAiAssessment) {
    return {
      state: "done",
      label: "AI done",
      tone: "green",
      shortSummary: "AI second opinion is available.",
      recommendedAction: "Use as second opinion only.",
      canRetry: false,
      showAssessment: true,
      showJobError: false,
    };
  }

  if (!latestAiJob) {
    return {
      state: "no_ai",
      label: "No AI",
      tone: "slate",
      shortSummary: "Not assessed",
      recommendedAction: "Run AI to get a second opinion.",
      canRetry: false,
      showAssessment: false,
      showJobError: false,
    };
  }

  if (latestAiJob.status === "pending") {
    return {
      state: "queued",
      label: "AI queued",
      tone: "blue",
      shortSummary: "Waiting for worker",
      recommendedAction: "Waiting for AI worker.",
      canRetry: false,
      showAssessment: false,
      showJobError: false,
    };
  }

  if (latestAiJob.status === "running") {
    return {
      state: "running",
      label: "AI running",
      tone: "blue",
      shortSummary: "Processing",
      recommendedAction: "AI worker is processing this company.",
      canRetry: false,
      showAssessment: false,
      showJobError: false,
    };
  }

  if (latestAiJob.status === "retry_scheduled") {
    return {
      state: "retry_scheduled",
      label: "Retry scheduled",
      tone: "amber",
      shortSummary: latestAiJob.nextAttemptAt
        ? `Next retry: ${formatShortDateTime(latestAiJob.nextAttemptAt)}`
        : "Provider retry pending",
      recommendedAction:
        "Provider/quota issue. It will retry automatically when due.",
      canRetry: true,
      showAssessment: false,
      showJobError: true,
    };
  }

  if (latestAiJob.status === "failed") {
    return {
      state: "failed",
      label: "AI failed",
      tone: "rose",
      shortSummary: latestAiJob.lastErrorCode ?? "Manual retry",
      recommendedAction: "AI failed after max attempts. Manual retry is required.",
      canRetry: true,
      showAssessment: false,
      showJobError: true,
    };
  }

  if (latestAiJob.status === "skipped") {
    return {
      state: "skipped",
      label: "AI skipped",
      tone: "slate",
      shortSummary: latestAiJob.lastErrorCode ?? "Skipped",
      recommendedAction:
        "Skipped because a duplicate, already assessed, or missing-data condition was detected.",
      canRetry: false,
      showAssessment: false,
      showJobError: Boolean(latestAiJob.lastErrorMessage),
    };
  }

  if (latestAiJob.status === "succeeded") {
    return {
      state: "failed",
      label: "AI result missing",
      tone: "amber",
      shortSummary: "Job succeeded without visible assessment",
      recommendedAction:
        "Refresh AI status. If no assessment appears, inspect the job.",
      canRetry: true,
      showAssessment: false,
      showJobError: false,
    };
  }

  return {
    state: "no_ai",
    label: `AI ${latestAiJob.status.replaceAll("_", " ")}`,
    tone: "slate",
    shortSummary: "Status unavailable",
    recommendedAction: "Refresh AI status or inspect the job.",
    canRetry: false,
    showAssessment: false,
    showJobError: Boolean(latestAiJob.lastErrorMessage),
  };
}

export function getRuleAiComparisonForCompany(
  company: CompanyReviewRow
): RuleAiComparison {
  return compareRuleAndAi({
    localScoreResult: company.scoreResult
      ? {
          companyScore: company.scoreResult.companyScore,
          qualification: company.scoreResult.qualification,
          companyType: company.scoreResult.companyType ?? "Not Relevant",
        }
      : null,
    aiAssessment: company.latestAiAssessment
      ? {
          companyScore: company.latestAiAssessment.companyScore,
          qualification: company.latestAiAssessment.qualification,
          companyType: company.latestAiAssessment.companyType,
        }
      : null,
  });
}

export function formatAiAgreementLabel(
  comparison: Pick<RuleAiComparison, "disagreementLevel">
) {
  if (comparison.disagreementLevel === "none") {
    return "Agree";
  }

  if (comparison.disagreementLevel === "minor") {
    return "Minor disagreement";
  }

  if (comparison.disagreementLevel === "major") {
    return "Major disagreement";
  }

  return "Comparison unavailable";
}

export function formatAiConfidence(confidence: number) {
  return `${Math.round(confidence * 100)}%`;
}

export type EvidenceItem = {
  category: string;
  keyword: string;
  snippet: string;
  url: string | null;
};

export function getSignalLabels(signalsJson: unknown) {
  const signals = asSignalFlags(signalsJson);

  if (!signals) {
    return [];
  }

  return [
    signals.hasProductSignal ? "Product" : null,
    signals.hasServiceSignal ? "Service" : null,
    signals.hasPricingSignal ? "Pricing" : null,
    signals.hasApiSignal ? "API" : null,
    signals.hasAiSignal ? "AI" : null,
    signals.hasCloudSignal ? "Cloud" : null,
    signals.hasDataSignal ? "Data" : null,
    signals.hasSecuritySignal ? "Security" : null,
  ].filter((label): label is string => Boolean(label));
}

export function getCompanyBrief(company: CompanyReviewRow) {
  return buildCompanyBrief(company).oneLineSummary;
}

export type StructuredCompanyBrief = {
  source: "ai" | "website" | "local_rule" | "csv" | "empty";
  sourceLabel: string;
  sourceCopy: string;
  oneLineSummary: string;
  icpSegment?: string | null;
  targetCustomers?: string | null;
  productOrService?: string | null;
  industry?: string | null;
  niche?: string | null;
  outreachAngle?: string | null;
  evidenceSummary?: string | null;
  keyPainPoints: string[];
  risks?: string | null;
  recommendedNextAction?: string | null;
  fallbackReason?: string | null;
  confidence?: number;
  generatedAt?: string | null;
};

export function buildCompanyBrief(company: CompanyReviewRow): StructuredCompanyBrief {
  const ai = company.latestAiAssessment;

  if (ai) {
    const oneLineSummary =
      normalizeBrief(ai.oneSentenceCompanySummary) ??
      normalizeBrief(ai.brief.productOrService) ??
      normalizeBrief(ai.reason);

    if (oneLineSummary) {
      return {
        source: "ai",
        sourceLabel: "AI-generated",
        sourceCopy:
          "AI-generated brief. Use as SDR context, not final qualification.",
        oneLineSummary: limitSentences(oneLineSummary, 3),
        icpSegment:
          normalizeBrief(ai.brief.icpSegment) ??
          normalizeBrief(company.latestIcpInsight?.targetCustomerSegment),
        targetCustomers: normalizeBrief(ai.brief.targetCustomers),
        productOrService: normalizeBrief(ai.brief.productOrService),
        industry:
          normalizeBrief(ai.brief.industry) ??
          normalizeBrief(company.companyIndustry),
        niche: normalizeBrief(ai.brief.niche),
        outreachAngle:
          normalizeBrief(ai.brief.outreachAngle) ??
          normalizeBrief(company.latestIcpInsight?.sdrMessagingAngle),
        evidenceSummary:
          normalizeBrief(ai.brief.evidenceSummary) ??
          normalizeBrief(ai.reason),
        keyPainPoints: ai.brief.keyPainPoints,
        risks: normalizeBrief(ai.brief.risks),
        recommendedNextAction: normalizeBrief(ai.brief.recommendedNextAction),
        confidence: ai.confidence,
        generatedAt: ai.createdAt,
      };
    }
  }

  if (company.websiteResearch) {
    const signalLabels = getSignalLabels(company.websiteResearch.signalsJson);
    const summary = normalizeBrief(company.websiteResearch.summary);

    if (summary || signalLabels.length > 0) {
      return {
        source: "website",
        sourceLabel: "Website research",
        sourceCopy: "Based on website research signals.",
        oneLineSummary: limitSentences(
          summary ??
            `${company.companyName} has website research signals: ${signalLabels.join(
              ", "
            )}.`,
          3
        ),
        industry: normalizeBrief(company.companyIndustry),
        productOrService:
          signalLabels.length > 0 ? signalLabels.slice(0, 5).join(", ") : undefined,
        evidenceSummary:
          signalLabels.length > 0
            ? `Website signals: ${signalLabels.slice(0, 6).join(", ")}.`
            : `Website research quality: ${company.websiteResearch.quality}.`,
        keyPainPoints: [],
        generatedAt: company.websiteResearch.researchedAt,
      };
    }
  }

  const localSummary = normalizeBrief(company.scoreResult?.oneSentenceCompanySummary);
  const localReason = normalizeBrief(company.scoreResult?.reason);
  const localBrief = localSummary ?? localReason;

  if (localBrief) {
    const generic = isGenericLocalBrief(localBrief);
    return {
      source: "local_rule",
      sourceLabel: "Local rule fallback",
      sourceCopy: "Rule-based fallback. Context may be limited.",
      oneLineSummary: limitSentences(localBrief, 2),
      industry: normalizeBrief(company.companyIndustry),
      productOrService: normalizeBrief(company.scoreResult?.companyType),
      evidenceSummary: generic
        ? "Local scoring context is generic. Review AI or website research before outreach."
        : localReason,
      keyPainPoints: [],
      fallbackReason: generic
        ? "The available local-rule brief is generic."
        : "AI-generated brief is not available.",
      confidence: company.scoreResult?.confidence,
      generatedAt: company.scoreResult?.createdAt,
    };
  }

  if (
    company.companyName ||
    company.website ||
    company.companyLinkedInUrl ||
    company.companyCountry ||
    company.companyIndustry
  ) {
    return {
      source: "csv",
      sourceLabel: "CSV fallback",
      sourceCopy: "Limited context from uploaded row.",
      oneLineSummary:
        "Limited company context is available. Review website or LinkedIn before outreach.",
      industry: normalizeBrief(company.companyIndustry),
      evidenceSummary: [
        company.website ? `Website: ${company.website}` : null,
        company.companyLinkedInUrl ? "LinkedIn URL is present." : null,
        company.companyCountry ? `Country: ${company.companyCountry}` : null,
      ]
        .filter((item): item is string => Boolean(item))
        .join(" "),
      keyPainPoints: [],
      fallbackReason: "No AI assessment or website research brief is available.",
    };
  }

  return {
    source: "empty",
    sourceLabel: "No brief",
    sourceCopy: "No strong brief available yet.",
    oneLineSummary:
      "No strong company brief is available yet. Run AI or review website research before outreach.",
    keyPainPoints: [],
    fallbackReason: "No AI, website research, local rule, or CSV context is available.",
  };
}

export function getEvidenceItems(signalsJson: unknown, limit = 5) {
  if (!isRecord(signalsJson)) {
    return [];
  }

  const groups = [
    "productSignals",
    "serviceSignals",
    "pricingSignals",
    "apiSignals",
    "aiSignals",
    "cloudSignals",
    "dataSignals",
    "securitySignals",
  ];
  const evidence: EvidenceItem[] = [];

  for (const group of groups) {
    const value = signalsJson[group];

    if (!Array.isArray(value)) {
      continue;
    }

    for (const item of value) {
      if (!isRecord(item) || typeof item.snippet !== "string") {
        continue;
      }

      evidence.push({
        category: typeof item.category === "string" ? item.category : group,
        keyword: typeof item.keyword === "string" ? item.keyword : "signal",
        snippet: item.snippet,
        url: typeof item.url === "string" ? item.url : null,
      });

      if (evidence.length >= limit) {
        return evidence;
      }
    }
  }

  return evidence;
}

export function getClassificationHints(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    likelyProductLed: value.likelyProductLed === true,
    likelyServiceLed: value.likelyServiceLed === true,
    likelySaas: value.likelySaas === true,
    likelyCloud: value.likelyCloud === true,
    likelyAi: value.likelyAi === true,
    likelyDataSolution: value.likelyDataSolution === true,
    likelyCyberSecurity: value.likelyCyberSecurity === true,
    likelyNotRelevant: value.likelyNotRelevant === true,
  };
}

export function getHardRuleFlags(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }

  return Object.entries(value)
    .filter(([, flagValue]) => typeof flagValue === "boolean")
    .map(([key, flagValue]) => ({
      key,
      triggered: flagValue,
    }));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asSignalFlags(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  return {
    hasProductSignal: value.hasProductSignal === true,
    hasServiceSignal: value.hasServiceSignal === true,
    hasPricingSignal: value.hasPricingSignal === true,
    hasApiSignal: value.hasApiSignal === true,
    hasAiSignal: value.hasAiSignal === true,
    hasCloudSignal: value.hasCloudSignal === true,
    hasDataSignal: value.hasDataSignal === true,
    hasSecuritySignal: value.hasSecuritySignal === true,
  };
}

function normalizeBrief(value: string | null | undefined) {
  const trimmed = value?.trim();

  return trimmed || null;
}

function limitSentences(value: string, maxSentences: number) {
  const sentences = value
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);

  if (sentences.length <= maxSentences) {
    return value;
  }

  return sentences.slice(0, maxSentences).join(" ");
}

function isGenericLocalBrief(value: string) {
  const normalized = value.toLowerCase();

  return (
    normalized.includes("website research suggests") ||
    normalized.includes("signal quality") ||
    normalized.includes("fit with weak") ||
    normalized.includes("fit with medium") ||
    normalized.includes("fit with strong signal")
  );
}

function formatShortDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
