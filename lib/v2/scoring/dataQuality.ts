import type {
  DataQualityAssessment,
  DataQualityIssue,
  NormalizedScoringContext,
} from "./types";

const HEALTHY_WEBSITE_EVIDENCE_STATUSES = new Set(["reachable"]);
const PROBLEMATIC_WEBSITE_EVIDENCE_STATUSES = new Set([
  "blocked",
  "parked",
  "empty",
]);

export function assessDataQuality(
  context: NormalizedScoringContext
): DataQualityAssessment {
  const issues: DataQualityIssue[] = [];
  const hasCompanyIdentity = Boolean(context.company.normalizedCompanyName);
  const hasWebsiteIdentity = Boolean(context.company.canonicalDomain);
  const hasGeography = Boolean(context.company.normalizedCompanyCountry);
  const hasCompanySize = Boolean(
    context.company.staffRange.minEmployees ||
      context.company.staffRange.maxEmployees
  );
  const hasWebsiteEvidence = context.websiteEvidence.status !== "missing";
  const hasProductOrServiceEvidence =
    context.websiteEvidence.productSignals.length > 0 ||
    context.websiteEvidence.serviceSignals.length > 0 ||
    context.websiteEvidence.pricingSignals.length > 0 ||
    context.websiteEvidence.apiSignals.length > 0 ||
    context.websiteEvidence.aiSignals.length > 0 ||
    context.websiteEvidence.cloudSignals.length > 0 ||
    context.websiteEvidence.dataSignals.length > 0 ||
    context.websiteEvidence.securitySignals.length > 0;

  if (!hasCompanyIdentity) {
    issues.push({
      code: "missing_company_name",
      label: "Company name is missing.",
      severity: "critical",
      field: "companyName",
    });
  }

  if (!hasWebsiteIdentity) {
    issues.push({
      code: "missing_website",
      label: "Website or canonical domain is missing.",
      severity: "review_pressure",
      field: "website",
    });
  }

  if (!hasGeography) {
    issues.push({
      code: "missing_country",
      label: "Company country is missing.",
      severity: "review_pressure",
      field: "companyCountry",
    });
  }

  if (!hasCompanySize) {
    issues.push({
      code: "missing_company_size",
      label: "Company size is missing or could not be parsed.",
      severity: "review_pressure",
      field: "companyStaffCountRange",
    });
  }

  if (!hasWebsiteEvidence) {
    issues.push({
      code: "missing_website_evidence",
      label: "Website evidence is not available.",
      severity: "confidence_penalty",
      field: "websiteEvidence",
    });
  } else if (
    PROBLEMATIC_WEBSITE_EVIDENCE_STATUSES.has(context.websiteEvidence.status)
  ) {
    issues.push({
      code: "website_not_reachable",
      label: `Website evidence status requires review: ${context.websiteEvidence.status}.`,
      severity: "confidence_penalty",
      field: "websiteEvidence.status",
    });
  } else if (
    !HEALTHY_WEBSITE_EVIDENCE_STATUSES.has(context.websiteEvidence.status)
  ) {
    issues.push({
      code: "website_not_reachable",
      label: "Website evidence indicates the site is not reachable.",
      severity: "confidence_penalty",
      field: "websiteEvidence.status",
    });
  }

  if (
    hasWebsiteEvidence &&
    context.websiteEvidence.quality === "weak" &&
    !hasProductOrServiceEvidence
  ) {
    issues.push({
      code: "weak_website_evidence",
      label: "Website evidence is weak and has no product or service signals.",
      severity: "confidence_penalty",
      field: "websiteEvidence.quality",
    });
  }

  const qualityScore = clampQualityScore(
    100 -
      issues.reduce((scoreImpact, issue) => {
        if (issue.severity === "critical") {
          return scoreImpact + 30;
        }

        if (issue.severity === "review_pressure") {
          return scoreImpact + 15;
        }

        return scoreImpact + 10;
      }, 0)
  );

  return {
    qualityScore,
    qualityLevel: qualityScore >= 80 ? "high" : qualityScore >= 55 ? "medium" : "low",
    hasCompanyIdentity,
    hasWebsiteIdentity,
    hasGeography,
    hasCompanySize,
    hasWebsiteEvidence,
    hasProductOrServiceEvidence,
    reviewRequired: issues.some(
      (issue) =>
        issue.severity === "critical" || issue.severity === "review_pressure"
    ),
    confidencePressure: clampConfidencePressure((100 - qualityScore) / 100),
    issues,
  };
}

function clampQualityScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function clampConfidencePressure(value: number): number {
  return Math.max(0, Math.min(1, value));
}
