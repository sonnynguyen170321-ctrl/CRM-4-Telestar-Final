import type { CompanyScoreResult, CompanyType, Qualification } from "@/lib/types";

type ReviewCompany = {
  companyRecordId: string;
  uploadJobId: string | null;
  companyName: string;
  website: string | null;
  normalizedDomain: string | null;
  companyCountry: string | null;
  companyIndustry: string | null;
  companyStaffCountRange: string | null;
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
    researchedAt: string;
  } | null;
};

type SaveReviewFeedbackInput = {
  company: ReviewCompany;
  finalQualification: Qualification;
  finalCompanyType: CompanyType;
  finalCompanyScore: number;
  finalNote?: string;
};

type SaveReviewFeedbackResponse = {
  data?: {
    id?: string;
  };
  error?: string;
};

type SaveUploadReviewFeedbackInput = {
  uploadJobId: string;
  companyRecordId: string;
  companyScoreResultId?: string;
  sourceRowIndex: number;
  company: CompanyScoreResult;
  finalQualification: Qualification;
  finalCompanyType: CompanyType;
  finalCompanyScore: number;
  finalNote?: string;
};

const companyTypes: readonly CompanyType[] = [
  "Not Relevant",
  "PAAS",
  "SAAS",
  "Cloud",
  "ITO",
  "Data Solution",
  "AI Solution",
  "AI Service",
  "Cyber Security",
  "Blockchain Solution",
];

const qualifications: readonly Qualification[] = [
  "qualified",
  "unqualified",
  "uncertain",
];

export async function saveCompanyReviewFeedback({
  company,
  finalQualification,
  finalCompanyType,
  finalCompanyScore,
  finalNote,
}: SaveReviewFeedbackInput) {
  const response = await fetch("/api/feedback-examples", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyRecordId: company.companyRecordId,
      companyScoreResultId: company.scoreResult?.id,
      companyName: company.companyName,
      website: company.website ?? undefined,
      predictedCompanyScore: company.scoreResult?.companyScore,
      predictedCompanyType: toCompanyType(company.scoreResult?.companyType),
      predictedQualification: toQualification(
        company.scoreResult?.qualification
      ),
      predictedReason: company.scoreResult?.reason,
      finalCompanyScore,
      finalCompanyType,
      finalQualification,
      finalNote: finalNote?.trim() || undefined,
      approvedForLearning: false,
      useForPromptRefinement: false,
      useForRuleTuning: false,
      useForModelTraining: false,
      useForEvaluationBenchmark: false,
      datasetSplit: "unspecified",
      source: "api",
      rawExampleJson: buildReviewSnapshot({
        company,
        finalQualification,
        finalCompanyType,
        finalCompanyScore,
        finalNote,
      }),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as
    | SaveReviewFeedbackResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(
      "error" in body && body.error
        ? body.error
        : "Feedback save failed."
    );
  }

  if (!("data" in body) || !body.data?.id) {
    throw new Error("Feedback response did not include an id.");
  }

  return {
    id: body.data.id,
  };
}

