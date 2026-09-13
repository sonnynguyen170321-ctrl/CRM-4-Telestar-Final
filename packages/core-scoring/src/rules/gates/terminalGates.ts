import type {
  GateHit,
  NormalizedScoringEvidence,
  TerminalGateResult,
} from "../evidence";
import type { IcpVersionRulesV2 } from "../schema-v2";
import { foldText } from "../normalize/normalizeCountry";

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
  return new Set(values.map((value) => foldText(value)));
}

// Excluded HQ country, or excluded office/delivery country when the rule scopes
// beyond HQ. Powers TeleStar "offices in India/Pakistan/Bangladesh/Philippines".
const excludedCountryGate: Gate = (evidence, rules) => {
  const { geography } = rules;
  const excludedHq = foldedSet(geography.excludedCountries);
  const excludedOffice = foldedSet(geography.excludedOfficeCountries);

  const hqCountry = evidence.company.country;
  if (hqCountry && excludedHq.has(foldText(hqCountry))) {
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
    const folded = foldText(office);
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

// Services/consulting disqualifier with conditional market exception:
// TeleStar excludes services/consulting EXCEPT in Vietnam.
const servicesConsultingGate: Gate = (evidence, rules) => {
  const policy = rules.companyType.servicesConsultingPolicy;
  if (!policy.disqualify) {
    return null;
  }

  const country = evidence.company.country;
  const exceptMarkets = foldedSet(policy.exceptMarkets);
  if (country && exceptMarkets.has(foldText(country))) {
    return null; // conditional exception — allowed in this market
  }

  const typeIsServices =
    evidence.company.companyType === "SERVICE_ONLY" ||
    evidence.company.companyType === "AGENCY";
  const textHasServices = SERVICES_CONSULTING_KEYWORDS.some((keyword) =>
    evidence.company.evidenceText.includes(keyword)
  );

  if (typeIsServices || textHasServices) {
    return {
      id: "services_consulting_based",
      label: "Services / consulting based company",
      reasonCode: "services_consulting_based",
      evidence: typeIsServices ? evidence.company.companyType : "services/consulting language",
    };
  }

  return null;
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
