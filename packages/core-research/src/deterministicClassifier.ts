import { isInstitutionalHost, registrableDomain } from "@telestar/core-identity/registrableDomain";
import { isParkedText } from "@telestar/core-intel/fetchWebsite";
import { resolveSizeBand } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import type { ClassificationBundle } from "./classificationEvidence";
import type { ClassificationConfidence, ClassificationEvidence, CompanyClassification, CompanyKind } from "./companyClassification";
import { looksLikeListicleResult } from "./parseDiscoveryResults";

// The part of classification that needs no model. A LinkedIn record that says "Type: Nonprofit" or a
// `.gov.ae` host is better evidence than anything a model infers from a snippet, and it costs nothing.
//
// `decided` means a HARD rule fired: groundClassification lets that verdict overrule the model. Soft
// hints (an association-sounding name, a /blog/ path) set `partial` at medium confidence only — a firm
// called "Aerospace Council Ltd" is still a company often enough that the model must get a say.

export type DeterministicPartial = Partial<
  Pick<
    CompanyClassification,
    | "isCompanySite"
    | "notCompanyReason"
    | "companyKind"
    | "industryText"
    | "employeeCount"
    | "employeeBand"
  >
> & { confidence?: ClassificationConfidence };

export type DeterministicClassification = {
  partial: DeterministicPartial;
  decided: boolean;
  hardEvidence: ClassificationEvidence[];
};

// LinkedIn "Type" values that name a non-commercial body.
const LINKEDIN_TYPE_KIND: ReadonlyArray<readonly [RegExp, CompanyKind]> = [
  [/\bnon-?profit\b/i, "association_nonprofit"],
  [/\bgovernment agency\b/i, "government"],
  [/\beducational\b/i, "education"],
];

// LinkedIn "Industry" values. Only industries whose members are never an operating prospect are here;
// "Banking" or "Airlines and Aviation" must stay undecided so the model can see what the company does.
const LINKEDIN_INDUSTRY_KIND: ReadonlyArray<readonly [RegExp, CompanyKind]> = [
  [/\bmarket research\b/i, "research_analyst"],
  [/\bstaffing and recruiting\b/i, "services_agency"],
  [/\bevents? services\b/i, "event"],
  [/\bwholesale\b/i, "reseller_wholesaler"],
  [/\b(?:newspaper|broadcast media|online (?:audio and video )?media)\b/i, "media_news"],
  [/\b(?:non-?profit|civic and social|professional organizations?|philanthropic)\b/i, "association_nonprofit"],
  [/\b(?:higher education|primary and secondary education|education administration)\b/i, "education"],
  [/\b(?:government administration|government relations|public policy|military and international affairs|legislative offices)\b/i, "government"],
];

// Registrable domains of job boards, review sites and company directories. A listing page here describes
// OTHER companies; GulfTalent (2026-10-08) was shortlisted because its job ads named the target sector.
const LISTING_HOSTS: ReadonlySet<string> = new Set([
  "gulftalent.com", "bayt.com", "naukrigulf.com", "indeed.com", "glassdoor.com", "monster.com",
  "ziprecruiter.com", "jobstreet.com", "seek.com.au", "vietnamworks.com", "topcv.vn", "careerbuilder.com",
  "reed.co.uk", "totaljobs.com", "linkedin.com", "clutch.co", "goodfirms.co", "g2.com", "capterra.com",
  "trustpilot.com", "crunchbase.com", "zoominfo.com", "yellowpages.com", "dnb.com", "kompass.com",
  "tripadvisor.com", "yelp.com", "sortlist.com", "designrush.com", "themanifest.com",
]);

const ASSOCIATION_NAME = /\b(?:association|federation|chamber of commerce|chamber|council|society|hiep hoi|hiệp hội)\b/i;
const ARTICLE_PATH = /\/(?:blog|news|article|articles|post|posts|press|insights)\/|\/\d{4}\/\d{2}\//i;
const JOB_POSTING_PATH = /\/(?:jobs?|careers?|vacanc(?:y|ies))\/[^/]+/i;
// Government-owned suffix first labels vs academic ones.
const ACADEMIC_SUFFIX_LABELS: ReadonlySet<string> = new Set(["edu", "ac"]);
const MAX_INDUSTRY_TEXT = 80;

export function classifyDeterministically(bundle: ClassificationBundle): DeterministicClassification {
  const partial: DeterministicPartial = {};

  carryOverFacts(bundle, partial);

  const parked = parkedVerdict(bundle);
  if (parked) return decide(partial, parked.partial, parked.evidence);

  const host = hostVerdict(bundle);
  if (host) return decide(partial, host.partial, host.evidence);

  const record = linkedinVerdict(bundle);
  if (record) return decide(partial, record.partial, record.evidence);

  applySoftHints(bundle, partial);
  return { partial, decided: false, hardEvidence: [] };
}

function decide(
  base: DeterministicPartial,
  verdict: DeterministicPartial,
  evidence: ClassificationEvidence[]
): DeterministicClassification {
  return { partial: { ...base, ...verdict, confidence: "high" }, decided: true, hardEvidence: evidence };
}

