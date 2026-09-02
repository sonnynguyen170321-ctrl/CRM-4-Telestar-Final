import type {
  CompanyIntelligenceEvidenceItem,
  CompanyIntelligenceProfileSummary,
} from "@/lib/v2/company-intelligence/readModel";

export type CompanyIntelligenceExplanation = {
  headline: string;
  narrative: string;
  sourceCount: number;
  evidenceCount: number;
  warnings: string[];
  signalGroups: Array<{
    family: string;
    label: string;
    readableTokens: string[];
    evidenceCount: number;
    sourceCount: number;
  }>;
  evidenceGroups: Array<{
    family: string;
    label: string;
    items: Array<{
      token: string;
      tokenLabel: string;
      evidenceText: string;
      sourceUrl: string;
      sourceLabel: string;
    }>;
    hiddenCount: number;
  }>;
};

const MAX_EVIDENCE_PER_GROUP = 4;

const TOKEN_LABELS: Record<string, string> = {
  "industry.retail": "Retail or ecommerce positioning",
  "maturity.has_pricing_page": "Pricing page is present",
  "maturity.hiring": "Hiring or open roles detected",
  "proof.customer_logo": "Customer logos or social proof found",
  "size.range_LARGE_ENTERPRISE": "Large-enterprise size token",
};

const FAMILY_LABELS: Record<string, string> = {
  industry: "Industry",
  maturity: "Commercial maturity",
  proof: "Proof",
  size: "Company size",
  tech: "Technology",
  persona: "Persona",
  geography: "Geography",
  other: "Other signals",
};

export function explainCompanyIntelligence(
  profile: CompanyIntelligenceProfileSummary
): CompanyIntelligenceExplanation {
  const uniqueEvidence = dedupeEvidence(profile.evidenceItems);
  const evidenceByFamily = groupEvidence(uniqueEvidence);
  const sourceCount = new Set(uniqueEvidence.map((item) => item.sourceUrl)).size;
  const signalGroups = profile.factsByFamily.map((group) => {
    const familyEvidence = evidenceByFamily.get(group.family) ?? [];

    return {
      family: group.family,
      label: labelFamily(group.family),
      readableTokens: Array.from(new Set(group.tokens)).map(labelToken),
      evidenceCount: familyEvidence.length,
      sourceCount: new Set(familyEvidence.map((item) => item.sourceUrl)).size,
    };
  });

  return {
    headline: buildHeadline(profile),
    narrative: buildNarrative(profile, signalGroups, sourceCount),
    sourceCount,
    evidenceCount: uniqueEvidence.length,
    warnings: buildWarnings(profile),
    signalGroups,
    evidenceGroups: Array.from(evidenceByFamily.entries()).map(
      ([family, items]) => ({
        family,
        label: labelFamily(family),
        items: items.slice(0, MAX_EVIDENCE_PER_GROUP).map((item) => ({
          token: item.token,
          tokenLabel: labelToken(item.token),
          evidenceText: item.evidenceText,
          sourceUrl: item.sourceUrl,
          sourceLabel: labelSource(item.sourceUrl),
        })),
        hiddenCount: Math.max(0, items.length - MAX_EVIDENCE_PER_GROUP),
      })
    ),
  };
}

function buildHeadline(profile: CompanyIntelligenceProfileSummary) {
  const industryTokens = profile.facts.filter((fact) => fact.startsWith("industry."));
  const readableIndustries = industryTokens.map(labelToken);

  if (readableIndustries.length > 0) {
    return `Appears to show ${joinReadable(readableIndustries)} signals.`;
  }

  if (profile.companySummary) {
    return "Company profile has extracted neutral facts.";
  }

  return "Company intelligence is available, but no strong industry signal was extracted.";
}

function buildNarrative(
  profile: CompanyIntelligenceProfileSummary,
  groups: CompanyIntelligenceExplanation["signalGroups"],
  sourceCount: number
) {
  const maturity = groups.find((group) => group.family === "maturity");
  const proof = groups.find((group) => group.family === "proof");
  const size = groups.find((group) => group.family === "size");
  const clauses = [
    maturity?.readableTokens.length
      ? `commercial maturity: ${joinReadable(maturity.readableTokens)}`
      : null,
    proof?.readableTokens.length ? `proof: ${joinReadable(proof.readableTokens)}` : null,
    size?.readableTokens.length ? `size: ${joinReadable(size.readableTokens)}` : null,
  ].filter((clause): clause is string => Boolean(clause));

  if (clauses.length === 0) {
    return profile.companySummary ?? "Only sparse neutral facts were extracted from the latest research profile.";
  }

  return `Latest research found ${clauses.join("; ")} across ${sourceCount} source${
    sourceCount === 1 ? "" : "s"
  }. Treat this as advisory context for LeadAssignment scoring, not a company-level verdict.`;
}

function buildWarnings(profile: CompanyIntelligenceProfileSummary) {
  const facts = new Set(profile.facts);
  const warnings: string[] = [];
  const hasTinyEmployeeEvidence = profile.facts.some((fact) =>
    /^size\.employee_count_([1-9]|10)$/.test(fact)
  );

  if (hasTinyEmployeeEvidence && facts.has("size.range_LARGE_ENTERPRISE")) {
    warnings.push(
      "Size evidence conflicts: employee-count evidence is small, but a large-enterprise size token was also extracted."
    );
  }

  if (
    profile.evidenceItems.length > 0 &&
    dedupeEvidence(profile.evidenceItems).length < profile.evidenceItems.length
  ) {
    warnings.push("Repeated source evidence was collapsed for readability.");
  }

  if (!profile.companySummary) {
    warnings.push("No human-readable company summary was recorded in the profile.");
  }

  return warnings;
}

function dedupeEvidence(items: CompanyIntelligenceEvidenceItem[]) {
  const seen = new Set<string>();
  const result: CompanyIntelligenceEvidenceItem[] = [];

  for (const item of items) {
    const key = [
      item.family.trim().toLowerCase(),
      item.token.trim().toLowerCase(),
      item.sourceUrl.trim().toLowerCase(),
      item.evidenceText.trim().toLowerCase(),
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function groupEvidence(items: CompanyIntelligenceEvidenceItem[]) {
  const groups = new Map<string, CompanyIntelligenceEvidenceItem[]>();

  for (const item of items) {
    const family = item.family || "other";
    const group = groups.get(family) ?? [];
    group.push(item);
    groups.set(family, group);
  }

  return groups;
}

function labelToken(token: string) {
  if (TOKEN_LABELS[token]) {
    return TOKEN_LABELS[token];
  }

  const employeeCount = token.match(/^size\.employee_count_(\d+)$/);
  if (employeeCount) {
    return `Employee-count evidence: ${employeeCount[1]}`;
  }

  const dotIndex = token.indexOf(".");
  const value = dotIndex >= 0 ? token.slice(dotIndex + 1) : token;

  return value
    .split(/[_\-.]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function labelFamily(family: string) {
  return FAMILY_LABELS[family] ?? labelToken(family);
}

function labelSource(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);

    return url.pathname === "/" ? url.hostname : `${url.hostname}${url.pathname}`;
  } catch {
    return sourceUrl;
  }
}

function joinReadable(values: string[]) {
  const unique = Array.from(new Set(values));

  if (unique.length <= 2) {
    return unique.join(" and ");
  }

  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`;
}
