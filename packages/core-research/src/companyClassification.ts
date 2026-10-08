import { INDUSTRY_KEYS } from "@telestar/core-scoring/rules/dictionaries/industry";
import { SIZE_BAND_KEYS } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import { z } from "zod";

// What a research candidate IS, decided from its own evidence rather than from the search that found it.
//
// Production (2026-10-08) shortlisted a school, two market-research publishers, a job board, a banks
// federation, a government ICT fund, a gaming event, a blog post and the software vendors that sell to an
// MRO target — all because the query's words appeared in their snippet. Fit cannot be judged until the
// candidate has been named: an association that mentions "aircraft maintenance" is still not a prospect.

/** Bump when the vocabulary or the grounding rules change, so cached classifications are re-run. */
export const CLASSIFIER_VERSION = 1;

export const COMPANY_KINDS = [
  "operator",
  "software_vendor",
  "services_agency",
  "reseller_wholesaler",
  "association_nonprofit",
  "government",
  "education",
  "media_news",
  "directory_marketplace_jobboard",
  "research_analyst",
  "event",
] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

export const NOT_COMPANY_REASONS = [
  "article",
  "listicle",
  "job_posting",
  "directory_page",
  "parked",
  "unrelated",
] as const;
export type NotCompanyReason = (typeof NOT_COMPANY_REASONS)[number];

export const CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
export type ClassificationConfidence = (typeof CONFIDENCE_LEVELS)[number];

export const MAX_EVIDENCE_ITEMS = 8;
export const MIN_QUOTE_CHARS = 8;
export const MAX_QUOTE_CHARS = 300;

export const ClassificationEvidenceSchema = z.strictObject({
  field: z.string().min(1).max(40),
  // A verbatim quote is the only thing that makes a claim checkable; groundClassification drops any
  // quote that is not literally in the evidence the model was shown.
  quote: z.string().min(MIN_QUOTE_CHARS).max(MAX_QUOTE_CHARS),
  sourceUrl: z.string().min(1).max(2000),
  // "rule" marks evidence a deterministic rule wrote (e.g. `host acme.com`). It is not a quote from the
  // page, so nothing may treat it as one. Only the rule layer sets it; groundClassification strips it
  // from anything the model returns.
  origin: z.literal("rule").optional(),
});

export const CompanyClassificationSchema = z
  .strictObject({
    isCompanySite: z.boolean(),
    notCompanyReason: z.enum(NOT_COMPANY_REASONS).nullable(),
    companyKind: z.enum(COMPANY_KINDS).nullable(),
    industryText: z.string().max(80).nullable(),
    industryKey: z.enum(INDUSTRY_KEYS).nullable(),
    whatTheySell: z.string().max(160).nullable(),
    hqCountry: z.string().max(80).nullable(),
    employeeCount: z.number().int().nonnegative().nullable(),
    employeeBand: z.enum(SIZE_BAND_KEYS).nullable(),
    confidence: z.enum(CONFIDENCE_LEVELS),
    evidence: z.array(ClassificationEvidenceSchema).max(MAX_EVIDENCE_ITEMS),
  })
  .superRefine((value, ctx) => {
    // A page that is not a company site has no company kind, and a company site has no excuse. Letting
    // both be set would let a downstream reader pick whichever half suited it.
    if (value.isCompanySite && value.notCompanyReason !== null) {
      ctx.addIssue({ code: "custom", path: ["notCompanyReason"], message: "a company site has no not-company reason" });
    }
    if (!value.isCompanySite && value.companyKind !== null) {
      ctx.addIssue({ code: "custom", path: ["companyKind"], message: "a non-company page has no company kind" });
    }
  });

export type CompanyClassification = z.infer<typeof CompanyClassificationSchema>;
export type ClassificationEvidence = z.infer<typeof ClassificationEvidenceSchema>;