/** Industry text and headcount the record states, whether or not a hard rule fires. */
function carryOverFacts(bundle: ClassificationBundle, partial: DeterministicPartial): void {
  const industry = factValue(bundle, "industry") ?? bundle.prose.industry;
  if (industry) partial.industryText = industry.slice(0, MAX_INDUSTRY_TEXT);

  const employees = headcountOf(bundle);
  if (employees !== null) {
    partial.employeeCount = employees;
    const band = resolveSizeBand(employees);
    if (band) partial.employeeBand = band;
  }
}

function headcountOf(bundle: ClassificationBundle): number | null {
  const stated = factValue(bundle, "employees");
  if (stated && /^\d[\d,]*$/.test(stated)) {
    const parsed = Number.parseInt(stated.replace(/,/g, ""), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return bundle.prose.employeeCount;
}

function parkedVerdict(bundle: ClassificationBundle): { partial: DeterministicPartial; evidence: ClassificationEvidence[] } | null {
  const first = bundle.sources[0];
  if (!first || !isParkedText(bundle.text)) return null;
  return {
    partial: { isCompanySite: false, notCompanyReason: "parked", companyKind: null },
    evidence: [{ field: "notCompanyReason", quote: first.text.slice(0, 200), sourceUrl: first.url }],
  };
}

function hostVerdict(bundle: ClassificationBundle): { partial: DeterministicPartial; evidence: ClassificationEvidence[] } | null {
  const subject = bundle.domain ?? bundle.sourceUrl;
  const root = registrableDomain(subject);
  if (!root) return null;
  const sourceUrl = bundle.sourceUrl ?? `https://${root}/`;

  let kind: CompanyKind | null = null;
  if (isInstitutionalHost(subject)) {
    // `techglobal.edu.vn` -> suffix `edu.vn` -> first label `edu`: the suffix says which kind of body.
    const suffixFirst = root.split(".").slice(1)[0] ?? "";
    kind = ACADEMIC_SUFFIX_LABELS.has(suffixFirst) ? "education" : "government";
  } else if (LISTING_HOSTS.has(root)) {
    kind = "directory_marketplace_jobboard";
  }
  if (!kind) return null;

  return {
    partial: { isCompanySite: true, notCompanyReason: null, companyKind: kind },
    evidence: [{ field: "companyKind", quote: `host ${root}`, sourceUrl }],
  };
}

function linkedinVerdict(bundle: ClassificationBundle): { partial: DeterministicPartial; evidence: ClassificationEvidence[] } | null {
  const sourceUrl = bundle.sources[0]?.url ?? bundle.sourceUrl ?? "";
  const type = factValue(bundle, "type");
  const industry = factValue(bundle, "industry");

  const fromType = type ? LINKEDIN_TYPE_KIND.find(([pattern]) => pattern.test(type)) : undefined;
  if (type && fromType) return verdict(fromType[1], "Type", type, bundle, sourceUrl);

  const fromIndustry = industry ? LINKEDIN_INDUSTRY_KIND.find(([pattern]) => pattern.test(industry)) : undefined;
  if (industry && fromIndustry) return verdict(fromIndustry[1], "Industry", industry, bundle, sourceUrl);
  return null;
}

function verdict(
  kind: CompanyKind,
  label: string,
  value: string,
  bundle: ClassificationBundle,
  sourceUrl: string
): { partial: DeterministicPartial; evidence: ClassificationEvidence[] } | null {
  // The quote is the record's own `Label: value`, so a reviewer can find it on the page.
  const labelled = `${label}: ${value}`;
  const quote = bundle.text.includes(labelled) ? labelled : bundle.text.includes(value) ? value : null;
  if (!quote || quote.length < 8) return null;
  return {
    partial: { isCompanySite: true, notCompanyReason: null, companyKind: kind },
    evidence: [{ field: "companyKind", quote, sourceUrl }],
  };
}

function applySoftHints(bundle: ClassificationBundle, partial: DeterministicPartial): void {
  partial.confidence = "medium";
  const path = pathOf(bundle.sourceUrl);

  if (looksLikeListicleResult(bundle.name)) {
    Object.assign(partial, { isCompanySite: false, notCompanyReason: "listicle", companyKind: null });
    return;
  }
  if (path && JOB_POSTING_PATH.test(path)) {
    Object.assign(partial, { isCompanySite: false, notCompanyReason: "job_posting", companyKind: null });
    return;
  }
  if (path && ARTICLE_PATH.test(path)) {
    Object.assign(partial, { isCompanySite: false, notCompanyReason: "article", companyKind: null });
    return;
  }
  if (ASSOCIATION_NAME.test(bundle.name)) {
    partial.companyKind = "association_nonprofit";
    return;
  }
  // Nothing fired: say nothing, rather than a medium-confidence "no opinion".
  delete partial.confidence;
}

function factValue(bundle: ClassificationBundle, key: "industry" | "type" | "employees"): string | null {
  return bundle.facts.facts.find((fact) => fact.key === key)?.value ?? null;
}

function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}
