import { z } from "zod";

import { REGION_KEYS } from "./dictionaries/regions";
import { SENIORITY_TIERS, DEPARTMENTS } from "./dictionaries/seniority";
import { SIZE_BAND_KEYS } from "./dictionaries/sizeBands";

// SC1: multi-ICP rule schema v2 (plan 4c.2). Additive — does NOT replace the v1
// `icpRulesSchema.ts` runtime. Expresses the 8 dimensions the 18-ICP corpus needs
// that v1 could not: region expansion, office-location != HQ, priority tiers,
// persona allowlist/denylist/tiers/seniority/department, qualitative size,
// generic-email + competitor disqualifiers, conditional market exception,
// account-supplied lists, and sub-ICPs.
//
// Pure schema + types. No I/O, no provider calls, no DB, no V1 business imports.

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const COMPANY_TYPES_V2 = [
  "PRODUCT_SAAS",
  "PRODUCT_PLATFORM",
  "SERVICE_ONLY",
  "SERVICE_PLUS_PRODUCT",
  "MARKETPLACE",
  "AGENCY",
  "UNKNOWN",
] as const;
export type CompanyTypeV2 = (typeof COMPANY_TYPES_V2)[number];

export const LOCATION_SCOPES = ["hq", "any_office", "delivery"] as const;
export type LocationScope = (typeof LOCATION_SCOPES)[number];

export const UNKNOWN_DATA_POLICIES = [
  "review_required",
  "low_confidence_continue",
  "soft_penalty",
  "fail",
] as const;
export type UnknownDataPolicyV2 = (typeof UNKNOWN_DATA_POLICIES)[number];

export const INDUSTRY_MODES = ["all", "allowlist", "denylist"] as const;
export type IndustryMode = (typeof INDUSTRY_MODES)[number];

export const ACCOUNT_SUPPLIED_MODES = [
  "score",
  "preapproved_skip",
  "preapproved_autoqualify",
] as const;
export type AccountSuppliedMode = (typeof ACCOUNT_SUPPLIED_MODES)[number];

const enumOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values);

const stringList = z.array(z.string().min(1));

// ---------------------------------------------------------------------------
// Geography (region expansion + office-location != HQ + priority tiers)
// ---------------------------------------------------------------------------

const PriorityTierSchema = z
  .object({
    tier: z.number().int().min(1),
    countries: stringList,
    weightBonus: z.number().int().min(0).max(50),
  })
  .strict();

const GeographyRulesV2Schema = z
  .object({
    targetCountries: stringList,
    excludedCountries: stringList,
    targetRegions: z.array(enumOf([...REGION_KEYS] as [string, ...string[]])),
    locationScope: enumOf([...LOCATION_SCOPES] as [string, ...string[]]),
    // "has an office/factory in X" — distinct from HQ country.
    requiredOfficeCountries: stringList,
    excludedOfficeCountries: stringList,
    priorityTiers: z.array(PriorityTierSchema),
    // Free-form sub-national scopes, e.g. "German-speaking Switzerland".
    subNationalRegions: stringList,
    unknownCountryPolicy: enumOf([...UNKNOWN_DATA_POLICIES] as [string, ...string[]]),
  })
  .strict();
export type GeographyRulesV2 = z.infer<typeof GeographyRulesV2Schema>;

// ---------------------------------------------------------------------------
// Industry (mode + allow/deny + keywords + sub-industries)
// ---------------------------------------------------------------------------

const IndustryRulesV2Schema = z
  .object({
    mode: enumOf([...INDUSTRY_MODES] as [string, ...string[]]),
    targetIndustries: stringList,
    excludedIndustries: stringList,
    industryKeywords: stringList,
    subIndustries: stringList,
  })
  .strict();
export type IndustryRulesV2 = z.infer<typeof IndustryRulesV2Schema>;

// ---------------------------------------------------------------------------
// Company type (+ services/consulting conditional market exception)
// ---------------------------------------------------------------------------

const ServicesConsultingPolicySchema = z
  .object({
    disqualify: z.boolean(),
    // Markets where services/consulting is allowed despite disqualify=true.
    // TeleStar: services/consulting OK in Vietnam only.
    exceptMarkets: stringList,
  })
  .strict();

const CompanyTypeRulesV2Schema = z
  .object({
    allow: z.array(enumOf([...COMPANY_TYPES_V2] as [string, ...string[]])),
    deny: z.array(enumOf([...COMPANY_TYPES_V2] as [string, ...string[]])),
    servicesConsultingPolicy: ServicesConsultingPolicySchema,
  })
  .strict();
