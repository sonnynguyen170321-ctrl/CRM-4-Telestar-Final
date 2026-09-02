import type { CompanyType, Qualification } from "@/lib/types";

export const hardRuleFlagKeys = [
  "solo_company",
  "excluded_country",
  "services_signal",
  "b2c_only_signal",
  "website_offline_signal",
  "personal_email_signal",
] as const;

export type HardRuleFlagKey = (typeof hardRuleFlagKeys)[number];

export type HardRuleFlags = Record<HardRuleFlagKey, boolean>;

export type HardRuleInput = {
  company_name?: string | null;
  website?: string | null;
  company_country?: string | null;
  company_industry?: string | null;
  company_staff_count_range?: string | null;
  note?: string | null;
  raw_text?: string | null;
  raw_row_json?: Record<string, unknown> | null;
};

export type HardRuleEvaluation = {
  flags: HardRuleFlags;
  triggered_flags: HardRuleFlagKey[];
  is_disqualified: boolean;
  suggested_qualification: Extract<Qualification, "unqualified" | "uncertain"> | null;
  suggested_type: Extract<CompanyType, "Not Relevant"> | null;
  reason: string[];
};

const excludedCountries = ["india", "pakistan", "bangladesh", "philippines"];

const soloTextPatterns = [
  /\b1\s+employee\b/,
  /\bsolo\b/,
  /\bsolo\s+founder\b/,
  /\bself[-\s]employed\b/,
  /\bfreelancer\b/,
];

const servicesPatterns = [
  /\bservices\b/,
  /\bconsulting\b/,
  /\bagency\b/,
  /\boutsourcing\b/,
  /\boutsourced\b/,
  /\bsoftware\s+development\s+services\b/,
  /\bdesign\s+agency\b/,
  /\bdev\s+shop\b/,
  /\bit\s+services\b/,
];

const b2cPatterns = [
  /\bb2c\b/,
  /\bconsumer\s+app\b/,
  /\be[-\s]?commerce\s+store\b/,
  /\bmarketplace\b/,
  /\bno\s+b2b\b/,
  /\bno\s+pricing\b/,
  /\bretail\s+only\b/,
];

const websiteOfflinePatterns = [
  /\bsite\s+not\s+found\b/,
  /\bwebsite\s+offline\b/,
  /\bnot\s+reachable\b/,
  /\bunreachable\b/,
  /\bdead\s+website\b/,
  /\bbroken\s+site\b/,
  /\bwebsite\s+broken\b/,
];

const personalEmailPatterns = [
  /(^|[^\w.-])gmail\.com\b/,
  /(^|[^\w.-])yahoo\.com\b/,
  /(^|[^\w.-])outlook\.com\b/,
  /(^|[^\w.-])hotmail\.com\b/,
];

const strongDisqualifiers: HardRuleFlagKey[] = [
  "solo_company",
  "excluded_country",
  "services_signal",
  "website_offline_signal",
  "personal_email_signal",
];

export function evaluateHardRules(input: HardRuleInput): HardRuleEvaluation {
  const normalized = normalizeInput(input);

  const flags: HardRuleFlags = {
    solo_company: hasSoloCompanySignal(normalized.staffCount, normalized.allText),
    excluded_country: hasExcludedCountrySignal(normalized.country),
    services_signal: matchesAny(normalized.classificationText, servicesPatterns),
    b2c_only_signal: matchesAny(normalized.classificationText, b2cPatterns),
    website_offline_signal: hasWebsiteOfflineSignal(
      normalized.website,
      normalized.allText
    ),
    personal_email_signal: matchesAny(normalized.allText, personalEmailPatterns),
  };

  const triggered_flags = hardRuleFlagKeys.filter((flag) => flags[flag]);
  const hasStrongDisqualifier = strongDisqualifiers.some((flag) => flags[flag]);
  const is_disqualified = hasStrongDisqualifier;

  return {
    flags,
    triggered_flags,
    is_disqualified,
    suggested_qualification: is_disqualified
      ? "unqualified"
      : flags.b2c_only_signal
        ? "uncertain"
        : null,
    suggested_type: is_disqualified ? "Not Relevant" : null,
    reason: buildReasons(flags),
  };
}

function normalizeInput(input: HardRuleInput) {
  const rawJsonText = input.raw_row_json
    ? JSON.stringify(input.raw_row_json)
    : "";

  const textParts = [
    input.company_name,
    input.website,
    input.company_country,
    input.company_industry,
    input.company_staff_count_range,
    input.note,
    input.raw_text,
    rawJsonText,
  ];

  return {
    website: normalizeText(input.website),
    country: normalizeText(input.company_country),
    staffCount: normalizeText(input.company_staff_count_range),
    classificationText: normalizeText(
      [input.company_industry, input.note, input.raw_text, rawJsonText].join(" ")
    ),
    allText: normalizeText(textParts.join(" ")),
  };
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/\s+/g, " ");
}

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function hasExcludedCountrySignal(country: string) {
  return excludedCountries.some((excludedCountry) =>
    country.includes(excludedCountry)
  );
}

function hasSoloCompanySignal(staffCount: string, allText: string) {
  if (staffCount === "1") {
    return true;
  }

  if (/^1\s*(employee|person|staff)?$/.test(staffCount)) {
    return true;
  }

  return matchesAny(allText, soloTextPatterns);
}

function hasWebsiteOfflineSignal(website: string, allText: string) {
  if (website.length === 0) {
    return true;
  }

  return matchesAny(allText, websiteOfflinePatterns);
}

function buildReasons(flags: HardRuleFlags) {
  const reasons: string[] = [];

  if (flags.solo_company) {
    reasons.push("Company appears to be a one-person or solo operation.");
  }

  if (flags.excluded_country) {
    reasons.push("Company country matches an excluded location.");
  }

  if (flags.services_signal) {
    reasons.push("Company appears service-led, consulting-led, or agency-led.");
  }

  if (flags.b2c_only_signal) {
    reasons.push("Company has B2C-only or weak B2B fit signals.");
  }

  if (flags.website_offline_signal) {
    reasons.push("Website is missing or has offline/unreachable text signals.");
  }

  if (flags.personal_email_signal) {
    reasons.push("Row includes a personal email domain signal.");
  }

  return reasons;
}

export const sampleHardRuleInputs: HardRuleInput[] = [
  {
    company_name: "Solo Dev Shop",
    website: "https://solodevshop.example",
    company_country: "India",
    company_industry: "Software development services",
    company_staff_count_range: "1 employee",
    note: "Freelancer using gmail.com.",
  },
  {
    company_name: "Retail App Co",
    website: "https://retailapp.example",
    company_country: "Canada",
    company_industry: "Consumer app",
    company_staff_count_range: "11-50",
    note: "B2C marketplace with no B2B signal.",
  },
];
