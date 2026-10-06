import type {
  GateHit,
  NormalizedScoringEvidence,
  TerminalGateResult,
} from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { countryKey, foldText } from "../normalize/normalizeCountry";

// SC2: pipeline step 2 — terminal hard gates. Each gate is a pure predicate
// returning a GateHit when it fires, else null. Any hit -> UNQUALIFIED (in SC3).
// Pure; no I/O.

const SERVICES_CONSULTING_KEYWORDS = [
  "agency",
  "consulting",
  "consultancy",
  "outsourcing",
  "managed services",
  "services only",
  "system integrator",
  "staffing",
];

type Gate = (
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
) => GateHit | null;

function foldedSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => countryKey(value)));
}

// Excluded HQ country, or excluded office/delivery country when the rule scopes
// beyond HQ. Powers TeleStar "offices in India/Pakistan/Bangladesh/Philippines".
const excludedCountryGate: Gate = (evidence, rules) => {
  const { geography } = rules;
  const excludedHq = foldedSet(geography.excludedCountries);
  const excludedOffice = foldedSet(geography.excludedOfficeCountries);

  const hqCountry = evidence.company.country;
  if (hqCountry && excludedHq.has(countryKey(hqCountry))) {
    return {
      id: "excluded_country",
      label: "Excluded HQ geography",
      reasonCode: "target_geo_mismatch_explicit",
      evidence: hqCountry,
    };
  }

  const scopesOffices =
    geography.locationScope === "any_office" || geography.locationScope === "delivery";
  const officeChecks = scopesOffices
    ? evidence.company.officeCountries
    : [];

  for (const office of officeChecks) {
    const folded = countryKey(office);
    if (excludedOffice.has(folded) || excludedHq.has(folded)) {
      return {
        id: "excluded_office_country",
        label: "Office/delivery in excluded geography",
        reasonCode: "target_geo_mismatch_explicit",
        evidence: office,
      };
    }
  }

  return null;
};

const onePersonCompanyGate: Gate = (evidence, rules) => {
  const rule = rules.disqualifiers.onePersonCompany;
  if (!rule.disqualify) {
    return null;
  }

  const threshold = rule.threshold ?? 2;
  const count = evidence.company.employeeCount;

  if (count !== null && count < threshold) {
    return {
      id: "one_person_company",
      label: "Company below minimum headcount",
      reasonCode: "company_too_small",
      evidence: `${count} employees (min ${threshold})`,
    };
  }

  return null;
};

const websiteOfflineGate: Gate = (evidence, rules) => {
  if (!rules.disqualifiers.websiteOffline.disqualify) {
    return null;
  }

  if (evidence.company.websiteStatus === "offline") {
    return {
      id: "website_offline",
      label: "Website offline",
      reasonCode: "website_offline",
      evidence: "website status: offline",
    };
  }

  return null;
};

const SERVICES_CONSULTING_PATTERNS = SERVICES_CONSULTING_KEYWORDS.map(
  (keyword) => new RegExp(`(?<![\\p{L}\\p{N}])${keyword}(?![\\p{L}\\p{N}])`, "u")
);

/**
 * How strongly the evidence says "services / consulting firm", for an ICP that excludes them.
 *
 * `strong`: the company is classified SERVICE_ONLY / AGENCY. The only signal that rules a lead out.
 * `mentioned`: the words appear somewhere — the industry label, the description, research facts.
 * LinkedIn files most software companies under "IT Services and IT Consulting", and a description
 * that "replaces consulting-heavy rollouts" is no consultancy, so a word alone used to rule out good
 * leads (production, 2026-10-06). A mention is for a person to judge: a lead that would otherwise
 * qualify goes to needs_review instead (lib/leadgen/weightedQualification.ts, pointsQualification.ts).
 */
export function servicesSignal(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): "none" | "mentioned" | "strong" {
  const policy = rules.companyType.servicesConsultingPolicy;
  if (!policy.disqualify) return "none";

  const country = evidence.company.country;
  const exceptMarkets = foldedSet(policy.exceptMarkets);
  if (country && exceptMarkets.has(countryKey(country))) {
    return "none"; // conditional exception — allowed in this market
  }

  if (evidence.company.companyType === "SERVICE_ONLY" || evidence.company.companyType === "AGENCY") {
    return "strong";
  }
  const text = evidence.company.evidenceText;
  return SERVICES_CONSULTING_PATTERNS.some((pattern) => pattern.test(text)) ? "mentioned" : "none";
}

// Services/consulting disqualifier with conditional market exception:
// TeleStar excludes services/consulting EXCEPT in Vietnam. Fatal only on a classification.
const servicesConsultingGate: Gate = (evidence, rules) => {
  if (servicesSignal(evidence, rules) !== "strong") {
    return null;
  }
  return {
    id: "services_consulting_based",
    label: "Services / consulting based company",
    reasonCode: "services_consulting_based",
    evidence: evidence.company.companyType,
  };
};

const genericEmailGate: Gate = (evidence, rules) => {
  if (!rules.disqualifiers.genericEmailContact.disqualify) {
    return null;
  }

  if (evidence.contact?.isGenericEmail) {
    return {
      id: "generic_email_contact",
      label: "Contact uses a free/consumer email provider",
      reasonCode: "generic_email_contact",
      evidence: evidence.contact.emailDomain ?? "generic email",
    };
  }

  return null;
};

const competitorDenylistGate: Gate = (evidence, rules) => {
  const denylist = rules.disqualifiers.competitorDenylist;
  if (denylist.length === 0) {
    return null;
  }

  const name = foldText(evidence.company.companyName);
  const domain = evidence.company.domain ? foldText(evidence.company.domain) : "";

  for (const entry of denylist) {
    const folded = foldText(entry);
    if (!folded) {
      continue;
    }
    if (name.includes(folded) || (domain && domain.includes(folded))) {
      return {
        id: "competitor_denylisted",
        label: "Company on competitor/avoid denylist",
        reasonCode: "competitor_denylisted",
        evidence: entry,
      };
    }
  }

  return null;
};

const projectBasedGate: Gate = (evidence, rules) => {
  if (!rules.disqualifiers.projectBased.disqualify) {
    return null;
  }

  if (evidence.company.isProjectBased) {
    return {
      id: "project_based",
      label: "Project-based engagement model",
      reasonCode: "project_based",
      evidence: "project-based flag",
    };
  }

  return null;
};

// Deterministic order — first-listed gates are most decisive for the why-drawer.
const TERMINAL_GATES: readonly Gate[] = [
  excludedCountryGate,
  servicesConsultingGate,
  onePersonCompanyGate,
  websiteOfflineGate,
  genericEmailGate,
  competitorDenylistGate,
  projectBasedGate,
];

/**
 * Run every terminal gate. Collects ALL hits (the why-drawer shows them all) and
 * reports `disqualified` when at least one fired.
 */
export function evaluateTerminalGates(
  evidence: NormalizedScoringEvidence,
  rules: IcpVersionRulesV2
): TerminalGateResult {
  const hits: GateHit[] = [];

  for (const gate of TERMINAL_GATES) {
    const hit = gate(evidence, rules);
    if (hit) {
      hits.push(hit);
    }
  }

  return { disqualified: hits.length > 0, hits };
}
