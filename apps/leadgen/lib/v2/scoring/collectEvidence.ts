import type {
  CollectedEvidenceItem,
  EvidenceCollectionResult,
  EvidenceSourceType,
  HardGateEvaluation,
  NormalizedScoringContext,
  ScoringSignalRule,
} from "./types";

type EvidenceCandidate = {
  source: EvidenceSourceType;
  value: string;
};

export function collectEvidence(
  context: NormalizedScoringContext,
  hardGateEvaluation?: HardGateEvaluation
): EvidenceCollectionResult {
  void hardGateEvaluation;

  const candidates = buildEvidenceCandidates(context);
  const items = [
    ...collectSignalEvidence(context.icpRules.positiveSignals, candidates),
    ...collectSignalEvidence(context.icpRules.negativeSignals, candidates),
  ];
  const positiveItems = items.filter((item) => item.direction === "positive");
  const negativeItems = items.filter((item) => item.direction === "negative");

  return {
    items,
    positiveItems,
    negativeItems,
    summary: {
      totalCount: items.length,
      positiveCount: positiveItems.length,
      negativeCount: negativeItems.length,
      sourceCount: countBySource(items),
    },
  };
}

function collectSignalEvidence(
  rules: ScoringSignalRule[],
  candidates: EvidenceCandidate[]
): CollectedEvidenceItem[] {
  const items: CollectedEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    for (const keyword of rule.keywords || []) {
      const normalizedKeyword = normalizeComparableText(keyword);

      if (!normalizedKeyword) {
        continue;
      }

      for (const candidate of candidates) {
        if (!rule.evidenceSources.includes(candidate.source)) {
          continue;
        }

        if (!normalizeComparableText(candidate.value).includes(normalizedKeyword)) {
          continue;
        }

        const key = [
          rule.id,
          candidate.source,
          normalizedKeyword,
          normalizeComparableText(candidate.value),
        ].join("|");

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        items.push({
          signalRuleId: rule.id,
          label: rule.label,
          direction: rule.direction,
          source: candidate.source,
          matchedValue: candidate.value,
          matchedKeyword: keyword,
          weight: rule.weight,
          reliabilityPrior: rule.reliabilityPrior,
          reasonCode: rule.reasonCode,
        });
      }
    }
  }

  return items;
}

function buildEvidenceCandidates(
  context: NormalizedScoringContext
): EvidenceCandidate[] {
  return [
    ...csvCandidates(context),
    ...websiteCandidates(context),
  ].filter((candidate) => candidate.value.trim().length > 0);
}

function csvCandidates(context: NormalizedScoringContext): EvidenceCandidate[] {
  return [
    context.company.companyName,
    context.company.normalizedCompanyName,
    context.company.companyIndustry,
    context.company.normalizedCompanyIndustry,
    context.company.companyCountry,
    context.company.canonicalDomain,
    context.company.notes,
  ].map((value) => ({
    source: "csv_field",
    value: value || "",
  }));
}

function websiteCandidates(
  context: NormalizedScoringContext
): EvidenceCandidate[] {
  const evidence = context.websiteEvidence;

  return [
    ...evidence.productSignals.map((value) => ({
      source: "website_subpage" as const,
      value,
    })),
    ...evidence.pricingSignals.map((value) => ({
      source: "website_metadata" as const,
      value,
    })),
    ...evidence.apiSignals.map((value) => ({
      source: "website_metadata" as const,
      value,
    })),
    ...evidence.serviceSignals.map((value) => ({
      source: "website_homepage" as const,
      value,
    })),
    ...evidence.aiSignals.map((value) => ({
      source: "website_metadata" as const,
      value,
    })),
    ...evidence.cloudSignals.map((value) => ({
      source: "website_metadata" as const,
      value,
    })),
    ...evidence.dataSignals.map((value) => ({
      source: "website_metadata" as const,
      value,
    })),
    ...evidence.securitySignals.map((value) => ({
      source: "website_metadata" as const,
      value,
    })),
  ];
}

function countBySource(
  items: CollectedEvidenceItem[]
): Partial<Record<EvidenceSourceType, number>> {
  return items.reduce<Partial<Record<EvidenceSourceType, number>>>(
    (counts, item) => ({
      ...counts,
      [item.source]: (counts[item.source] || 0) + 1,
    }),
    {}
  );
}

function normalizeComparableText(value?: string | null): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ");
}
