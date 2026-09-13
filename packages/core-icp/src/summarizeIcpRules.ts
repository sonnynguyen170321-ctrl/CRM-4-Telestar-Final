import type { V2IcpRuleSummaryItem, V2IcpRulesSummary } from "./types";

export function summarizeIcpRules(rulesJson: unknown): V2IcpRulesSummary {
  const rules = isRecord(rulesJson) ? rulesJson : {};
  const isV2 = readString(rules.schemaVersion) === "v2";

  if (isV2) {
    const geo = isRecord(rules.geography) ? rules.geography : {};
    const ind = isRecord(rules.industry) ? rules.industry : {};
    const per = isRecord(rules.persona) ? rules.persona : {};
    const size = isRecord(rules.companySize) ? rules.companySize : {};
    const type = isRecord(rules.companyTypes) ? rules.companyTypes : {};
    const score = isRecord(rules.scorePolicy) ? rules.scorePolicy : {};
    const conf = isRecord(rules.confidencePolicy) ? rules.confidencePolicy : {};

    const targetPersona: V2IcpRuleSummaryItem[] = [];
    if (readStringList(per.titleAllowlist).length > 0) {
      targetPersona.push({ label: "Allowed Titles", detail: readStringList(per.titleAllowlist).join(", ") });
    }
    if (readStringList(per.departmentAllowlist).length > 0) {
      targetPersona.push({ label: "Allowed Departments", detail: readStringList(per.departmentAllowlist).join(", ") });
    }

    const companyTypeRules: V2IcpRuleSummaryItem[] = [];
    if (readStringList(ind.targetIndustries).length > 0) {
      companyTypeRules.push({ label: "Target Industries", detail: readStringList(ind.targetIndustries).join(", ") });
    }
    if (readStringList(ind.targetKeywords).length > 0) {
      companyTypeRules.push({ label: "Target Keywords", detail: readStringList(ind.targetKeywords).join(", ") });
    }
    if (readStringList(type.targetTypes).length > 0) {
      companyTypeRules.push({ label: "Target Types", detail: readStringList(type.targetTypes).join(", ") });
    }
    if (readNumber(size.minEmployees)) {
      companyTypeRules.push({ label: "Min Employees", detail: String(readNumber(size.minEmployees)) });
    }

    const geography: V2IcpRuleSummaryItem[] = [];
    if (readStringList(geo.targetCountries).length > 0) {
      geography.push({ label: "Target Countries", detail: readStringList(geo.targetCountries).join(", ") });
    } else {
      geography.push({ label: "Target Countries", detail: "Worldwide (All)" });
    }

    const exclusions: V2IcpRuleSummaryItem[] = [];
    if (readStringList(geo.excludedCountries).length > 0) {
      exclusions.push({ label: "Excluded Countries", detail: readStringList(geo.excludedCountries).join(", ") });
    }
    if (readStringList(ind.excludedIndustries).length > 0) {
      exclusions.push({ label: "Excluded Industries", detail: readStringList(ind.excludedIndustries).join(", ") });
    }
    if (readStringList(per.titleDenylist).length > 0) {
      exclusions.push({ label: "Excluded Titles", detail: readStringList(per.titleDenylist).join(", ") });
    }
    if (readStringList(type.excludedTypes).length > 0) {
      exclusions.push({ label: "Excluded Types", detail: readStringList(type.excludedTypes).join(", ") });
    }

    return {
      displayName: "ICP Rules V2",
      schemaVersion: "v2",
      hardGates: exclusions,
      positiveSignals: [...targetPersona, ...geography],
      negativeSignals: [],
      companyTypeRules,
      targetPersona,
      geography,
      exclusions,
      missingDataPolicy: [],
      confidencePolicy: Object.entries(conf).map(([k, v]) => `${formatKey(k)}: ${v}`),
      sourceReliability: [],
      scorePolicy: Object.entries(score).map(([k, v]) => `${formatKey(k)}: ${v}`),
      rawAvailable: true,
    };
  }

  return {
    displayName: readString(rules.displayName),
    schemaVersion: readString(rules.schemaVersion),
    hardGates: readRuleList(rules.hardGates),
    positiveSignals: readRuleList(rules.positiveSignals),
    negativeSignals: readRuleList(rules.negativeSignals),
    companyTypeRules: readRuleList(rules.companyTypeRules),
    missingDataPolicy: readPolicyLines(
      rules.missingDataPolicy ?? rules.missingWebsitePolicy
    ),
    confidencePolicy: readPolicyLines(rules.confidencePolicy),
    sourceReliability: readPolicyLines(
      rules.sourceReliabilityPriors ?? rules.sourceReliability ?? rules.evidenceReliability
    ),
    scorePolicy: readPolicyLines(rules.scorePolicy),
    rawAvailable: Object.keys(rules).length > 0,
  };
}

