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
  /**
   * Whether a known headquarters outside the target countries may reject a candidate. False when any
   * geography could not be placed (a rejection against a PARTIAL country list would delete real prospects),
   * or when the builder said Worldwide/Global.
   */
  geoGate: boolean;
  /** Builder exclude keywords. Not engine rules: a substring there is terminal (see verifyScoring). */
  excludeKeywords: string[];
};

type RegionKey = (typeof REGION_KEYS)[number];

const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(
  Object.values(REGION_TO_COUNTRIES).flatMap((countries) => countries.map((country) => foldText(country))),
);

// What people type for a region that is not a dictionary key. Folded, so diacritics and case do not matter.
// A name may stand for several keys: "Asia" is East, South-East, South and Central Asia.
const REGION_ALIASES: Record<string, readonly RegionKey[]> = {
  "middle east": ["MENA"],
  "middle east and north africa": ["MENA"],
  "southeast asia": ["SEA"],
  "south east asia": ["SEA"],
  asean: ["SEA"],
  asia: ["APAC", "SOUTH_ASIA", "CENTRAL_ASIA"],
  "asia pacific": ["APAC"],
  "asia-pacific": ["APAC"],
  "european union": ["EU"],
  nordic: ["NORDICS"],
  dach: ["GERMAN_SPEAKING"],
  "latin america": ["LATAM"],
  "north america": ["NORTH_AMERICA"],
  "south america": ["SOUTH_AMERICA"],
  "north africa": ["NORTH_AFRICA"],
  africa: ["AFRICA"],
  gcc: ["GCC"],
  gulf: ["GCC"],
  "persian gulf": ["GCC"],
  cis: ["CIS"],
  "western europe": ["WESTERN_EUROPE"],
  "eastern europe": ["EASTERN_EUROPE"],
};

// No geography constraint at all.
const UNCONSTRAINED_GEOS: ReadonlySet<string> = new Set(["worldwide", "global", "anywhere", "international", "world"]);

// ISO 3166-1 alpha-2 codes for the countries the dictionaries know.
const ISO2: Record<string, string> = {
  nz: "New Zealand", de: "Germany", au: "Australia", sg: "Singapore", vn: "Vietnam", ae: "United Arab Emirates",
  sa: "Saudi Arabia", tr: "Turkey", eg: "Egypt", id: "Indonesia", in: "India", ma: "Morocco", my: "Malaysia",
  th: "Thailand", ph: "Philippines", jp: "Japan", kr: "South Korea", cn: "China", hk: "Hong Kong", tw: "Taiwan",
  gb: "United Kingdom", fr: "France", it: "Italy", es: "Spain", pt: "Portugal", nl: "Netherlands", be: "Belgium",
  at: "Austria", ch: "Switzerland", se: "Sweden", no: "Norway", dk: "Denmark", fi: "Finland", pl: "Poland",
  cz: "Czechia", ie: "Ireland", ca: "Canada", mx: "Mexico", br: "Brazil", ar: "Argentina", cl: "Chile",
  co: "Colombia", pe: "Peru", za: "South Africa", ng: "Nigeria", ke: "Kenya", qa: "Qatar", kw: "Kuwait",
  bh: "Bahrain", om: "Oman", jo: "Jordan", lb: "Lebanon", il: "Israel", pk: "Pakistan", bd: "Bangladesh",
  lk: "Sri Lanka", np: "Nepal", ru: "Russia", ua: "Ukraine", kz: "Kazakhstan", us: "United States",
  uk: "United Kingdom", dz: "Algeria", tn: "Tunisia", iq: "Iraq", ir: "Iran", ro: "Romania", hu: "Hungary",
  gr: "Greece", rs: "Serbia", bg: "Bulgaria", hr: "Croatia", sk: "Slovakia", si: "Slovenia",
};

/**
 * A raw country string as the canonical country name, or null when it cannot be placed.
 *
 * One function for both sides of the comparison (the builder's geos and a company's classified HQ), so
 * "KSA", "Kingdom of Saudi Arabia" and "Riyadh, Saudi Arabia" are one country. A "City, Country" value is
 * read by its last segment.
 */
