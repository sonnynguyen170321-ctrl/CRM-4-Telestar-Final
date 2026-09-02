import { z } from "zod";

import {
  companyTypeValues,
  datasetSplitValues,
  feedbackSourceValues,
  qualificationValues,
  reviewStateValues,
  uploadJobStatusValues,
} from "@/lib/server/api/enums";

const optionalTrimmedString = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value === "" ? undefined : value));

const requiredTrimmedString = z.string().trim().min(1);

const scoreSchema = z.number().int().min(0).max(100);
const confidenceSchema = z.number().min(0).max(1);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const jsonArraySchema = z.array(z.unknown());

export const uploadJobCreateSchema = z.object({
  fileName: requiredTrimmedString,
  status: z.enum(uploadJobStatusValues).optional(),
  totalRows: z.number().int().min(0).optional(),
  processedRows: z.number().int().min(0).optional(),
  errorMessage: optionalTrimmedString,
});

export const deleteConfirmationSchema = z.object({
  confirm: z.literal("DELETE"),
});

export const companyRecordCreateSchema = z.object({
  uploadJobId: optionalTrimmedString,
  sourceRowIndex: z.number().int().min(0).optional(),
  companyName: requiredTrimmedString,
  website: optionalTrimmedString,
  companyCountry: optionalTrimmedString,
  companyLinkedInUrl: optionalTrimmedString,
  companyIndustry: optionalTrimmedString,
  companyPhone1: optionalTrimmedString,
  companyStaffCountRange: optionalTrimmedString,
  type: z.enum(companyTypeValues).optional(),
  note: optionalTrimmedString,
  rawRowJson: jsonObjectSchema.optional(),
});

export const companyScoreResultCreateSchema = z.object({
  companyRecordId: requiredTrimmedString,
  companyType: z.enum(companyTypeValues).optional(),
  companyScore: scoreSchema,
  qualification: z.enum(qualificationValues),
  confidence: confidenceSchema,
  reason: requiredTrimmedString,
  oneSentenceCompanySummary: optionalTrimmedString,
  hardRuleFlags: jsonObjectSchema.default({}),
  reviewState: z.enum(reviewStateValues).optional(),
  scoringSource: optionalTrimmedString,
  scoringVersion: optionalTrimmedString,
});

export const feedbackExampleCreateSchema = z.object({
  companyRecordId: optionalTrimmedString,
  companyScoreResultId: optionalTrimmedString,
  feedbackImportJobId: optionalTrimmedString,
  companyName: requiredTrimmedString,
  website: optionalTrimmedString,
  predictedCompanyScore: scoreSchema.optional(),
  predictedCompanyType: z.enum(companyTypeValues).optional(),
  predictedQualification: z.enum(qualificationValues).optional(),
  predictedReason: optionalTrimmedString,
  finalCompanyScore: scoreSchema,
  finalCompanyType: z.enum(companyTypeValues),
  finalQualification: z.enum(qualificationValues),
  finalNote: optionalTrimmedString,
  approvedForLearning: z.boolean().optional(),
  useForPromptRefinement: z.boolean().optional(),
  useForRuleTuning: z.boolean().optional(),
  useForModelTraining: z.boolean().optional(),
  useForEvaluationBenchmark: z.boolean().optional(),
  datasetSplit: z.enum(datasetSplitValues).optional(),
  promptVersion: optionalTrimmedString,
  ruleVersion: optionalTrimmedString,
  modelVersion: optionalTrimmedString,
  source: z.enum(feedbackSourceValues).optional(),
  rawExampleJson: jsonObjectSchema.optional(),
});

export const feedbackImportJobCreateSchema = z.object({
  fileName: requiredTrimmedString,
  status: z.enum(uploadJobStatusValues).optional(),
  totalRows: z.number().int().min(0).optional(),
  processedRows: z.number().int().min(0).optional(),
  errorMessage: optionalTrimmedString,
});

export const exportJobCreateSchema = z.object({
  uploadJobId: optionalTrimmedString,
  fileName: requiredTrimmedString,
  exportType: optionalTrimmedString,
  rowCount: z.number().int().min(0).optional(),
});

const websiteResearchResultSchema = z.object({
  inputUrl: requiredTrimmedString,
  normalizedUrl: z.string().trim().nullable().optional(),
  normalizedDomain: z.string().trim().nullable().optional(),
  finalUrl: z.string().trim().nullable().optional(),
  reachable: z.boolean(),
  status: requiredTrimmedString,
  httpStatus: z.number().int().nullable().optional(),
  redirectChain: z.array(z.string()).default([]),
  pagesChecked: jsonArraySchema.default([]),
  signals: jsonObjectSchema,
  quality: requiredTrimmedString,
  classificationHints: jsonObjectSchema,
  summary: requiredTrimmedString,
  errors: z.array(z.string()).default([]),
  researchedAt: requiredTrimmedString,
});

export const websiteResearchResultCreateSchema = z.object({
  companyRecordId: optionalTrimmedString,
  uploadJobId: optionalTrimmedString,
  result: websiteResearchResultSchema,
});
