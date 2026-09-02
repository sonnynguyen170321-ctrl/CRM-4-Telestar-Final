export type RuleScoreForAiComparison = {
  companyScore: number;
  qualification: string;
  companyType: string;
};

export type AiAssessmentForComparison = {
  companyScore: number;
  qualification: string;
  companyType: string;
} | null;

export type RuleAiComparison = {
  hasAiAssessment: boolean;
  localScore: number | null;
  aiScore: number | null;
  scoreDelta: number | null;
  localQualification: string | null;
  aiQualification: string | null;
  localCompanyType: string | null;
  aiCompanyType: string | null;
  qualificationAgreement: boolean | null;
  companyTypeAgreement: boolean | null;
  scoreBandAgreement: boolean | null;
  disagreementLevel: "none" | "minor" | "major" | "not_available";
  summary: string;
};

export function compareRuleAndAi({
  localScoreResult,
  aiAssessment,
}: {
  localScoreResult: RuleScoreForAiComparison | null;
  aiAssessment: AiAssessmentForComparison;
}): RuleAiComparison {
  if (!localScoreResult || !aiAssessment) {
    return {
      hasAiAssessment: Boolean(aiAssessment),
      localScore: localScoreResult?.companyScore ?? null,
      aiScore: aiAssessment?.companyScore ?? null,
      scoreDelta: null,
      localQualification: localScoreResult?.qualification ?? null,
      aiQualification: aiAssessment?.qualification ?? null,
      localCompanyType: localScoreResult?.companyType ?? null,
      aiCompanyType: aiAssessment?.companyType ?? null,
      qualificationAgreement: null,
      companyTypeAgreement: null,
      scoreBandAgreement: null,
      disagreementLevel: "not_available",
      summary: "Rule-vs-AI comparison is not available yet.",
    };
  }

  const scoreDelta = Math.abs(
    localScoreResult.companyScore - aiAssessment.companyScore
  );
  const qualificationAgreement =
    localScoreResult.qualification === aiAssessment.qualification;
  const companyTypeAgreement =
    localScoreResult.companyType === aiAssessment.companyType;
  const scoreBandAgreement =
    getScoreBand(localScoreResult.companyScore) ===
    getScoreBand(aiAssessment.companyScore);
  const disagreementLevel = getDisagreementLevel({
    qualificationAgreement,
    companyTypeAgreement,
    scoreDelta,
  });

  return {
    hasAiAssessment: true,
    localScore: localScoreResult.companyScore,
    aiScore: aiAssessment.companyScore,
    scoreDelta,
    localQualification: localScoreResult.qualification,
    aiQualification: aiAssessment.qualification,
    localCompanyType: localScoreResult.companyType,
    aiCompanyType: aiAssessment.companyType,
    qualificationAgreement,
    companyTypeAgreement,
    scoreBandAgreement,
    disagreementLevel,
    summary: buildSummary(disagreementLevel, {
      qualificationAgreement,
      companyTypeAgreement,
      scoreBandAgreement,
      scoreDelta,
    }),
  };
}

function getDisagreementLevel({
  qualificationAgreement,
  companyTypeAgreement,
  scoreDelta,
}: {
  qualificationAgreement: boolean;
  companyTypeAgreement: boolean;
  scoreDelta: number;
}): RuleAiComparison["disagreementLevel"] {
  if (!qualificationAgreement || scoreDelta > 20) {
    return "major";
  }

  if (!companyTypeAgreement || scoreDelta > 10) {
    return "minor";
  }

  return "none";
}

function buildSummary(
  disagreementLevel: RuleAiComparison["disagreementLevel"],
  details: {
    qualificationAgreement: boolean;
    companyTypeAgreement: boolean;
    scoreBandAgreement: boolean;
    scoreDelta: number;
  }
) {
  if (disagreementLevel === "none") {
    return "AI broadly agrees with the local rule result.";
  }

  if (disagreementLevel === "minor") {
    return `AI is close to the local rule result, but differs on ${
      details.companyTypeAgreement ? "score" : "company type"
    } with a score delta of ${details.scoreDelta}.`;
  }

  return `AI materially differs from the local rule result. Qualification agreement: ${
    details.qualificationAgreement ? "yes" : "no"
  }; score-band agreement: ${details.scoreBandAgreement ? "yes" : "no"}.`;
}

function getScoreBand(score: number) {
  if (score <= 29) {
    return "not_relevant";
  }

  if (score <= 49) {
    return "weak_fit";
  }

  if (score <= 69) {
    return "possible_fit";
  }

  if (score <= 84) {
    return "strong_fit";
  }

  return "very_strong_fit";
}