export function resolveCountry(raw: string | null | undefined): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const segments = text.split(",").map((part) => part.trim()).filter(Boolean);
  for (const candidate of [text, segments[segments.length - 1]]) {
    if (!candidate) continue;
    // A two-letter code only as the whole value ("DE"). As the last part of "Boston, MA" or
    // "San Jose, CA" it is a US state, not Morocco or Canada.
    const iso = candidate === text && candidate.length === 2 ? ISO2[foldText(candidate)] : undefined;
    const country = iso ?? normalizeCountry(candidate);
    if (country && KNOWN_COUNTRIES.has(foldText(country))) return country;
  }
  return null;
}

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

// "ISP/Telecom", "Banking & Finance", "Telecom and Hosting", "ISP, Gaming" are several industries typed as one.
// F&B is the one industry whose own name contains an ampersand.
const FNB_TOKEN = "fnbtoken";
function splitIndustries(entry: string): string[] {
  return entry
    .replace(/\bf\s*&\s*b\b/gi, FNB_TOKEN)
    .split(/\s*(?:\/|,|;|&|\band\b)\s*/i)
    .map((part) => (part === FNB_TOKEN ? "F&B" : part));
}

function industryTargets(industries: readonly string[]): string[] {
  const terms = uniqueFolded(industries.flatMap(splitIndustries));
  // The engine matches a company's industry against these as text. A company filed under the canonical
  // key ("Financial services" -> FINANCE) carries that key as a token, not the ICP's wording, so the
  // key is added beside the term rather than relying on the two phrasings coinciding.
  const keys = terms.map((term) => canonicalizeIndustry(term)).filter((key): key is NonNullable<typeof key> => key !== null);
  return uniqueFolded([...terms, ...keys]);
}

type ResolvedGeos = { countries: string[]; regions: string[]; warnings: string[]; unconstrained: boolean };

function resolveGeos(geos: readonly string[]): ResolvedGeos {
  const countries: string[] = [];
  const regions: RegionKey[] = [];
  const warnings: string[] = [];
  let unconstrained = false;
  for (const geo of uniqueFolded(geos)) {
    const folded = foldText(geo);
    if (UNCONSTRAINED_GEOS.has(folded)) {
      unconstrained = true;
      continue;
    }
    const aliased = REGION_ALIASES[folded];
    const regionKey = REGION_KEYS.find((key) => foldText(key.replace(/_/g, " ")) === folded);
    if (aliased || regionKey) {
      regions.push(...(aliased ?? [regionKey as RegionKey]));
      continue;
    }
    const country = resolveCountry(geo);
    if (country) {
      countries.push(country);
      continue;
    }
    warnings.push(`Geography not recognised and not applied: "${geo}"`);
  }
  // 'Global' beside a country widens the search rather than narrowing it.
  if (unconstrained) return { countries: [], regions: [], warnings, unconstrained };
  return { countries: uniqueFolded(countries), regions: Array.from(new Set(regions)), warnings, unconstrained };
}

type SizeRange = { min?: number; max?: number; excludeTooSmall?: boolean; floor?: number };

// A number with thousands grouping ("1,001") or plain digits. A group is NOT thousands when a range follows it:
// in "51-200,201-500" the "200,201" is two numbers separated by a comma.
const NUM_START = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;
const NUM_END = String.raw`(?:\d{1,3}(?:,\d{3})+(?!\s*[-–]\s*\d)|\d+)`;
const RANGE_RE = new RegExp(String.raw`(${NUM_START})\s*(?:-|–|to)\s*(${NUM_END})`, "gi");
const PLUS_RE = new RegExp(String.raw`(${NUM_START})\s*\+`, "g");
const EXCLUDE_RANGE_RE = new RegExp(
  String.raw`\b(?:exclud\w*|not|without|except)\s+(?:the\s+)?(${NUM_START})\s*(?:-|–|to)\s*(${NUM_END})`,
  "gi",
);

