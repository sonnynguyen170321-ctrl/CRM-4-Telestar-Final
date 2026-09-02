// CINT1: the STABLE company-intelligence reasoning contract. Every engine
// (rule-based, LLM, or a future stronger AI) emits exactly this shape. Scoring
// (controlledTokens + evidenceQuality) and UI (the SDR answers) depend only on this
// contract — so the reasoning engine can be upgraded without rewiring downstream.
// Maps onto existing JSON columns (classificationJson / evidenceItemsJson /
// factsJson / confidenceJson / sourceCoverageJson) — no schema change.

export type Confidence = "HIGH" | "MEDIUM" | "LOW";

export type EvidenceRef = {
  url: string;
  text: string; // the cited snippet/highlight that backs the claim
  pageType: string; // HOMEPAGE | ABOUT | PRODUCT | ... | NEWS | SEARCH
  provider?: "website" | "exa" | "brave" | "serper" | "searxng" | "ddg";
};

// A reasoned answer + its grounding. A claim with no evidence is INVALID and must
// be dropped by the validator (no uncited claims reach scoring/UI).
export type ReasonedField<T> = {
  value: T;
  confidence: Confidence;
  evidence: EvidenceRef[];
};

export type OfferingType =
  | "saas" | "vertical_saas" | "product" | "service"
  | "marketplace" | "ecommerce_platform" | "agency" | "unknown";

export type BusinessModelKind = "B2B" | "B2C" | "B2B2C" | "hybrid" | "unknown";
export type SalesChannel = "direct" | "partner" | "marketplace" | "reseller";

export type PartnershipClaim = {
  name: string;
  kind: "partner" | "integration" | "customer";
  confidence: Confidence;
  evidence: EvidenceRef[];
};

export type GrowthSignal = {
  kind: "hiring" | "funding" | "new_market" | "new_office" | "product_launch";
  detail: string;
  confidence: Confidence;
  evidence: EvidenceRef[];
};

// The 5 SDR answers + grounding.
export type CompanyIntelligenceReasoning = {
  offering: ReasonedField<{
    type: OfferingType;
    vertical: string | null; // e.g. "ecommerce", "dropshipping"
    primaryOffering: string; // one phrase
  }>;
  businessModel: ReasonedField<{
    model: BusinessModelKind;
    pricingModel: string | null;
  }>;
  channels: ReasonedField<SalesChannel[]>;
  growth: {
    hiring: ReasonedField<{ real: boolean }>;
    signals: GrowthSignal[];
  };
  partnerships: PartnershipClaim[];

  overallConfidence: Confidence;
  evidenceQuality: {
    pagesFetched: number;
    usefulPages: number;
    uniqueSources: number;
    score: number; // sufficiency totalScore
    conflicts: string[];
  };

  // Scoring consumes ONLY these controlled tokens (stable vocabulary) — never raw
  // text. New tokens => scoring inputFingerprint changes => re-score (Inv 6).
  controlledTokens: string[];

  engineTrace: {
    engine: "rules" | "llm" | "hybrid";
    llmUsed: boolean;
    pipelineVersion: number;
    notes: string[];
  };
};

// What every engine receives. Pure evidence bundle — no DB, no provider clients.
export type ReasoningInput = {
  companyName: string;
  canonicalDomain: string | null;
  country: string | null;
  // Imported industry label (e.g. from a LinkedIn/CSV upload). A WEAK prior only — it is frequently
  // wrong (VN food companies routinely arrive tagged "Machinery"), so it can nudge a category that
  // already has web evidence but can never, on its own, assign one. See linkedInIndustryHint / taxonomy.
  industryRaw?: string | null;
  pages: Array<{
    url: string;
    pageType: string;
    title: string | null;
    metaDescription: string | null;
    headings: string[];
    mainText: string | null;
  }>;
  searchResults: EvidenceRef[];
};

export interface ReasoningEngine {
  readonly id: "rules" | "llm" | "hybrid";
  reason(input: ReasoningInput): Promise<CompanyIntelligenceReasoning>;
}

/** Low-confidence empty reasoning for the unknown / no-evidence case. */
export function emptyReasoning(
  pipelineVersion: number,
  engine: "rules" | "llm" | "hybrid"
): CompanyIntelligenceReasoning {
  const lowField = <T>(value: T): ReasonedField<T> => ({ value, confidence: "LOW", evidence: [] });
  return {
    offering: lowField({ type: "unknown", vertical: null, primaryOffering: "" }),
    businessModel: lowField({ model: "unknown", pricingModel: null }),
    channels: lowField<SalesChannel[]>([]),
    growth: { hiring: lowField({ real: false }), signals: [] },
    partnerships: [],
    overallConfidence: "LOW",
    evidenceQuality: { pagesFetched: 0, usefulPages: 0, uniqueSources: 0, score: 0, conflicts: [] },
    controlledTokens: [],
    engineTrace: { engine, llmUsed: false, pipelineVersion, notes: ["no_evidence"] },
  };
}

/** Drops any field/claim whose evidence array is empty (no uncited claims). */
export function dropUncitedClaims(r: CompanyIntelligenceReasoning): CompanyIntelligenceReasoning {
  const offering = r.offering.evidence.length > 0
    ? r.offering
    : {
        value: { type: "unknown" as const, vertical: null, primaryOffering: "" },
        confidence: "LOW" as const,
        evidence: [],
      };
  const businessModel = r.businessModel.evidence.length > 0
    ? r.businessModel
    : {
        value: { model: "unknown" as const, pricingModel: null },
        confidence: "LOW" as const,
        evidence: [],
      };
  const channels = r.channels.evidence.length > 0
    ? r.channels
    : { value: [], confidence: "LOW" as const, evidence: [] };
  const hiring = r.growth.hiring.evidence.length > 0
    ? r.growth.hiring
    : { value: { real: false }, confidence: "LOW" as const, evidence: [] };

  return {
    ...r,
    offering,
    businessModel,
    channels,
    growth: {
      hiring,
      signals: r.growth.signals.filter((s) => s.evidence.length > 0),
    },
    partnerships: r.partnerships.filter((p) => p.evidence.length > 0),
  };
}
