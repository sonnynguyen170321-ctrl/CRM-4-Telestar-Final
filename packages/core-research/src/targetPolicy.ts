import { canonicalizeIndustry, type IndustryKey } from "@telestar/core-scoring/rules/dictionaries/industry";
import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";

import { COMPANY_KINDS, type CompanyKind } from "./verificationTypes";

// Which KINDS of company an ICP wants, decided before any score (owner report, 2026-10-08).
//
// A score cannot tell a bank from the association of banks: both talk about banking, in the right
// country. But the kind is a classifier's reading, so it rejects only when the ICP says so unambiguously:
// a kind the ICP's own industries do not include, or one the run names a competitor. When the ICP does not
// say, a person decides ("review"). Pure.

export type KindDecision = "accept" | "review" | "reject" | "competitor";
export type KindPolicy = Record<CompanyKind, KindDecision>;

const SOFTWARE_SIDE: ReadonlySet<IndustryKey> = new Set(["SOFTWARE", "SAAS", "IT_SERVICES", "CYBERSECURITY", "CLOUD_HOSTING"]);
const SERVICES_SIDE: ReadonlySet<IndustryKey> = new Set(["IT_SERVICES", "MARKETING", "ADVERTISING"]);
const PRODUCER_SECTORS: ReadonlySet<IndustryKey> = new Set(["FMCG", "MANUFACTURING", "AGRICULTURE"]);
const DISTRIBUTION_SECTORS: ReadonlySet<IndustryKey> = new Set(["RETAIL", "ECOMMERCE", "LOGISTICS"]);
// A marketplace is an e-commerce operator, so an e-commerce ICP wants it.
const MARKETPLACE_SECTORS: ReadonlySet<IndustryKey> = new Set(["ECOMMERCE", "RETAIL"]);

// A kind that is a prospect only for an ICP aimed at that very sector.
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

function wholesalerDecision(keys: ReadonlySet<IndustryKey>): KindDecision {
  // A wholesaler is not the producer an FMCG or manufacturing ICP is after, unless the ICP also
  // sells into distribution.
  return targets(keys, PRODUCER_SECTORS) && !targets(keys, DISTRIBUTION_SECTORS) ? "reject" : "review";
}

/** The default decision for each company kind under an ICP's rules. */
export function defaultKindPolicy(rules: IcpVersionRulesV2): KindPolicy {
  const keys = targetKeys(rules);
  // Rejecting a sector-less kind needs the ICP to have said what it WANTS; with no industries named,
  // nothing contradicts a school or an association, so a person looks.
  const hasTargets = rules.industry.targetIndustries.length > 0;
  const policy = {} as KindPolicy;
  for (const kind of COMPANY_KINDS) {
    const sector = SECTOR_OF_KIND[kind];
    policy[kind] = sector && keys.has(sector) ? "accept" : hasTargets ? "reject" : "review";
  }
  policy.operator = "accept";
  // A vendor is a prospect only for a software-side ICP. Otherwise it may be a buyer's supplier or a prospect
  // the classifier mislabelled, so it is reviewed, not rejected, unless the run lists vendors as competitors.
  policy.software_vendor = targets(keys, SOFTWARE_SIDE) ? "accept" : "review";
  policy.services_agency = targets(keys, SERVICES_SIDE) ? "accept" : "review";
  policy.reseller_wholesaler = wholesalerDecision(keys);
  policy.directory_marketplace_jobboard = targets(keys, MARKETPLACE_SECTORS) ? "review" : hasTargets ? "reject" : "review";
  return policy;
}

const isKind = (value: unknown): value is CompanyKind => typeof value === "string" && (COMPANY_KINDS as readonly string[]).includes(value);
const isDecision = (value: unknown): value is KindDecision =>
  value === "accept" || value === "review" || value === "reject" || value === "competitor";

/**
 * The policy a run uses: the default, then the run's stored overrides.
 *
 * `targetCompanyKinds` as a list names the only kinds to accept (everything else is rejected); as an object it
 * sets a decision per kind over the defaults. `competitorKinds` marks kinds as competitors (rejected as
 * `competitor:<kind>`). Anything unreadable falls back to the defaults, never to "accept all".
 */
export function resolveKindPolicy(paramsJson: unknown, rules: IcpVersionRulesV2): KindPolicy {
  let policy = defaultKindPolicy(rules);
  if (!paramsJson || typeof paramsJson !== "object") return policy;
  const params = paramsJson as Record<string, unknown>;
  const stored = params.targetCompanyKinds;

  if (Array.isArray(stored)) {
    const wanted = new Set(stored.filter(isKind));
    if (wanted.size > 0) {
      policy = Object.fromEntries(COMPANY_KINDS.map((kind) => [kind, wanted.has(kind) ? "accept" : "reject"])) as KindPolicy;
    }
  } else if (stored && typeof stored === "object") {
    const overrides = Object.entries(stored as Record<string, unknown>).filter(
      (entry): entry is [CompanyKind, KindDecision] => isKind(entry[0]) && isDecision(entry[1]),
    );
    policy = { ...policy, ...Object.fromEntries(overrides) };
  }

  if (Array.isArray(params.competitorKinds)) {
    const competitors = params.competitorKinds.filter(isKind);
    policy = { ...policy, ...Object.fromEntries(competitors.map((kind) => [kind, "competitor"])) };
  }
  return policy;
}
