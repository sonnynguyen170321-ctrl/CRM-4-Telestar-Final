import { extractPageModel, identityText, IDENTITY_PAGE_TYPES, type RawPageInput } from "@telestar/core-intel/reasoning/pageModel";
import { isLowQualityPage } from "@telestar/core-intel/reasoning/pageQuality";
import { parseEvidenceFacts, type EvidenceFacts } from "./evidenceFacts";

// The parser moved here from lib/research so the classifier and the evidence drawer read a LinkedIn-
// style highlight with the same code.
export { parseEvidenceFacts } from "./evidenceFacts";
export type { EvidenceFacts } from "./evidenceFacts";

// What the classifier is shown for one candidate, and nothing else. Everything a claim may be grounded
// on is in `sources`; groundClassification refuses any quote that is not literally in it.

/** The provider highlight is the best single source, but it is unbounded on the way in. */
export const MAX_HIGHLIGHT_CHARS = 1500;
/** Identity pages (home/about/product/service) share one budget so a 12-page site cannot flood the prompt. */
export const MAX_IDENTITY_CHARS = 2500;
/** Below this, with no structured record and no deterministic verdict, the model would be guessing. */
export const MIN_EVIDENCE_CHARS = 150;

export type ClassificationCandidate = {
  name: string;
  domain: string | null;
  sourceUrl?: string | null;
  highlight?: string | null;
};

export type ClassificationSource = {
  url: string;
  kind: "highlight" | "page";
  text: string;
};

export type ExaCompanyProse = {
  industry: string | null;
  employeeCount: number | null;
  headquarters: string | null;
};

export type ClassificationBundle = {
  name: string;
  domain: string | null;
  sourceUrl: string | null;
  sources: ClassificationSource[];
  /** Every source's text, joined; the haystack quotes are checked against. */
  text: string;
  facts: EvidenceFacts;
  prose: ExaCompanyProse;
};

const SOURCE_SEPARATOR = "\n\n";

export function buildClassificationBundle(
  candidate: ClassificationCandidate,
  pages: readonly RawPageInput[] = []
): ClassificationBundle {
  const sources: ClassificationSource[] = [];
  const highlight = squash(candidate.highlight ?? "").slice(0, MAX_HIGHLIGHT_CHARS);
  const fallbackUrl = candidate.domain ? `https://${candidate.domain}/` : "";
  const sourceUrl = candidate.sourceUrl || fallbackUrl || null;

  if (highlight) {
    sources.push({ url: sourceUrl ?? "", kind: "highlight", text: highlight });
  }

  // Only pages that describe THE COMPANY. A crawl also reaches careers/customers/blog pages, which talk
  // about other people's businesses — reading them as self-description is how a job board became a food
  // producer (its listings name F&B roles).
  let budget = MAX_IDENTITY_CHARS;
  for (const raw of pages) {
    if (budget <= 0) break;
    const model = extractPageModel(raw);
    if (!IDENTITY_PAGE_TYPES.has(model.pageType)) continue;
    if (isLowQualityPage({ title: model.title, h1: model.h1, mainText: model.mainText })) continue;
    const text = squash([model.title, identityText(model)].filter(Boolean).join(" | ")).slice(0, budget);
    if (!text) continue;
    budget -= text.length;
    sources.push({ url: raw.url, kind: "page", text });
  }

  return {
    name: candidate.name,
    domain: candidate.domain,
    sourceUrl,
    sources,
    text: sources.map((source) => source.text).join(SOURCE_SEPARATOR),
    facts: parseEvidenceFacts(highlight),
    prose: parseExaCompanyProse(highlight),
  };
}

// "Riyad Bank is a Banking company headquartered in Riyadh, Saudi Arabia. Riyad Bank employs 25,498
// people". Exa writes this opening sentence for company pages even when no `- Industry:` record follows,
// so it is the cheapest honest source of industry and headcount. Every quantifier is bounded: the input
// is provider text and must not be able to make this quadratic.
const INDUSTRY_SENTENCE = /^[^.]{1,120}?\bis an? ([A-Za-z][A-Za-z,&\- ]{1,60}?) company\b/;
const EMPLOYEES_SENTENCE = /\bemploys?\s+(?:approximately\s+|about\s+|around\s+|over\s+)?(\d{1,3}(?:,\d{3})+|\d{1,9})\s+(?:people|employees)/i;
const HEADQUARTERS_SENTENCE = /\bheadquartered\s+in\s+([A-Z][^.;]{1,80}?)(?:\.|;|,\s+with\b|$)/;
const MAX_INDUSTRY_WORDS = 6;
const NOT_AN_INDUSTRY = /\b(?:of|the|that|which|a|an|for)\b/i;

export function parseExaCompanyProse(text: string | null | undefined): ExaCompanyProse {
  const head = squash(text ?? "").slice(0, MAX_HIGHLIGHT_CHARS);
  const industryMatch = INDUSTRY_SENTENCE.exec(head);
  const industry = industryMatch ? industryFrom(industryMatch[1]) : null;
  const employeesMatch = EMPLOYEES_SENTENCE.exec(head);
  const employees = employeesMatch ? Number.parseInt(employeesMatch[1].replace(/,/g, ""), 10) : null;
  const hqMatch = HEADQUARTERS_SENTENCE.exec(head);
  return {
    industry,
    employeeCount: employees !== null && Number.isFinite(employees) && employees > 0 ? employees : null,
    headquarters: hqMatch ? hqMatch[1].trim() : null,
  };
}

/**
 * "Banking" yes; "leading provider of widgets and a" no. The sentence shape also matches a marketing
 * clause, and a clause is not an industry — that would put a tagline in the industry column.
 */
function industryFrom(value: string): string | null {
  const industry = value.trim();
  if (!industry) return null;
  if (industry.split(/\s+/).length > MAX_INDUSTRY_WORDS) return null;
  if (NOT_AN_INDUSTRY.test(industry)) return null;
  return industry;
}

export function isEvidenceThin(bundle: ClassificationBundle, deterministic: { decided: boolean }): boolean {
  if (deterministic.decided) return false;
  if (bundle.facts.isStructured) return false;
  return bundle.text.length < MIN_EVIDENCE_CHARS;
}

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