export type CompanyTypeRulesV2 = z.infer<typeof CompanyTypeRulesV2Schema>;

// ---------------------------------------------------------------------------
// Persona (allowlist + denylist + tiers + seniority + department overrides)
// ---------------------------------------------------------------------------

const seniorityEnum = enumOf([...SENIORITY_TIERS] as [string, ...string[]]);
const departmentEnum = enumOf([...DEPARTMENTS] as [string, ...string[]]);

const PersonaTitleTierSchema = z
  .object({
    tier: z.number().int().min(1),
    titles: stringList,
    keywords: stringList,
    weight: z.number().int().min(0).max(100),
  })
  .strict();

const PersonaRulesV2Schema = z
  .object({
    titleAllowlist: stringList,
    titleDenylist: stringList,
    titleTiers: z.array(PersonaTitleTierSchema),
    seniorityFloor: seniorityEnum.optional(),
    seniorityExclusions: z.array(seniorityEnum),
    departmentAllowlist: z.array(departmentEnum),
    // Department -> seniority floor override (e.g. HR/Admin accept IC).
    // Partial record: only overridden departments need appear.
    departmentSeniorityOverrides: z.partialRecord(departmentEnum, seniorityEnum),
    titleKeywords: stringList,
    // Locale -> localized title list (e.g. de -> German titles for FlexEnergy).
    languageVariants: z.record(z.string().min(1), stringList),
    requirePersonaForFinalQualification: z.boolean(),
  })
  .strict();
export type PersonaRulesV2 = z.infer<typeof PersonaRulesV2Schema>;

// ---------------------------------------------------------------------------
// Size (numeric + qualitative bands + revenue + multi-location)
// ---------------------------------------------------------------------------

const SizeRulesV2Schema = z
  .object({
    minEmployees: z.number().int().min(0).optional(),
    maxEmployees: z.number().int().min(0).optional(),
    sizeBands: z.array(enumOf([...SIZE_BAND_KEYS] as [string, ...string[]])),
    minRevenueUsd: z.number().min(0).optional(),
    multiLocationOk: z.boolean().optional(),
    excludeTooSmall: z.boolean().optional(),
    unknownSizePolicy: enumOf([...UNKNOWN_DATA_POLICIES] as [string, ...string[]]),
  })
  .strict();
export type SizeRulesV2 = z.infer<typeof SizeRulesV2Schema>;

// ---------------------------------------------------------------------------
// Disqualifiers (generic email + one-person + website + competitor + project)
// ---------------------------------------------------------------------------

const ToggleSchema = z.object({ disqualify: z.boolean() }).strict();

const DisqualifiersV2Schema = z
  .object({
    genericEmailContact: ToggleSchema,
    onePersonCompany: z
      .object({ disqualify: z.boolean(), threshold: z.number().int().min(1).optional() })
      .strict(),
    websiteOffline: ToggleSchema,
    projectBased: ToggleSchema,
    // Competitor names and/or domains to terminally exclude.
    competitorDenylist: stringList,
  })
  .strict();
export type DisqualifiersV2 = z.infer<typeof DisqualifiersV2Schema>;

// ---------------------------------------------------------------------------
// Account-supplied lists + sub-ICPs
// ---------------------------------------------------------------------------

const AccountSuppliedV2Schema = z
  .object({
    mode: enumOf([...ACCOUNT_SUPPLIED_MODES] as [string, ...string[]]),
    // Names/domains supplied by the account (e.g. FlexEnergy preapproved list).
    companyList: stringList,
  })
  .strict();
export type AccountSuppliedV2 = z.infer<typeof AccountSuppliedV2Schema>;

// Sub-ICPs override persona/industry/size/geo; a lead is scored against the
// best-matching sub (Chainwire crypto vs cyber; 1C per-product personas).
const IcpSubProfileSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    keywords: stringList,
    persona: PersonaRulesV2Schema.partial().optional(),
    industry: IndustryRulesV2Schema.partial().optional(),
    size: SizeRulesV2Schema.partial().optional(),
    geography: GeographyRulesV2Schema.partial().optional(),
  })
  .strict();
export type IcpSubProfile = z.infer<typeof IcpSubProfileSchema>;

// ---------------------------------------------------------------------------
// Policies / weights / required evidence
// ---------------------------------------------------------------------------

