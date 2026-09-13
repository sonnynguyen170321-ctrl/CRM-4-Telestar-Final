import type { CompanyEvidence } from "@telestar/core-scoring/icpRulesSchema";
import { COMPANY_INTEL_PIPELINE_VERSION } from "./pipelineVersion";
import { mapNeutralFactsToCompanyEvidence } from "./mapIntelligenceToCompanyEvidence";

export const COMPANY_INTELLIGENCE_SCORING_MAPPING_VERSION = 1;

export type CompanyIntelligenceScoringTrace = {
  profileId: string;
  researchVersion: number;
  pipelineVersion: number;
  mappingVersion: number;
  profileStatus: string;
  controlledTokens: string[];
  mappedTokens: string[];
  evidenceConfidence: number;
  band: "HIGH" | "MEDIUM" | "LOW";
  confidenceAdjustment: number;
  hasUsableEvidence: boolean;
};

export function mapIntelligenceProfileToScoring(input: {
  profileId: string;
  researchVersion: number;
  profileStatus: string;
  factsJson: unknown;
  sourceCoverageJson: unknown;
  confidenceJson: unknown;
}): { companyEvidence: Partial<CompanyEvidence>; trace: CompanyIntelligenceScoringTrace } {
  const rawTokens = Array.isArray(input.factsJson)
    ? [...new Set(input.factsJson.filter((value): value is string => typeof value === "string"))].sort()
    : [];
  // W2: no usable website content (SERP-only) → the identity/classification claims (industry, category,
  // vertical, offering, business model) are snippet guesses that routinely mislabel — a table-reservations
  // site (ontopo.com) came back "category.cybersecurity". Drop them from the SCORED evidence so the
  // company dimensions can't reach a confident STRONG_ACCOUNT_FIT on unverified SERP data; those companies
  // land in NEEDS_REVIEW instead of auto-qualifying. The tokens stay in factsJson for display (advisory).
  const pagesWithContent = readPagesWithContent(input.sourceCoverageJson);
  const controlledTokens =
    pagesWithContent === 0
      ? rawTokens.filter((token) => !/^(category|industry|vertical|offering|business_model|model)\./.test(token))
      : rawTokens;
  const base = mapNeutralFactsToCompanyEvidence(controlledTokens, {
    sourceCoverageJson: input.sourceCoverageJson,
    profileStatus: input.profileStatus,
  });
  const mappedTokens = controlledTokens.filter(isMappedToken);
  const companyEvidence = augmentControlledEvidence(base, mappedTokens);
  const confidence = asRecord(input.confidenceJson);
  const rawBand = confidence.band ?? confidence.overallConfidence;
  const band = rawBand === "HIGH" || rawBand === "MEDIUM" ? rawBand : "LOW";
  const evidenceConfidence = typeof confidence.evidenceConfidence === "number"
    ? Math.max(0, Math.min(1, confidence.evidenceConfidence))
    : band === "HIGH" ? 0.85 : band === "MEDIUM" ? 0.6 : 0.3;
  const usableByProfile = input.profileStatus === "EXTRACTED" || input.profileStatus === "PARTIAL";
  const hasUsableEvidence = usableByProfile && mappedTokens.length > 0 && confidence.hasUsableEvidence !== false;
  const confidenceAdjustment = !usableByProfile
    ? -5
    : !hasUsableEvidence
      ? 0
      : band === "HIGH"
        ? 5
        : band === "MEDIUM"
          ? 2
          : 0;

  return {
    companyEvidence,
    trace: {
      profileId: input.profileId,
      researchVersion: input.researchVersion,
      pipelineVersion: readPipelineVersion(input.sourceCoverageJson),
      mappingVersion: COMPANY_INTELLIGENCE_SCORING_MAPPING_VERSION,
      profileStatus: input.profileStatus,
      controlledTokens,
      mappedTokens,
      evidenceConfidence,
      band,
      confidenceAdjustment,
      hasUsableEvidence,
    },
  };
}

function augmentControlledEvidence(base: Partial<CompanyEvidence>, tokens: string[]): Partial<CompanyEvidence> {
  const product = new Set(base.productSignals ?? []);
  const service = new Set(base.serviceSignals ?? []);
  const platform = new Set(base.platformSignals ?? []);
  const pricing = new Set(base.pricingSignals ?? []);
  const notes = base.notes ? [base.notes] : [];
  const descriptions = base.description ? [base.description] : [];

  for (const token of tokens) {
    const value = token.split(".").slice(1).join(" ").replace(/_/g, " ");
    if (token.startsWith("offering.")) {
      if (/service|agency/.test(token)) service.add(value);
      else product.add(value);
      descriptions.push(`${value} offering`);
    } else if (token.startsWith("category.") || token.startsWith("vertical.")) {
      product.add(value);
      descriptions.push(value);
    } else if (token.startsWith("pricing.")) {
      pricing.add(value);
    } else if (token.startsWith("channel.")) {
      notes.push(`${value} sales channel`);
    } else if (token.startsWith("model.")) {
      notes.push(`${value.toUpperCase()} business model`);
    } else if (token === "proof.has_partnerships") {
      notes.push("partnership evidence");
    } else if (token.startsWith("growth.")) {
      notes.push(`${value} growth signal`);
    }
    if (token.includes("platform")) platform.add(value);
  }

  const description = unique(descriptions).join("; ") || undefined;
  const noteText = unique(notes).join("; ") || undefined;
  return {
    ...base,
    description,
    productSignals: product.size ? [...product] : undefined,
    serviceSignals: service.size ? [...service] : undefined,
    platformSignals: platform.size ? [...platform] : undefined,
    pricingSignals: pricing.size ? [...pricing] : undefined,
    notes: noteText,
    evidenceText: [base.evidenceText, description, noteText].filter(Boolean).join("; ") || undefined,
  };
}

function isMappedToken(token: string): boolean {
  return /^(offering|business_model|industry|maturity|growth|news|proof|risk|geo|size|revenue|location|vertical|category|model|pricing|channel)\./.test(token);
}

function readPipelineVersion(value: unknown): number {
  const version = asRecord(value).pipelineVersion;
  return typeof version === "number" && Number.isInteger(version) ? version : COMPANY_INTEL_PIPELINE_VERSION;
}

// Returns pagesWithContent from sourceCoverageJson, or -1 (unknown) when absent — so the SERP-only
// gate only fires on an explicit 0, never on a profile that simply didn't record the field.
function readPagesWithContent(value: unknown): number {
  const n = asRecord(value).pagesWithContent;
  return typeof n === "number" && Number.isFinite(n) ? n : -1;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
