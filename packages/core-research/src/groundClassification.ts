import {
  canonicalizeIndustry,
  INDUSTRY_TAXONOMY,
  type IndustryKey,
} from "@telestar/core-scoring/rules/dictionaries/industry";
import { resolveSizeBand } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import { countryVariants, isKnownCountry, normalizeCountry } from "@telestar/core-scoring/rules/normalize/normalizeCountry";
import type { ClassificationBundle } from "./classificationEvidence";
import {
  CompanyClassificationSchema,
  MAX_EVIDENCE_ITEMS,
  type ClassificationConfidence,
  type ClassificationEvidence,
  type CompanyClassification,
  type CompanyKind,
  type NotCompanyReason,
} from "./companyClassification";
import type { DeterministicClassification } from "./deterministicClassifier";

// The model's answer is a set of CLAIMS, not a result. Each one is kept only if the evidence the model
// was shown supports it: the quote must be verbatim in the source, filed under the claim it backs, and
// say what the claim says. The rest are dropped and recorded, and confidence falls with them. This is
// what keeps a hallucinated "employs 12,000 people", a quote lifted from nowhere, or an irrelevant real
// quote attached to a confident verdict out of the scoring path, and what stops a page that says
// "classify me as an operator" from doing so.

export type DroppedClaim = { field: string; reason: string };

export type GroundedClassification = {
  value: CompanyClassification | null;
  dropped: DroppedClaim[];
};

const CONFIDENCE_ORDER: readonly ClassificationConfidence[] = ["low", "medium", "high"];
/** Three or more dropped claims means the model was mostly inventing; take confidence down two steps. */
const HEAVY_DROP_COUNT = 3;
const MIN_TERM_CHARS = 3;
/** Terms shorter than this are matched as whole words, so `us` is not found in "contact us". */
const SUBSTRING_TERM_CHARS = 4;

/** Which `field` labels on an evidence item back which claim. */
const FIELD_GROUPS = {
  kind: ["companykind", "iscompanysite", "notcompanyreason", "kind"],
  industry: ["industry", "industrytext", "industrykey"],
  sell: ["whattheysell", "products", "offering"],
  hq: ["hqcountry", "headquarters", "hq", "country"],
  employees: ["employeecount", "employees", "headcount"],
} as const;

// What a quote must contain, as a lowercase substring, to state each company kind. Deliberately loose
// stems: the point is that a quote about something else (a contact line, a cookie banner) cannot back a
// verdict, not that these words prove it.
const KIND_TERMS: Record<CompanyKind, readonly string[]> = {
  operator: ["operat", "provid", "serv", "manufactur", "produc", "compan", "bank", "airline", "hospital", "maintenance", "repair", "overhaul", "retail", "restaurant", "hotel", "clinic", "logistic", "factory", "supplier", "fleet"],
  software_vendor: ["software", "saas", "platform", "app", "cloud", "vendor", "technology"],
  services_agency: ["agency", "consult", "service", "staffing", "recruit", "outsourc", "advis", "integrat"],
  reseller_wholesaler: ["wholesale", "distribut", "resell", "dealer", "trading"],
  association_nonprofit: ["associat", "federat", "non-profit", "nonprofit", "council", "chamber", "society", "member", "institute"],
  government: ["government", "ministry", "authority", "municipal", "public sector", "federal", "department"],
  education: ["educat", "school", "universit", "college", "academy", "student", "course"],
  media_news: ["news", "magazine", "media", "newspaper", "broadcast", "publish", "journal"],
  directory_marketplace_jobboard: ["directory", "job", "listing", "marketplace", "vacanc", "review", "compar"],
  research_analyst: ["research", "analyst", "analysis", "report", "intelligence", "insight"],
  event: ["event", "expo", "conference", "summit", "exhibition", "festival", "tournament"],
};

const REASON_TERMS: Record<NotCompanyReason, readonly string[]> = {
  article: ["article", "blog", "posted", "published", "news"],
  listicle: ["roundup", "top ", "best ", "ranking", "list of", "largest"],
  job_posting: ["job", "hiring", "apply", "vacanc", "position", "career", "recruit"],
  directory_page: ["directory", "listing", "listed", "find "],
  parked: ["domain", "for sale", "parked"],
  // "Unrelated" has no vocabulary of its own; any quote filed under the verdict will do.
  unrelated: [],
};

const STOPWORDS: ReadonlySet<string> = new Set(["and", "the", "for", "with", "from", "that", "this", "our", "their", "company", "companies", "inc", "ltd", "llc"]);