const RequiredEvidenceV2Schema = z
  .object({
    explicitGeo: z.boolean(),
    employeeSize: z.boolean(),
    personaTitle: z.boolean(),
    websiteReachable: z.boolean(),
  })
  .strict();

const ScorePolicyV2Schema = z
  .object({
    minScore: z.number().int().min(0).max(100),
    maxScore: z.number().int().min(0).max(100),
    qualifiedMinFitScore: z.number().int().min(0).max(100),
    needsReviewMinFitScore: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.maxScore <= policy.minScore) {
      context.addIssue({ code: "custom", message: "maxScore must exceed minScore", path: ["maxScore"] });
    }
    if (policy.qualifiedMinFitScore <= policy.needsReviewMinFitScore) {
      context.addIssue({
        code: "custom",
        message: "qualifiedMinFitScore must exceed needsReviewMinFitScore",
        path: ["qualifiedMinFitScore"],
      });
    }
  });

const ConfidencePolicyV2Schema = z
  .object({
    highConfidenceThreshold: z.number().int().min(0).max(100),
    mediumConfidenceThreshold: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.highConfidenceThreshold <= policy.mediumConfidenceThreshold) {
      context.addIssue({
        code: "custom",
        message: "highConfidenceThreshold must exceed mediumConfidenceThreshold",
        path: ["highConfidenceThreshold"],
      });
    }
  });

const ScoringWeightsV2Schema = z
  .object({
    geo: z.number().int().min(0).max(100),
    industry: z.number().int().min(0).max(100),
    companyType: z.number().int().min(0).max(100),
    size: z.number().int().min(0).max(100),
    persona: z.number().int().min(0).max(100),
    signals: z.number().int().min(0).max(100),
  })
  .strict()
  .superRefine((weights, context) => {
    const total =
      weights.geo +
      weights.industry +
      weights.companyType +
      weights.size +
      weights.persona +
      weights.signals;

    if (total !== 100) {
      context.addIssue({ code: "custom", message: "scoring weights must sum to 100" });
    }
  });
export type ScoringWeightsV2 = z.infer<typeof ScoringWeightsV2Schema>;

const DictionaryVersionsSchema = z
  .object({
    regions: z.string().min(1),
    genericEmail: z.string().min(1),
    seniority: z.string().min(1),
    industry: z.string().min(1),
    sizeBands: z.string().min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Top-level rule object
// ---------------------------------------------------------------------------

export const IcpVersionRulesV2Schema = z
  .object({
    schemaVersion: z.literal("v2"),
    ruleSetId: z.string().min(1),
    displayName: z.string().min(1),
    geography: GeographyRulesV2Schema,
    industry: IndustryRulesV2Schema,
    companyType: CompanyTypeRulesV2Schema,
    persona: PersonaRulesV2Schema,
    size: SizeRulesV2Schema,
    disqualifiers: DisqualifiersV2Schema,
    accountSupplied: AccountSuppliedV2Schema,
    subIcps: z.array(IcpSubProfileSchema).optional(),
    requiredEvidenceForFinalQualification: RequiredEvidenceV2Schema,
    scoringWeights: ScoringWeightsV2Schema,
    scorePolicy: ScorePolicyV2Schema,
    confidencePolicy: ConfidencePolicyV2Schema,
    // Dictionary versions this ruleset was authored against (fingerprint input).
    dictionaryVersions: DictionaryVersionsSchema,
    blocksFinalQualificationFromCompanyOnlyEvidence: z.boolean(),
    negativeSignals: z.array(z.string()).optional(),
    goodFitExamples: z.array(z.string()).optional(),
    badFitExamples: z.array(z.string()).optional(),
  })
  .strict()
  .superRefine((rules, context) => {
    // Invariant 7: UNCERTAIN is never a canonical V2 qualification value.
    const serialized = JSON.stringify(rules).toLowerCase();
    if (serialized.includes('"uncertain"')) {
      context.addIssue({ code: "custom", message: "uncertain is not a canonical V2 qualification value" });
    }
  });

export type IcpVersionRulesV2 = z.infer<typeof IcpVersionRulesV2Schema>;

/** Parse + validate an unknown value as schema-v2 ICP rules (throws on failure). */
export function validateIcpVersionRulesV2(input: unknown): IcpVersionRulesV2 {
  return IcpVersionRulesV2Schema.parse(input);
}

/** Safe variant returning the zod result instead of throwing. */
export function safeValidateIcpVersionRulesV2(input: unknown) {
  return IcpVersionRulesV2Schema.safeParse(input);
}
