import { canonicalizeIndustry, type IndustryKey } from "@telestar/core-scoring/rules/dictionaries/industry";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import { COMPANY_KINDS, type CompanyKind } from "./verificationTypes";

// Which KINDS of company an ICP wants, decided before any score (owner report, 2026-10-08).
//
// A score cannot tell a bank from the association of banks: both talk about banking, in the right
// country. Production returned schools, analyst firms, job boards and software vendors for operator
// ICPs, so the kind is judged first and the score only ranks what is left. Pure.

export type KindDecision = "accept" | "review" | "reject";
export type KindPolicy = Record<CompanyKind, KindDecision>;

const SOFTWARE_SIDE: ReadonlySet<IndustryKey> = new Set(["SOFTWARE", "SAAS", "IT_SERVICES", "CYBERSECURITY", "CLOUD_HOSTING"]);
const SERVICES_SIDE: ReadonlySet<IndustryKey> = new Set(["IT_SERVICES", "MARKETING", "ADVERTISING"]);
const PRODUCER_SECTORS: ReadonlySet<IndustryKey> = new Set(["FMCG", "MANUFACTURING", "AGRICULTURE"]);
const DISTRIBUTION_SECTORS: ReadonlySet<IndustryKey> = new Set(["RETAIL", "ECOMMERCE", "LOGISTICS"]);

// A kind that is a prospect only for an ICP aimed at that very sector. Events, associations,
// directories and analyst firms have no sector here: they are never the account an SDR sells to.
const SECTOR_OF_KIND: Partial<Record<CompanyKind, IndustryKey>> = {
  government: "GOVERNMENT",
  education: "EDUCATION",
  media_news: "MEDIA",
};

function targetKeys(rules: IcpVersionRulesV2): Set<IndustryKey> {
  const keys = new Set<IndustryKey>();
  for (const term of rules.industry.targetIndustries) {
    const key = canonicalizeIndustry(term);
    if (key) keys.add(key);
  }
  return keys;
}

const targets = (keys: ReadonlySet<IndustryKey>, wanted: ReadonlySet<IndustryKey>): boolean =>
  [...keys].some((key) => wanted.has(key));

function vendorDecision(keys: ReadonlySet<IndustryKey>, hasTargets: boolean): KindDecision {
  if (targets(keys, SOFTWARE_SIDE)) return "accept";
  // An ICP that names no industry has not said whether a vendor is wanted: a person decides.
  return hasTargets ? "reject" : "review";
}

function agencyDecision(keys: ReadonlySet<IndustryKey>, rules: IcpVersionRulesV2): KindDecision {
  const policy = rules.companyType.servicesConsultingPolicy;
  // An exception market (TeleStar: Vietnam) means a services firm is wanted in one country only, so
  // the candidate's country decides and this stage cannot.
  if (policy.disqualify) return policy.exceptMarkets.length > 0 ? "review" : "reject";
  return targets(keys, SERVICES_SIDE) ? "accept" : "review";
}

function wholesalerDecision(keys: ReadonlySet<IndustryKey>): KindDecision {
  // A wholesaler is not the producer an FMCG or manufacturing ICP is after, unless the ICP also
  // sells into distribution.
  return targets(keys, PRODUCER_SECTORS) && !targets(keys, DISTRIBUTION_SECTORS) ? "reject" : "review";
}

/** The default decision for each company kind under an ICP's rules. */
export function defaultKindPolicy(rules: IcpVersionRulesV2): KindPolicy {
  const keys = targetKeys(rules);
  const hasTargets = rules.industry.targetIndustries.length > 0;
  const policy = {} as KindPolicy;
  for (const kind of COMPANY_KINDS) {
    const sector = SECTOR_OF_KIND[kind];
    policy[kind] = sector && keys.has(sector) ? "accept" : "reject";
  }
  policy.operator = "accept";
  policy.software_vendor = vendorDecision(keys, hasTargets);
  policy.services_agency = agencyDecision(keys, rules);
  policy.reseller_wholesaler = wholesalerDecision(keys);
  return policy;
}

const isKind = (value: unknown): value is CompanyKind => typeof value === "string" && (COMPANY_KINDS as readonly string[]).includes(value);
const isDecision = (value: unknown): value is KindDecision => value === "accept" || value === "review" || value === "reject";

/**
 * The policy a run uses: the default, unless the run stored `targetCompanyKinds`.
 *
 * A list names the only kinds to accept (everything else is rejected); an object sets a decision per
 * kind over the defaults. Anything unreadable falls back to the defaults, never to "accept all".
 */
export function resolveKindPolicy(paramsJson: unknown, rules: IcpVersionRulesV2): KindPolicy {
  const fallback = defaultKindPolicy(rules);
  if (!paramsJson || typeof paramsJson !== "object") return fallback;
  const stored = (paramsJson as Record<string, unknown>).targetCompanyKinds;

  if (Array.isArray(stored)) {
    const wanted = new Set(stored.filter(isKind));
    if (wanted.size === 0) return fallback;
    return Object.fromEntries(COMPANY_KINDS.map((kind) => [kind, wanted.has(kind) ? "accept" : "reject"])) as KindPolicy;
  }

  if (stored && typeof stored === "object") {
    const overrides = Object.entries(stored as Record<string, unknown>).filter(
      (entry): entry is [CompanyKind, KindDecision] => isKind(entry[0]) && isDecision(entry[1]),
    );
    return { ...fallback, ...Object.fromEntries(overrides) };
  }

  return fallback;
}
