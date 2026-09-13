// The shape of a persisted company-intelligence profile, as the presenter consumes it.
//
// It lives in the package rather than beside the query that loads it because this package is what
// produces the data: facts, evidence items, classification, coverage and confidence all come out of
// the crawl-and-reason pipeline here. Each app reads its own table and returns this shape, so the
// presenter can stay shared instead of being duplicated per schema.

export type CompanyProfileStatus = "PLACEHOLDER" | "EXTRACTED" | "PARTIAL" | "FAILED";

export type CompanyIntelligenceEvidenceItem = {
  token: string;
  family: string;
  evidenceText: string;
  sourceUrl: string;
  // Persisted alongside every item since CINT5 but previously dropped at parse time —
  // the drawer's evidence view uses them for source badges.
  pageType: string | null;
  provider: string | null;
  confidence: string | null;
};

export type CompanyIntelligenceProfileSummary = {
  id: string;
  companySummary: string | null;
  facts: string[];
  factsByFamily: Array<{ family: string; tokens: string[] }>;
  evidenceItems: CompanyIntelligenceEvidenceItem[];
  evidenceByFamily: Array<{
    family: string;
    items: CompanyIntelligenceEvidenceItem[];
  }>;
  classification: unknown;
  sourceCoverage: unknown;
  riskSignals: unknown;
  confidence: unknown;
  profileStatus: CompanyProfileStatus;
  staleAt: string | null;
  researchVersion: number;
  createdAt: string;
};
