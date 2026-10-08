import { isInstitutionalHost, registrableDomain } from "@telestar/core-identity/registrableDomain";
import { isParkedText } from "@telestar/core-intel/fetchWebsite";
import { resolveSizeBand } from "@telestar/core-scoring/rules/dictionaries/sizeBands";
import type { ClassificationBundle } from "./classificationEvidence";
import type {
  ClassificationConfidence,
  ClassificationEvidence,
  CompanyClassification,
  CompanyKind,
  NotCompanyReason,
} from "./companyClassification";
import { looksLikeListicleResult } from "./parseDiscoveryResults";

// The part of classification that needs no model. A LinkedIn record that says "Type: Nonprofit" or a
// `.gov.ae` host is better evidence than anything a model infers from a snippet, and it costs nothing.
//
// Two tiers. `decided` means a HARD rule fired and groundClassification lets it overrule the model: only
// rules that have no realistic false positive are hard (LinkedIn Type, institutional and listing hosts,
// a parked homepage). Everything else is a `hint`: it goes into the prompt as a non-binding signal the
// model may overrule with field-matched evidence. LinkedIn Industry is a hint, not a rule, because
// "Wholesale", "Government Relations" or "Online Media" also describe prospects (an aircraft-parts
// distributor, an ad platform) and a hard rule would reject them with no way back.

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

/** A non-binding signal for the prompt. `reason` is built from fixed wording only, never page text. */
export type DeterministicHint =
  | { field: "companyKind"; value: CompanyKind; reason: string }
  | { field: "notCompanyReason"; value: NotCompanyReason; reason: string };

export type DeterministicClassification = {
  partial: DeterministicPartial;
  decided: boolean;
  hardEvidence: ClassificationEvidence[];
  hints: DeterministicHint[];
};

// LinkedIn "Type" values that name a non-commercial body.
const LINKEDIN_TYPE_KIND: ReadonlyArray<readonly [RegExp, CompanyKind]> = [
  [/\bnon-?profit\b/i, "association_nonprofit"],
  [/\bgovernment agency\b/i, "government"],
  [/\beducational\b/i, "education"],
];

// LinkedIn "Industry" values that usually, but not always, name a non-prospect.
const LINKEDIN_INDUSTRY_HINT: ReadonlyArray<readonly [RegExp, CompanyKind]> = [
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

type RuleVerdict = { partial: DeterministicPartial; evidence: ClassificationEvidence[] };

export function classifyDeterministically(bundle: ClassificationBundle): DeterministicClassification {
  const partial: DeterministicPartial = {};
  carryOverFacts(bundle, partial);

  // LinkedIn Type before the host: a LinkedIn-sourced candidate has the record but no company domain.
  const hard = parkedVerdict(bundle) ?? linkedinTypeVerdict(bundle) ?? hostVerdict(bundle);
  if (hard) {
    return {
      partial: { ...partial, ...hard.partial, confidence: "high" },
      decided: true,
      hardEvidence: hard.evidence,
      hints: [],
    };
  }
  return { partial, decided: false, hardEvidence: [], hints: softHints(bundle) };
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

/** Only the first source: a parking page is a stub, and a later page cannot make a site parked. */
function parkedVerdict(bundle: ClassificationBundle): RuleVerdict | null {
  const first = bundle.sources[0];
  if (!first || !isParkedText(first.text)) return null;
  return {
    partial: { isCompanySite: false, notCompanyReason: "parked", companyKind: null },
    evidence: [{ field: "notCompanyReason", quote: first.text.slice(0, 200), sourceUrl: first.url }],
  };
}

function linkedinTypeVerdict(bundle: ClassificationBundle): RuleVerdict | null {
  const type = factValue(bundle, "type");
  const match = type ? LINKEDIN_TYPE_KIND.find(([pattern]) => pattern.test(type)) : undefined;
  if (!type || !match) return null;
  // The quote is the record's own `Type: value`, so a reviewer can find it on the page.
  const quote = `Type: ${type}`;
  if (!bundle.text.includes(quote)) return null;
  return {
    partial: { isCompanySite: true, notCompanyReason: null, companyKind: match[1] },
    evidence: [{ field: "companyKind", quote, sourceUrl: bundle.sources[0]?.url ?? bundle.sourceUrl ?? "" }],
  };
}

/**
 * Host rules read the candidate's own domain only. A LinkedIn-sourced candidate has a null domain and a
 * `linkedin.com` source URL; falling back to that URL made every such candidate a job board.
 */
function hostVerdict(bundle: ClassificationBundle): RuleVerdict | null {
  const root = registrableDomain(bundle.domain);
  if (!root) return null;

  let kind: CompanyKind | null = null;
  if (isInstitutionalHost(bundle.domain)) {
    // `techglobal.edu.vn` -> suffix `edu.vn` -> first label `edu`: the suffix says which kind of body.
    const suffixFirst = root.split(".").slice(1)[0] ?? "";
    kind = ACADEMIC_SUFFIX_LABELS.has(suffixFirst) ? "education" : "government";
  } else if (LISTING_HOSTS.has(root)) {
    kind = "directory_marketplace_jobboard";
  }
  if (!kind) return null;

  return {
    partial: { isCompanySite: true, notCompanyReason: null, companyKind: kind },
    // Synthetic: marked as a rule's output so nothing mistakes it for a quote from the page.
    evidence: [{ field: "companyKind", quote: `host ${root}`, sourceUrl: bundle.sourceUrl ?? `https://${root}/`, origin: "rule" }],
  };
}

function softHints(bundle: ClassificationBundle): DeterministicHint[] {
  const hints: DeterministicHint[] = [];
  const industry = factValue(bundle, "industry");
  const fromIndustry = industry ? LINKEDIN_INDUSTRY_HINT.find(([pattern]) => pattern.test(industry)) : undefined;
  if (fromIndustry) {
    hints.push({ field: "companyKind", value: fromIndustry[1], reason: `the LinkedIn industry line suggests ${fromIndustry[1]}` });
  }

  const path = pathOf(bundle.sourceUrl);
  if (looksLikeListicleResult(bundle.name)) {
    hints.push({ field: "notCompanyReason", value: "listicle", reason: "the title reads like a ranked list" });
  } else if (path && JOB_POSTING_PATH.test(path)) {
    hints.push({ field: "notCompanyReason", value: "job_posting", reason: "the url path looks like a job posting" });
  } else if (path && ARTICLE_PATH.test(path)) {
    hints.push({ field: "notCompanyReason", value: "article", reason: "the url path looks like an article" });
  }

  if (!fromIndustry && ASSOCIATION_NAME.test(bundle.name)) {
    hints.push({ field: "companyKind", value: "association_nonprofit", reason: "the name contains an association-style word" });
  }
  return hints;
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
