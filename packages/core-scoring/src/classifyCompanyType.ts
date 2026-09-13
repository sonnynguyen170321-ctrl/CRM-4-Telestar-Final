import type {
  CollectedEvidenceItem,
  CompanyTypeClassificationResult,
  CompanyTypeRule,
  EvidenceCollectionResult,
  NormalizedScoringContext,
} from "./types";

type CompanyTypeRuleMatch = {
  rule: CompanyTypeRule;
  positiveMatches: string[];
  negativeMatches: string[];
  matchScore: number;
};

export function classifyCompanyType(
  context: NormalizedScoringContext,
  evidence: EvidenceCollectionResult
): CompanyTypeClassificationResult {
  const matches = context.icpRules.companyTypeRules
    .map((rule) => matchCompanyTypeRule(rule, context, evidence.items))
    .filter((match) => match.matchScore > 0)
    .sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }

      return right.rule.defaultScoreImpact - left.rule.defaultScoreImpact;
    });

  if (matches.length === 0) {
    return {
      selectedType: "unknown",
      matchedRuleIds: [],
      scoreImpact: 0,
      reviewRequired: true,
      ambiguous: true,
      reasonCodes: ["company_type_unknown"],
    };
  }

  const selectedMatch = matches[0];
  const competingMatches = matches.filter(
    (match) => match.matchScore === selectedMatch.matchScore
  );
  const ambiguous = competingMatches.length > 1;
  const hasNegativeCaution = selectedMatch.negativeMatches.length > 0;

  return {
    selectedType: selectedMatch.rule.type,
    selectedRuleId: selectedMatch.rule.id,
    matchedRuleIds: matches.map((match) => match.rule.id),
    scoreImpact: selectedMatch.rule.defaultScoreImpact,
    reviewRequired:
      Boolean(selectedMatch.rule.reviewRequired) || ambiguous || hasNegativeCaution,
    ambiguous,
    reasonCodes: [
      ...matches.map((match) => `company_type_${match.rule.type}`),
      ...(hasNegativeCaution ? ["company_type_negative_keyword_caution"] : []),
    ],
  };
}

function matchCompanyTypeRule(
  rule: CompanyTypeRule,
  context: NormalizedScoringContext,
  evidenceItems: CollectedEvidenceItem[]
): CompanyTypeRuleMatch {
  const candidateTexts = buildCandidateTexts(context, evidenceItems);
  const positiveMatches = matchKeywords(rule.positiveKeywords || [], candidateTexts);
  const negativeMatches = matchKeywords(rule.negativeKeywords || [], candidateTexts);
  const matchScore = Math.max(0, positiveMatches.length - negativeMatches.length);

  return {
    rule,
    positiveMatches,
    negativeMatches,
    matchScore,
  };
}

function buildCandidateTexts(
  context: NormalizedScoringContext,
  evidenceItems: CollectedEvidenceItem[]
): string[] {
  return [
    context.company.companyName,
    context.company.normalizedCompanyName,
    context.company.companyIndustry,
    context.company.normalizedCompanyIndustry,
    context.company.notes,
    ...evidenceItems.map((item) => item.matchedValue),
    ...evidenceItems.map((item) => item.matchedKeyword || ""),
  ].filter((value): value is string => Boolean(value));
}

function matchKeywords(keywords: string[], candidateTexts: string[]): string[] {
  const matches = new Set<string>();

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeComparableText(keyword);

    if (!normalizedKeyword) {
      continue;
    }

    if (
      candidateTexts.some((text) =>
        normalizeComparableText(text).includes(normalizedKeyword)
      )
    ) {
      matches.add(keyword);
    }
  }

  return Array.from(matches);
}

function normalizeComparableText(value?: string | null): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");
}