export function readAssessmentRulesSnapshot(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const snapshot = value.rulesSnapshot;

  return snapshot ? summarizeIcpRules(snapshot) : null;
}

export function readAssessmentInputSummary(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }

  const input = isRecord(value.inputSnapshot) ? value.inputSnapshot : {};
  const company = isRecord(value.companySnapshot) ? value.companySnapshot : {};
  const contact = isRecord(value.contactSnapshot) ? value.contactSnapshot : null;
  const summary = [
    readString(company.name) ? `Company: ${readString(company.name)}` : null,
    readString(company.canonicalDomain)
      ? `Domain: ${readString(company.canonicalDomain)}`
      : null,
    readString(company.country) ? `Country: ${readString(company.country)}` : null,
    contact && readString(contact.fullName)
      ? `Contact: ${readString(contact.fullName)}`
      : null,
    readString(input.assessmentMode)
      ? `Assessment mode: ${readString(input.assessmentMode)}`
      : null,
  ];

  return summary.filter(Boolean) as string[];
}

export function readAssessmentIssueSummary(value: unknown) {
  if (!isRecord(value)) {
    return [];
  }

  const missingEvidence = readStringList(value.missingEvidence);
  const reviewFlags = readStringList(value.reviewFlags);
  const reasonCodes = readStringList(value.reasonCodes);

  return [
    ...missingEvidence.map((item) => `Missing evidence: ${item}`),
    ...reviewFlags.map((item) => `Review flag: ${item}`),
    ...reasonCodes.map((item) => `Reason: ${item}`),
  ];
}

function readRuleList(value: unknown): V2IcpRuleSummaryItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 12).map((item, index) => {
    if (!isRecord(item)) {
      return { label: String(item), detail: null };
    }

    const label =
      readString(item.label) ??
      readString(item.name) ??
      readString(item.id) ??
      readString(item.field) ??
      `Rule ${index + 1}`;
    const details = [
      readString(item.description),
      readString(item.condition),
      readString(item.operator),
      readString(item.value),
      readNumber(item.scoreImpact) !== null
        ? `score impact ${readNumber(item.scoreImpact)}`
        : null,
      readNumber(item.weight) !== null ? `weight ${readNumber(item.weight)}` : null,
    ].filter(Boolean);

    return {
      label,
      detail: details.length ? details.join(" / ") : null,
    };
  });
}

function readPolicyLines(value: unknown): string[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.slice(0, 12).map(String);
  }

  if (!isRecord(value)) {
    return [String(value)];
  }

  return Object.entries(value)
    .slice(0, 12)
    .map(([key, policyValue]) => `${formatKey(key)}: ${formatPolicyValue(policyValue)}`);
}

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 8).map((item) => {
    if (typeof item === "string") {
      return item;
    }

    if (isRecord(item)) {
      return readString(item.label) ?? readString(item.code) ?? JSON.stringify(item);
    }

    return String(item);
  });
}

function formatPolicyValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(String).join(", ");
  }

  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, nestedValue]) => `${formatKey(key)}=${String(nestedValue)}`)
      .join(", ");
  }

  return String(value);
}

function formatKey(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