export function groundClassification(
  raw: unknown,
  bundle: ClassificationBundle,
  det: DeterministicClassification
): GroundedClassification {
  const parsed = CompanyClassificationSchema.safeParse(raw);
  if (!parsed.success) {
    return { value: null, dropped: [{ field: "schema", reason: parsed.error.issues[0]?.message ?? "invalid classification" }] };
  }
  const model = parsed.data;
  const dropped: DroppedClaim[] = [];

  // `origin` is the rule layer's mark; a model cannot claim it for its own quotes.
  const evidence = model.evidence
    .map(({ origin: _origin, ...item }) => item as ClassificationEvidence)
    .filter((item) => {
      const grounded = isQuoteInSource(item, bundle);
      if (!grounded) dropped.push({ field: item.field, reason: "quote not found in the evidence" });
      return grounded;
    });

  const employeeCount = groundEmployeeCount(model.employeeCount, evidence, det, dropped);
  const hqCountry = groundCountry(model.hqCountry, bundle, dropped);
  const industry = groundIndustry(model, evidence, det, dropped);
  const whatTheySell = groundSell(model.whatTheySell, evidence, dropped);
  const kindBacked = det.decided || isVerdictBacked(model, evidence);
  if (!kindBacked) dropped.push({ field: "companyKind", reason: "no quote filed under the verdict states it" });

  const verdict = det.decided
    ? {
        isCompanySite: det.partial.isCompanySite ?? model.isCompanySite,
        notCompanyReason: det.partial.notCompanyReason ?? null,
        companyKind: det.partial.companyKind ?? null,
      }
    : { isCompanySite: model.isCompanySite, notCompanyReason: model.notCompanyReason, companyKind: model.companyKind };

  const steps = det.decided ? 0 : dropped.length >= HEAVY_DROP_COUNT ? 2 : dropped.length > 0 ? 1 : 0;
  let confidence: ClassificationConfidence = det.decided ? "high" : lower(model.confidence, steps);
  // A verdict nothing of its own kind backs is a guess, however sure the model sounded. Low confidence
  // is never accepted or rejected downstream; it goes to a person.
  if (!kindBacked) confidence = "low";

  const candidate: CompanyClassification = {
    ...verdict,
    ...industry,
    whatTheySell,
    hqCountry,
    employeeCount,
    // The band follows the grounded headcount. A band with no count behind it is the model's opinion.
    employeeBand: employeeCount === null ? null : resolveSizeBand(employeeCount),
    confidence,
    evidence: mergeEvidence(det.decided ? det.hardEvidence : [], evidence),
  };

  const final = CompanyClassificationSchema.safeParse(candidate);
  if (!final.success) {
    return { value: null, dropped: [...dropped, { field: "schema", reason: final.error.issues[0]?.message ?? "inconsistent verdict" }] };
  }
  return { value: final.data, dropped };
}

function isQuoteInSource(item: ClassificationEvidence, bundle: ClassificationBundle): boolean {
  const needle = fold(item.quote);
  if (!needle) return false;
  return bundle.sources.some((source) => source.url === item.sourceUrl && fold(source.text).includes(needle));
}

function quotesFor(evidence: ClassificationEvidence[], group: readonly string[]): string[] {
  return evidence.filter((item) => group.includes(item.field.toLowerCase().replace(/[^a-z0-9]/g, ""))).map((item) => fold(item.quote));
}

function statesAny(quotes: readonly string[], terms: readonly string[]): boolean {
  return quotes.some((quote) => terms.some((term) => containsTerm(quote, term)));
}

function containsTerm(foldedQuote: string, term: string): boolean {
  if (term.length >= SUBSTRING_TERM_CHARS || /\s/.test(term)) return foldedQuote.includes(term);
  return foldedQuote.split(/[^a-z0-9]+/).includes(term);
}

