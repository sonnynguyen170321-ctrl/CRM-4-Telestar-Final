import type { IcpVersionRulesV2 } from "@telestar/core-scoring/rules/schema-v2";
import type { ParsedCandidate } from "./parseDiscoveryResults";

// Discovery-time ICP exclusion. Discovery is intentionally permissive (cast wide, let scoring decide),
// but harvesting candidates the ICP hard-excludes wastes the expensive downstream steps (liveness
// probe + auto-enrichment + search quota). This drops, from the thin SERP evidence, the candidates a
// full assessment would terminally reject anyway: services/consulting companies (when the ICP opts in),
// explicitly excluded industries, and competitor-denylist domains. Conservative + opt-in — it only
// fires on rules the ICP actually sets, and matches on unambiguous terms so a real prospect whose
// snippet merely mentions a term is unlikely to be dropped. Pure + unit-tested.

// Company self-description terms for a services/consulting business (mirrors the TeleStar negative
// signals). Word-boundary matched. Only consulted when servicesConsultingPolicy.disqualify is set.
const SERVICES_TERMS = [
  "consulting", "consultancy", "managed services", "outsourcing", "professional services",
  "system integrator", "staffing agency", "bpo", "advisory services", "it services", "agency",
];

const matcherCache = new Map<string, RegExp>();
function boundary(term: string): RegExp {
  let re = matcherCache.get(term);
  if (!re) {
    const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu");
    matcherCache.set(term, re);
  }
  return re;
}

export type IcpExclusion = { excluded: boolean; reason?: string };

/**
 * Whether the ICP hard-excludes this candidate based on its harvested SERP text. Returns
 * `{ excluded: false }` when no opted-in exclusion matches.
 */
export function isCandidateExcludedByIcp(candidate: ParsedCandidate, rules: IcpVersionRulesV2): IcpExclusion {
  const text = [candidate.name, candidate.companyName, candidate.title, candidate.domain, candidate.source?.snippet]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text.trim()) return { excluded: false };

  // 1. Services / consulting (opt-in via companyType.servicesConsultingPolicy.disqualify).
  const svc = rules.companyType?.servicesConsultingPolicy;
  if (svc?.disqualify) {
    const exception = (svc.exceptMarkets ?? []).some((m) => m && boundary(m).test(text));
    if (!exception && SERVICES_TERMS.some((t) => boundary(t).test(text))) {
      return { excluded: true, reason: "services_consulting_based" };
    }
  }

  // 2. Explicitly excluded industries.
  for (const industry of rules.industry?.excludedIndustries ?? []) {
    if (industry && boundary(industry).test(text)) return { excluded: true, reason: "excluded_industry" };
  }

  // 3. Competitor denylist (name or domain).
  for (const competitor of rules.disqualifiers?.competitorDenylist ?? []) {
    const c = String(competitor ?? "").trim().toLowerCase();
    if (c && (boundary(c).test(text) || (candidate.domain ?? "").toLowerCase().includes(c))) {
      return { excluded: true, reason: "competitor_denylist" };
    }
  }

  return { excluded: false };
}