function parseNumber(text: string): number {
  return Number(text.replace(/,/g, ""));
}

function resolveSize(companySize: string | undefined): SizeRange {
  if (!companySize) return {};
  let text = companySize;
  let floor: number | undefined;

  // "exclude 1-10" / "not 1-10": nothing at or below the top of that range.
  for (const match of text.matchAll(EXCLUDE_RANGE_RE)) floor = Math.max(floor ?? 0, parseNumber(match[2]) + 1);
  text = text.replace(EXCLUDE_RANGE_RE, " ");
  if (EXCLUDE_TINY_PATTERN.test(text)) {
    floor = Math.max(floor ?? 0, MIN_ABOVE_MICRO);
    text = text.replace(EXCLUDE_TINY_PATTERN, " ");
  }

  // "51-200, 201-500, 501-1000" or "2-500" or "1,001+": the span the listed ranges cover together.
  const lows: number[] = [];
  const highs: number[] = [];
  let openEnded = false;
  for (const match of text.matchAll(RANGE_RE)) {
    lows.push(parseNumber(match[1]));
    highs.push(parseNumber(match[2]));
  }
  for (const match of text.matchAll(PLUS_RE)) {
    lows.push(parseNumber(match[1]));
    openEnded = true;
  }
  if (lows.length > 0) {
    const min = Math.min(...lows);
    return {
      min: floor !== undefined ? Math.max(floor, min) : min,
      ...(openEnded ? {} : { max: Math.max(...highs) }),
      ...(floor !== undefined ? { excludeTooSmall: true, floor } : {}),
    };
  }
  if (floor !== undefined) return { min: floor, excludeTooSmall: true, floor };

  // Words ("SME", "Enterprise"): the bands the phrase names, each phrase read by the engine's own
  // qualitative mapping so a size means the same thing here as on a lead.
  const bands = text
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
 * The builder's fields as schema-v2 rules. Builder runs never set `pointRules` (that mode only exists on
 * saved ICPs), which is why `toAccountRules` handles it and this function never produces it.
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
      // Exclude keywords are NOT mapped here: the engine matches this list as a terminal substring ("bank"
      // would exclude "Bankruptcy software"). verifyScoring matches them on word boundaries instead.
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
      ...(size.floor !== undefined ? { onePersonCompany: { disqualify: true, threshold: size.floor } } : {}),
      competitorDenylist: uniqueFolded(params.excludeDomains.map(excludedDomainEntry)),
    },
  };

  return {
    rules: validateIcpVersionRulesV2(candidate),
    warnings: geos.warnings,
    // A known headquarters may reject a candidate only against an explicit list of countries. A region
    // ("Asia", "Africa", "Middle East") is a hand-kept approximation — "Asia" without Saudi Arabia or the
    // UAE, "Africa" without the DR Congo — and rejecting against an incomplete list deletes real
    // prospects (review, 2026-10-08). With a region in the run, geography is judged by the ICP fit judge,
    // which reads "Asia" the way a person would.
    geoGate: geos.countries.length > 0 && geos.regions.length === 0 && geos.warnings.length === 0 && !geos.unconstrained,
    excludeKeywords: uniqueFolded(params.excludeKeywords),
  };
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
  // Free text is a TAG, never the raw industry: the engine canonicalises raw industry by substring, which files
  // "LED display" under ISP ("isp") and "lead generation" under ADVERTISING ("ads"). Only a classified key,
  // through its alias, is handed over as the industry.
  const industry = safeAlias(classification.industryKey) ?? undefined;
  const evidenceText = [classification.industryText, classification.whatTheySell].filter(Boolean).join(" ");
  return {
    company: {
      companyName: candidate.name,
      ...(candidate.domain ? { domain: candidate.domain } : {}),
      ...(industry ? { industry } : {}),
      ...(classification.industryText ? { industryTags: [classification.industryText] } : {}),
      ...(classification.hqCountry ? { country: resolveCountry(classification.hqCountry) ?? classification.hqCountry } : {}),
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