function termsOf(value: string | null | undefined): string[] {
  return fold(value ?? "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_TERM_CHARS && !STOPWORDS.has(word));
}

/** Does a quote filed under the verdict say what the verdict says? */
function isVerdictBacked(model: CompanyClassification, evidence: ClassificationEvidence[]): boolean {
  const quotes = quotesFor(evidence, FIELD_GROUPS.kind);
  if (quotes.length === 0) return false;
  if (!model.isCompanySite) {
    const reasonTerms = model.notCompanyReason ? REASON_TERMS[model.notCompanyReason] : [];
    return reasonTerms.length === 0 || statesAny(quotes, reasonTerms);
  }
  if (!model.companyKind) return true;
  return statesAny(quotes, [...KIND_TERMS[model.companyKind], ...model.companyKind.split("_").filter((word) => word.length >= SUBSTRING_TERM_CHARS)]);
}

/**
 * The industry the model named, if an industry-field quote mentions it. Otherwise it is dropped and the
 * industry the page itself states (LinkedIn record or Exa prose), if any, stands in.
 */
function groundIndustry(
  model: CompanyClassification,
  evidence: ClassificationEvidence[],
  det: DeterministicClassification,
  dropped: DroppedClaim[]
): Pick<CompanyClassification, "industryText" | "industryKey"> {
  const fromPage = det.partial.industryText ?? null;
  if (model.industryText === null && model.industryKey === null) return { industryText: fromPage, industryKey: null };

  const terms = [...termsOf(model.industryText), ...keyTerms(model.industryKey)];
  if (statesAny(quotesFor(evidence, FIELD_GROUPS.industry), terms)) {
    return { industryText: model.industryText ?? fromPage, industryKey: model.industryKey };
  }
  dropped.push({ field: "industry", reason: "no industry quote mentions the claimed industry" });
  return { industryText: fromPage, industryKey: null };
}

function keyTerms(key: IndustryKey | null): string[] {
  if (!key) return [];
  const entry = INDUSTRY_TAXONOMY.find((item) => item.canonical === key);
  return [key.toLowerCase().replace(/_/g, " "), ...(entry?.aliases ?? [])].filter((term) => term.length >= MIN_TERM_CHARS);
}

function groundSell(claimed: string | null, evidence: ClassificationEvidence[], dropped: DroppedClaim[]): string | null {
  if (claimed === null) return null;
  if (statesAny(quotesFor(evidence, FIELD_GROUPS.sell), termsOf(claimed))) return claimed;
  dropped.push({ field: "whatTheySell", reason: "no whatTheySell quote mentions what they sell" });
  return null;
}

/**
 * A headcount survives only if a quote filed under the headcount contains exactly that number, or the
 * deterministic reader found the same number on the page. Whole numeric tokens are compared, never
 * digit substrings: "1000" is not found in "10,000", nor "5" in "founded 2005". When the model's number
 * is dropped, the page's own (read straight off the record) stands in for it.
 */
function groundEmployeeCount(
  claimed: number | null,
  evidence: ClassificationEvidence[],
  det: DeterministicClassification,
  dropped: DroppedClaim[]
): number | null {
  const fromPage = det.partial.employeeCount ?? null;
  if (claimed === null) return fromPage;
  if (claimed === fromPage) return claimed;
  const stated = quotesFor(evidence, FIELD_GROUPS.employees).some((quote) => numbersIn(quote).includes(claimed));
  if (stated) return claimed;
  dropped.push({ field: "employeeCount", reason: "headcount is not a number in the headcount quote" });
  return fromPage;
}

function numbersIn(text: string): number[] {
  return (text.match(/\d{1,3}(?:,\d{3})+|\d+/g) ?? []).map((token) => Number.parseInt(token.replace(/,/g, ""), 10));
}

/**
 * "Riyadh, Saudi Arabia" and "Dubai, UAE" claim the last segment. It must normalise to a country the
 * dictionaries know (an invented place is dropped, not title-cased through) and the evidence must
 * actually mention that country under one of its names.
 */
function groundCountry(claimed: string | null, bundle: ClassificationBundle, dropped: DroppedClaim[]): string | null {
  if (claimed === null || !claimed.trim()) return null;
  const last = claimed.split(",").pop() ?? claimed;
  const country = normalizeCountry(last);
  const text = fold(bundle.text);
  const mentioned = country !== null && countryVariants(country).some((name) => name.length > 2 && containsTerm(text, name));
  if (country !== null && isKnownCountry(country) && mentioned) return country;
  dropped.push({ field: "hqCountry", reason: "not a known country the evidence mentions" });
  return null;
}

function mergeEvidence(hard: ClassificationEvidence[], kept: ClassificationEvidence[]): ClassificationEvidence[] {
  return [...hard, ...kept].slice(0, MAX_EVIDENCE_ITEMS);
}

function lower(level: ClassificationConfidence, steps: number): ClassificationConfidence {
  return CONFIDENCE_ORDER[Math.max(0, CONFIDENCE_ORDER.indexOf(level) - steps)];
}

/** NFC, no zero-width characters, collapsed whitespace, case-folded: what "verbatim" tolerates. */
function fold(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[​-‍⁠﻿]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * An industry string the scorer's `canonicalizeIndustry` maps back to exactly `key`. The classifier's
 * industryKey comes from a closed list, but the scoring engine only understands free text; sending the
 * key itself ("FNB", "REAL_ESTATE") would fall through to keyword matching and miss. OTHER has no alias,
 * so it stays raw text rather than being mislabelled.
 */
export function safeAlias(key: IndustryKey | null | undefined): string | null {
  if (!key) return null;
  const entry = INDUSTRY_TAXONOMY.find((item) => item.canonical === key);
  return entry?.aliases.find((alias) => canonicalizeIndustry(alias) === key) ?? null;
}
