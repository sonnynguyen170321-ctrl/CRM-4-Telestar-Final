import { registrableDomain } from "@telestar/core-identity/registrableDomain";
import { canonicalizeIndustry } from "@telestar/core-scoring/rules/dictionaries/industry";
import { REGION_KEYS, REGION_TO_COUNTRIES } from "@telestar/core-scoring/rules/dictionaries/regions";
import { SENIORITY_RANK, type SeniorityTier } from "@telestar/core-scoring/rules/dictionaries/seniority";
import { SIZE_BAND_MAP } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import { emptyIcpRulesV2 } from "@telestar/core-scoring/rules/emptyIcpRulesV2";
import { foldText, normalizeCountry, normalizeSize } from "@telestar/core-scoring/rules/normalize/index";
import type { RawScoringEvidence } from "@telestar/core-scoring/rules/evidence";
import { validateIcpVersionRulesV2, type CompanyTypeV2, type IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import type { ResearchBuilderParams } from "./buildDiscoveryQueries";
import { safeAlias, type CompanyClassificationInput, type CompanyKind } from "./verificationTypes";

// A research run's builder fields, expressed as the SAME schema-v2 rules the lead and pool scoring
// read (owner report, 2026-10-08). Research used its own keyword score, so a candidate and a lead
// with identical facts got different verdicts. One rule set means one verdict.
//
// Pure: no I/O, no provider calls, no database.

export type BuilderRules = {
  rules: IcpVersionRulesV2;
  /** Builder entries that could not be placed (an unrecognised geography); shown, never dropped silently. */
  warnings: string[];
};

const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(
  Object.values(REGION_TO_COUNTRIES).flatMap((countries) => countries.map((country) => foldText(country))),
);

// What people type for a region that is not a dictionary key. Folded, so diacritics and case do not matter.
const REGION_ALIASES: Record<string, (typeof REGION_KEYS)[number]> = {
  "middle east": "MENA",
  "middle east and north africa": "MENA",
  "southeast asia": "SEA",
  "south east asia": "SEA",
  asean: "SEA",
  "asia pacific": "APAC",
  "asia-pacific": "APAC",
  "european union": "EU",
  nordic: "NORDICS",
  dach: "GERMAN_SPEAKING",
  "latin america": "LATAM",
  "north america": "NORTH_AMERICA",
  "south america": "SOUTH_AMERICA",
  "north africa": "NORTH_AFRICA",
};

// Country spellings the engine's alias table does not know. "Türkiye" is the official name and what
// Stormwall's Turkish prospects write; without this it reads as an unknown country.
const COUNTRY_ALIASES: Record<string, string> = {
  turkiye: "Turkey",
  ksa: "Saudi Arabia",
  "kingdom of saudi arabia": "Saudi Arabia",
};

const SENIORITY_ALIASES: Record<string, SeniorityTier> = {
  "c-level": "C_LEVEL",
  "c-suite": "C_LEVEL",
  founder: "OWNER",
  owner: "OWNER",
  vp: "VP",
  director: "DIRECTOR",
  head: "HEAD",
  lead: "LEAD",
  manager: "MANAGER",
};

// "Very small" is Stormwall's own wording for the micro band (1-10 staff).
const EXCLUDE_TINY_PATTERN = /\bexclud\w*\s+(?:the\s+)?(?:very\s+|too\s+)?(?:small|tiny|micro)\b/i;
const MIN_ABOVE_MICRO = SIZE_BAND_MAP.SMALL.minEmployees;

const uniqueFolded = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = foldText(trimmed);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
};

function industryTargets(industries: readonly string[]): string[] {
  // "ISP/Telecom" is two industries typed as one. Splitting is what lets each side match.
  const terms = uniqueFolded(industries.flatMap((entry) => entry.split("/")));
  // The engine matches a company's industry against these as text. A company filed under the canonical
  // key ("Financial services" -> FINANCE) carries that key as a token, not the ICP's wording, so the
  // key is added beside the term rather than relying on the two phrasings coinciding.
  const keys = terms.map((term) => canonicalizeIndustry(term)).filter((key): key is NonNullable<typeof key> => key !== null);
  return uniqueFolded([...terms, ...keys]);
}

function resolveGeos(geos: readonly string[]): { countries: string[]; regions: string[]; warnings: string[] } {
  const countries: string[] = [];
  const regions: string[] = [];
  const warnings: string[] = [];
  for (const geo of uniqueFolded(geos)) {
    const folded = foldText(geo);
    const regionKey = REGION_ALIASES[folded] ?? REGION_KEYS.find((key) => foldText(key.replace(/_/g, " ")) === folded);
    if (regionKey) {
      regions.push(regionKey);
      continue;
    }
    const country = COUNTRY_ALIASES[folded] ?? normalizeCountry(geo);
    if (country && KNOWN_COUNTRIES.has(foldText(country))) {
      countries.push(country);
      continue;
    }
    warnings.push(`Geography not recognised and not applied: "${geo}"`);
  }
  return { countries: uniqueFolded(countries), regions: Array.from(new Set(regions)), warnings };
}