export async function saveUploadReviewFeedback({
  uploadJobId,
  companyRecordId,
  companyScoreResultId,
  sourceRowIndex,
  company,
  finalQualification,
  finalCompanyType,
  finalCompanyScore,
  finalNote,
}: SaveUploadReviewFeedbackInput) {
  if (!companyRecordId) {
    throw new Error("Save company rows first before saving SDR feedback.");
  }

  const response = await fetch("/api/feedback-examples", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      companyRecordId,
      companyScoreResultId,
      companyName: company.company_name,
      website: company.website || undefined,
      predictedCompanyScore: company.company_score,
      predictedCompanyType: company.type,
      predictedQualification: company.qualification,
      predictedReason: company.reason,
      finalCompanyScore,
      finalCompanyType,
      finalQualification,
      finalNote: finalNote?.trim() || undefined,
      approvedForLearning: false,
      useForPromptRefinement: false,
      useForRuleTuning: false,
      useForModelTraining: false,
      useForEvaluationBenchmark: false,
      datasetSplit: "unspecified",
      source: "local_ui",
      rawExampleJson: {
        feedbackSource: "upload_local_scoring_preview",
        feedbackVersion: "feedback-v1",
        savedFrom: "/uploads",
        uploadJobId,
        sourceRowIndex,
        companySnapshot: {
          companyRecordId,
          uploadJobId,
          companyName: company.company_name,
          website: company.website ?? null,
          companyCountry: company.company_country ?? null,
          companyIndustry: null,
          companyStaffCountRange: null,
        },
        originalScoreResultSnapshot: {
          companyScoreResultId: companyScoreResultId ?? null,
          companyScore: company.company_score,
          qualification: company.qualification,
          companyType: company.type,
          confidence: company.confidence,
          reason: company.reason,
          oneSentenceCompanySummary: company.one_sentence_company_summary,
          hardRuleFlagsJson: company.hard_rule_flags,
          reviewState: company.review_state,
        },
        correction: {
          finalQualification,
          finalCompanyType,
          finalCompanyScore,
          finalNote: finalNote?.trim() || null,
        },
      },
    }),
  });

  const body = (await response.json().catch(() => ({}))) as
    | SaveReviewFeedbackResponse
    | Record<string, never>;

  if (!response.ok) {
    throw new Error(
      "error" in body && body.error
        ? body.error
        : "Feedback save failed."
    );
  }

  if (!("data" in body) || !body.data?.id) {
    throw new Error("Feedback response did not include an id.");
  }

  return {
    id: body.data.id,
  };
}

function buildReviewSnapshot({
  company,
  finalQualification,
  finalCompanyType,
  finalCompanyScore,
  finalNote,
}: SaveReviewFeedbackInput): Record<string, unknown> {
  return {
    feedbackSource: "sdr_review_drawer",
    feedbackVersion: "feedback-v1",
    savedFrom: "/companies",
    companySnapshot: {
      companyRecordId: company.companyRecordId,
      uploadJobId: company.uploadJobId,
      companyName: company.companyName,
      website: company.website,
      companyCountry: company.companyCountry,
      companyIndustry: company.companyIndustry,
      companyStaffCountRange: company.companyStaffCountRange,
      normalizedDomain: company.normalizedDomain,
    },
    originalScoreResultSnapshot: company.scoreResult
      ? {
          companyScoreResultId: company.scoreResult.id,
          companyScore: company.scoreResult.companyScore,
          qualification: company.scoreResult.qualification,
          companyType: company.scoreResult.companyType,
          confidence: company.scoreResult.confidence,
          reason: company.scoreResult.reason,
          oneSentenceCompanySummary:
            company.scoreResult.oneSentenceCompanySummary,
          hardRuleFlagsJson: company.scoreResult.hardRuleFlagsJson,
          reviewState: company.scoreResult.reviewState,
          scoringSource: company.scoreResult.scoringSource,
          scoringVersion: company.scoreResult.scoringVersion,
          createdAt: company.scoreResult.createdAt,
        }
      : null,
    websiteResearchSnapshot: company.websiteResearch
      ? {
          websiteResearchResultId: company.websiteResearch.id,
          status: company.websiteResearch.status,
          quality: company.websiteResearch.quality,
          reachable: company.websiteResearch.reachable,
          normalizedDomain: company.websiteResearch.normalizedDomain,
          finalUrl: company.websiteResearch.finalUrl,
          summary: company.websiteResearch.summary,
          signalsJson: company.websiteResearch.signalsJson,
          classificationHintsJson:
            company.websiteResearch.classificationHintsJson,
          researchedAt: company.websiteResearch.researchedAt,
        }
      : null,
    correction: {
      finalQualification,
      finalCompanyType,
      finalCompanyScore,
      finalNote: finalNote?.trim() || null,
    },
  };
}

function toCompanyType(value: string | null | undefined) {
  return companyTypes.includes(value as CompanyType)
    ? (value as CompanyType)
    : undefined;
}

function toQualification(value: string | null | undefined) {
  return qualifications.includes(value as Qualification)
    ? (value as Qualification)
    : undefined;
}