type SizeRange = { min?: number; max?: number; excludeTooSmall?: boolean };

function parseNumber(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function resolveSize(companySize: string | undefined): SizeRange {
  if (!companySize) return {};
  if (EXCLUDE_TINY_PATTERN.test(companySize)) return { min: MIN_ABOVE_MICRO, excludeTooSmall: true };

  // "51-200, 201-500, 501-1000" or "2-500" or "1,001+": the span the listed ranges cover together.
  const lows: number[] = [];
  const highs: number[] = [];
  let openEnded = false;
  for (const match of companySize.matchAll(/(\d[\d,]*)\s*(?:-|–|to)\s*(\d[\d,]*)/gi)) {
    lows.push(parseNumber(match[1]));
    highs.push(parseNumber(match[2]));
  }
  for (const match of companySize.matchAll(/(\d[\d,]*)\s*\+/g)) {
    lows.push(parseNumber(match[1]));
    openEnded = true;
  }
  if (lows.length > 0) {
    return { min: Math.min(...lows), ...(openEnded ? {} : { max: Math.max(...highs) }) };
  }

  // Words ("SME", "Enterprise"): the bands the phrase names, each phrase read by the engine's own
  // qualitative mapping so a size means the same thing here as on a lead.
  const bands = companySize
    .split(/[,;/]+/)
    .map((phrase) => normalizeSize(null, phrase).sizeBand)
    .filter((band): band is NonNullable<typeof band> => band !== null);
  if (bands.length === 0) return {};
  const ranges = bands.map((band) => SIZE_BAND_MAP[band]);
  const open = ranges.some((range) => range.maxEmployees === undefined);
  return {
    min: Math.min(...ranges.map((range) => range.minEmployees)),
    ...(open ? {} : { max: Math.max(...ranges.map((range) => range.maxEmployees ?? 0)) }),
  };
}

function excludedDomainEntry(entry: string): string {
  return registrableDomain(entry) ?? foldText(entry);
}

function seniorityFloor(seniority: readonly string[]): SeniorityTier | undefined {
  const tiers = seniority.map((value) => SENIORITY_ALIASES[foldText(value)]).filter((tier): tier is SeniorityTier => Boolean(tier));
  if (tiers.length === 0) return undefined;
  // The most junior level asked for is the floor: "director, c-level" accepts a director.
  return tiers.reduce((lowest, tier) => (SENIORITY_RANK[tier] < SENIORITY_RANK[lowest] ? tier : lowest));
}

/**
 * The builder's fields as schema-v2 rules.
 *
 * Keywords are deliberately NOT mapped: `industryKeywords` moves the industry and signals scores, so a
 * keyword would change a candidate's band. The owner's rule is that keywords rank and never gate; they
 * are matched for ranking in `verifyScoring`, outside the rules. Titles and seniority are kept on the
 * persona here (the rules stay a faithful picture of the ICP) and `toAccountRules` removes them for
 * scoring a company.
 */
export function builderParamsToRulesV2(params: ResearchBuilderParams, runId: string): BuilderRules {
  const base = emptyIcpRulesV2(`research:${runId}`, `Research run ${runId}`);
  const targetIndustries = industryTargets(params.industries);
  const geos = resolveGeos(params.geos);
  const size = resolveSize(params.companySize);
  const floor = seniorityFloor(params.seniority);
  const titles = uniqueFolded(params.titles);

  const candidate: IcpVersionRulesV2 = {
    ...base,
    geography: { ...base.geography, targetCountries: geos.countries, targetRegions: geos.regions },
    industry: {
      ...base.industry,
      mode: targetIndustries.length > 0 ? "allowlist" : "all",
      targetIndustries,
      excludedIndustries: uniqueFolded(params.excludeKeywords),
    },
    persona: { ...base.persona, titleAllowlist: titles, ...(floor ? { seniorityFloor: floor } : {}) },
    size: {
      ...base.size,
      ...(size.min !== undefined ? { minEmployees: size.min } : {}),
      ...(size.max !== undefined ? { maxEmployees: size.max } : {}),
      ...(size.excludeTooSmall ? { excludeTooSmall: true } : {}),
    },
    disqualifiers: {
      ...base.disqualifiers,
      // "Exclude very small" is an exclusion, not a preference: a weighted size score alone lets a
      // three-person shop through on geography and industry. The engine's headcount gate is fatal
      // only when the headcount is known, so an unknown size still goes to review.
      ...(size.excludeTooSmall && size.min !== undefined ? { onePersonCompany: { disqualify: true, threshold: size.min } } : {}),
      competitorDenylist: uniqueFolded(params.excludeDomains.map(excludedDomainEntry)),
    },
  };

  return { rules: validateIcpVersionRulesV2(candidate), warnings: geos.warnings };
}

/**
 * The rules for judging a COMPANY, with the buyer left out.
 *
 * "Verified fit" means the account fits; the buyer persona is found later. With persona rules in place
 * the engine treats a lead with no contact as missing core evidence and caps it at review, so no
 * company could ever read as qualified. This removes every persona rule and requirement instead of
 * letting the missing contact decide.
 *
 * Points mode: title rows are dropped, and the largest positive title row is taken off both
 * thresholds, because a company can never earn it. `fitAt` stays above `reviewAt`, and neither falls
 * to zero: a threshold of zero would put a company with no matching fact into review.
 */
export function toAccountRules(rules: IcpVersionRulesV2): IcpVersionRulesV2 {
  const { seniorityFloor: _floor, ...persona } = rules.persona;
  const account: IcpVersionRulesV2 = {
    ...rules,
    persona: {
      ...persona,
      titleAllowlist: [],
      titleDenylist: [],
      titleTiers: [],
      seniorityExclusions: [],
      departmentAllowlist: [],
      departmentSeniorityOverrides: {},
      titleKeywords: [],
      languageVariants: {},
      requirePersonaForFinalQualification: false,
    },
    requiredEvidenceForFinalQualification: { ...rules.requiredEvidenceForFinalQualification, personaTitle: false },
    blocksFinalQualificationFromCompanyOnlyEvidence: false,
    ...(rules.subIcps
      ? { subIcps: rules.subIcps.map(({ persona: _persona, ...sub }) => sub) }
      : {}),
  };

  const pointRules = rules.pointRules;
  if (!pointRules) return account;

  const titleRows = pointRules.rules.filter((row) => row.group === "title");
  const shift = Math.max(0, ...titleRows.map((row) => row.points));
  if (titleRows.length === 0) return account;

  const remaining = pointRules.rules.filter((row) => row.group !== "title");
  // Only negative title rows (an exclusion list): nothing was unreachable, so the thresholds stand.
  if (shift === 0) return { ...account, pointRules: { ...pointRules, rules: remaining } };

  const fitAt = Math.max(2, pointRules.fitAt - shift);
  const reviewAt = Math.min(fitAt - 1, Math.max(1, pointRules.reviewAt - shift));
  return { ...account, pointRules: { ...pointRules, rules: remaining, fitAt, reviewAt } };
}

export type CandidateFacts = { name: string; domain: string | null };
export type SiteFacts = { reachable?: boolean };

const COMPANY_TYPE_OF_KIND: Partial<Record<CompanyKind, CompanyTypeV2>> = {
  software_vendor: "PRODUCT_SAAS",
  services_agency: "SERVICE_ONLY",
  directory_marketplace_jobboard: "MARKETPLACE",
};

/**
 * A classified candidate as the engine's evidence — the facts, and only the facts.
 *
 *   - Industry goes in as `safeAlias(industryKey)`, the phrase the engine's matcher maps back to the
 *     key; the classifier's own wording rides along as a tag. A key with no alias (OTHER) falls back to
 *     the free text.
 *   - `evidenceText` is the industry text and what they sell and nothing else: keyword scans (services
 *     words, industry keywords) must read what the company does, not its name or a search snippet.
 *   - An unfetched or unreachable site is "unknown", never "offline": a failed fetch is not evidence
 *     the company has no website, and the offline gate is fatal.
 *   - No contact: a candidate is a company. Persona is found later.
 */
export function classificationToEvidence(
  classification: CompanyClassificationInput,
  candidate: CandidateFacts,
  site?: SiteFacts,
): RawScoringEvidence {
  const industry = safeAlias(classification.industryKey) ?? classification.industryText ?? undefined;
  const evidenceText = [classification.industryText, classification.whatTheySell].filter(Boolean).join(" ");
  return {
    company: {
      companyName: candidate.name,
      ...(candidate.domain ? { domain: candidate.domain } : {}),
      ...(industry ? { industry } : {}),
      ...(classification.industryText ? { industryTags: [classification.industryText] } : {}),
      ...(classification.hqCountry ? { country: classification.hqCountry } : {}),
      ...(classification.employeeCount != null ? { employeeCount: classification.employeeCount } : {}),
      ...(classification.employeeCount == null && classification.employeeBand
        ? { employeeRange: classification.employeeBand.toLowerCase().replace(/_/g, " ") }
        : {}),
      companyType: (classification.companyKind && COMPANY_TYPE_OF_KIND[classification.companyKind]) || "UNKNOWN",
      websiteStatus: site?.reachable === true ? "reachable" : "unknown",
      ...(classification.whatTheySell ? { description: classification.whatTheySell } : {}),
      ...(evidenceText ? { evidenceText } : {}),
    },
  };
}
